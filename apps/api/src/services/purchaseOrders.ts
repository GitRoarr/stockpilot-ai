import type { PoStatus, Role } from '@stockpilot/shared';
import { db } from '../db/sqlite.js';
import { enqueue } from '../jobs/queue.js';
import { audit, notify, publish, type Actor } from '../lib/events.js';
import { getSettings } from '../lib/settings.js';
import { AppError, addDays, conflict, forbidden, id, json, localDate, now, nowIso, notFound, round2, unprocessable } from '../lib/util.js';
import { esc, layout, onEmailOutcome, queueEmail, supplierRecipient, table, type EmailRow } from './email.js';
import { recordLedger, removeLedger } from './ledger.js';
import { createPortalToken, revokePortalTokens } from './portalTokens.js';
import { deliveryDate, getPlan, type SupplierRow } from './planning.js';
import { ensureThread, postSystemMessage } from './collaboration.js';

// Purchase orders (SRS FR-070 – FR-079, Solution Design §D2.4, §D4).
const TRANSITIONS: Record<PoStatus, PoStatus[]> = {
  draft: ['pending_approval', 'approved', 'cancelled'],
  pending_approval: ['draft', 'approved', 'cancelled'],
  approved: ['sent', 'cancelled'],
  sent: ['confirmed', 'partially_confirmed', 'received', 'partially_received'],
  confirmed: ['confirmed', 'partially_confirmed', 'received', 'partially_received'],
  partially_confirmed: ['confirmed', 'partially_confirmed', 'received', 'partially_received'],
  received: ['closed'],
  partially_received: ['received', 'partially_received', 'closed'],
  closed: [],
  cancelled: [],
};

export function assertTransition(from: PoStatus, to: PoStatus): void {
  if (!TRANSITIONS[from]?.includes(to)) throw conflict(`Purchase order cannot move from ${from} to ${to}`);
}

export type PoRow = {
  id: string;
  number: string;
  supplier_id: string;
  plan_id: string | null;
  parent_po_id: string | null;
  status: PoStatus;
  delivery_date: string | null;
  subtotal: number;
  fees: number;
  total: number;
  baseline_total: number | null;
  saving: number | null;
  fee_saving: number;
  min_order_warning: string | null;
  note: string | null;
  created_by_type: string;
  created_by_id: string | null;
  approved_by: string | null;
  approved_at: string | null;
  sent_at: string | null;
  confirmation_deadline: string | null;
  reminders_sent: number;
  send_channel: string | null;
  eta: string | null;
  created_at: string;
  updated_at: string;
};

export type PoLineRow = {
  id: string;
  purchase_order_id: string;
  offer_id: string;
  ingredient_id: string;
  need: number;
  packs: number;
  pack_size: number;
  qty: number;
  unit_price: number;
  line_total: number;
  rationale: string | null;
  baseline_cost: number | null;
  edited_by_user: number;
  confirmed_qty: number | null;
  unavailable: number;
  substitute_json: string | null;
  note: string | null;
};

export function getPoRow(poId: string): PoRow {
  const po = db().get<PoRow>(`SELECT * FROM purchase_orders WHERE id = ?`, poId);
  if (!po) throw notFound('Purchase order not found');
  return po;
}

function nextNumber(prefix: string, table: string): string {
  const r = db().get<{ n: number | null }>(`SELECT MAX(CAST(substr(number, ${prefix.length + 2}) AS INTEGER)) AS n FROM ${table}`);
  return `${prefix}-${(r?.n ?? 1000) + 1}`;
}

/** Baseline cost of a quantity at the ingredient's preferred offer, pack-rounded (FR-044). */
function baselineCost(ingredientId: string, qty: number): number | null {
  const pref = db().get<{ pack_size: number; unit_price: number }>(`SELECT pack_size, unit_price FROM supplier_offers WHERE ingredient_id = ? AND preferred = 1 AND active = 1`, ingredientId);
  if (!pref || qty <= 0) return qty <= 0 ? 0 : null;
  return round2(Math.ceil(qty / pref.pack_size - 1e-6) * pref.pack_size * pref.unit_price);
}

/** Recomputes totals, fees, minimum-order warning and saving vs baseline (FR-071). */
export function recalcPo(poId: string): PoRow {
  const po = getPoRow(poId);
  const sup = db().get<SupplierRow>(`SELECT * FROM suppliers WHERE id = ?`, po.supplier_id)!;
  const lines = db().all<PoLineRow>(`SELECT * FROM po_lines WHERE purchase_order_id = ?`, poId);
  const live = lines.filter((l) => !l.unavailable && l.packs > 0);
  const subtotal = round2(live.reduce((s, l) => s + l.line_total, 0));
  const belowMin = sup.min_order_type === 'soft' && subtotal + 1e-6 < sup.min_order_value ? sup.below_min_fee : 0;
  const fees = live.length ? round2(sup.delivery_fee + belowMin) : 0;
  const warning = sup.min_order_type === 'hard' && live.length && subtotal + 1e-6 < sup.min_order_value ? `Below ${sup.name}'s hard minimum of $${sup.min_order_value.toFixed(2)}` : null;
  const baselineLines = live.reduce((s, l) => s + (l.baseline_cost ?? l.line_total), 0);
  const saving = round2(baselineLines - subtotal + po.fee_saving);
  db().run(
    `UPDATE purchase_orders SET subtotal = ?, fees = ?, total = ?, baseline_total = ?, saving = ?, min_order_warning = ?, updated_at = ? WHERE id = ?`,
    subtotal,
    fees,
    round2(subtotal + fees),
    round2(baselineLines + fees + po.fee_saving),
    saving,
    warning,
    nowIso(),
    poId,
  );
  return getPoRow(poId);
}

/**
 * Draft POs per supplier from an optimiser plan (FR-070). Quantities come only from the plan (FR-054).
 * A full re-plan supersedes earlier agent drafts that no human has edited.
 */
export function draftFromPlan(planId: string, actor: Actor, opts: { parentPoId?: string; supersede?: boolean } = {}): PoRow[] {
  const plan = getPlan(planId);
  if (!plan) throw notFound('Plan not found');
  if (plan.violations.length) throw unprocessable('Plan violates constraints — needs a human decision before drafting', { violations: plan.violations });
  if (!plan.solution.lines.length) return [];
  const existing = db().all<{ id: string }>(`SELECT id FROM purchase_orders WHERE plan_id = ? AND status <> 'cancelled'`, planId);
  if (existing.length) return existing.map((r) => getPoRow(r.id));
  return db().tx(() => {
    if (opts.supersede) {
      const old = db().all<{ id: string; number: string }>(
        `SELECT p.id, p.number FROM purchase_orders p WHERE p.status = 'draft' AND p.created_by_type = 'agent'
         AND NOT EXISTS (SELECT 1 FROM po_lines l WHERE l.purchase_order_id = p.id AND l.edited_by_user = 1)`,
      );
      for (const o of old) {
        db().run(`UPDATE purchase_orders SET status = 'cancelled', note = 'Superseded by a newer plan', updated_at = ? WHERE id = ?`, nowIso(), o.id);
        audit(actor, 'po.superseded', 'purchase_order', o.id);
      }
    }
    // Fee difference vs baseline (e.g. one delivery fee instead of two) is attributed to the PO with the largest line saving.
    const baseFees = plan.baseline.suppliers.reduce((s, x) => s + x.deliveryFee + x.belowMinFee, 0);
    const planFees = plan.solution.suppliers.reduce((s, x) => s + x.deliveryFee + x.belowMinFee, 0);
    const feeDelta = round2(baseFees - planFees);
    const lineSaving = (supplierId: string) =>
      plan.solution.lines.filter((l) => l.supplierId === supplierId).reduce((s, l) => s + ((plan.baseline.lines.find((b) => b.ingredientId === l.ingredientId)?.lineTotal ?? l.lineTotal) - l.lineTotal), 0);
    const feeOwner = [...plan.solution.suppliers].sort((a, b) => lineSaving(b.supplierId) - lineSaving(a.supplierId))[0]?.supplierId;

    const created: PoRow[] = [];
    for (const s of plan.solution.suppliers) {
      const lines = plan.solution.lines.filter((l) => l.supplierId === s.supplierId);
      const lead = Math.max(...lines.map((l) => db().get<{ lead_time_days: number }>(`SELECT lead_time_days FROM supplier_offers WHERE id = ?`, l.offerId)?.lead_time_days ?? 1));
      const poId = id('po');
      db().run(
        `INSERT INTO purchase_orders (id, number, supplier_id, plan_id, parent_po_id, status, delivery_date, fee_saving, created_by_type, created_by_id, created_at, updated_at)
         VALUES (?,?,?,?,?,'draft',?,?,?,?,?,?)`,
        poId,
        nextNumber('PO', 'purchase_orders'),
        s.supplierId,
        planId,
        opts.parentPoId ?? null,
        deliveryDate(s.supplierId, lead),
        s.supplierId === feeOwner ? feeDelta : 0,
        actor.type,
        actor.id ?? null,
        nowIso(),
        nowIso(),
      );
      for (const l of lines) {
        const need = plan.needs.find((n) => n.ingredientId === l.ingredientId);
        const base = plan.baseline.lines.find((b) => b.ingredientId === l.ingredientId);
        db().run(
          `INSERT INTO po_lines (id, purchase_order_id, offer_id, ingredient_id, need, packs, pack_size, qty, unit_price, line_total, rationale, baseline_cost)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
          id('pol'),
          poId,
          l.offerId,
          l.ingredientId,
          need?.trace.need ?? 0,
          l.packs,
          l.packSize,
          l.qty,
          l.unitPrice,
          l.lineTotal,
          plan.explanations[l.ingredientId] ?? null,
          base?.lineTotal ?? l.lineTotal,
        );
      }
      const po = recalcPo(poId);
      ensureThread('purchase_order', poId);
      audit(actor, 'po.drafted', 'purchase_order', poId, { after: { number: po.number, total: po.total, saving: po.saving, planId } });
      created.push(po);
    }
    publish('po.updated', { planId });
    return created;
  });
}

export function editLine(poId: string, lineId: string, patch: { packs?: number; note?: string }, actor: Actor): PoRow {
  return db().tx(() => {
    const po = getPoRow(poId);
    if (po.status !== 'draft') throw conflict('Lines can only be edited while the PO is a draft');
    const line = db().get<PoLineRow>(`SELECT * FROM po_lines WHERE id = ? AND purchase_order_id = ?`, lineId, poId);
    if (!line) throw notFound('PO line not found');
    const packs = patch.packs ?? line.packs;
    if (!Number.isInteger(packs) || packs < 0) throw unprocessable('Packs must be a whole number ≥ 0');
    const qty = packs * line.pack_size;
    db().run(
      `UPDATE po_lines SET packs = ?, qty = ?, line_total = ?, baseline_cost = ?, note = COALESCE(?, note), edited_by_user = CASE WHEN ? THEN 1 ELSE edited_by_user END WHERE id = ?`,
      packs,
      qty,
      round2(qty * line.unit_price),
      baselineCost(line.ingredient_id, qty),
      patch.note ?? null,
      patch.packs !== undefined && patch.packs !== line.packs && actor.type === 'user' ? 1 : 0,
      lineId,
    );
    const after = recalcPo(poId);
    audit(actor, 'po.line_edited', 'purchase_order', poId, { before: { lineId, packs: line.packs }, after: { lineId, packs } });
    publish('po.updated', { id: poId });
    return after;
  });
}

export function setPoNote(poId: string, note: string, actor: Actor): PoRow {
  const po = getPoRow(poId);
  if (po.status !== 'draft') throw conflict('Notes can only be changed while the PO is a draft');
  db().run(`UPDATE purchase_orders SET note = ?, updated_at = ? WHERE id = ?`, note, nowIso(), poId);
  audit(actor, 'po.note', 'purchase_order', poId);
  return getPoRow(poId);
}

export function setStatus(poId: string, to: PoStatus, actor: Actor, extra: Record<string, unknown> = {}): PoRow {
  const po = getPoRow(poId);
  assertTransition(po.status, to);
  db().run(`UPDATE purchase_orders SET status = ?, updated_at = ? WHERE id = ?`, to, nowIso(), poId);
  audit(actor, 'po.status', 'purchase_order', poId, { before: { status: po.status }, after: { status: to, ...extra } });
  publish('po.updated', { id: poId, status: to });
  return getPoRow(poId);
}

/** Who may approve a PO of this total (FR-067): Chef ≤ chefApprovalLimit, Owner always, Staff never. */
export function requiredRoleFor(total: number): Role {
  return total > getSettings().chefApprovalLimit ? 'owner' : 'chef';
}

export function assertCanApprove(role: Role, total: number): void {
  if (role === 'staff') throw forbidden('Staff cannot approve purchase orders.');
  if (role === 'chef' && requiredRoleFor(total) === 'owner') {
    throw new AppError(403, 'approval_limit_exceeded', `PO total $${total.toFixed(2)} exceeds the Chef approval limit of $${getSettings().chefApprovalLimit.toFixed(2)} — Owner approval required.`);
  }
}

export function approvePo(poId: string, approver: { id: string; role: Role } | { agentId: string; byPolicy: string }): PoRow {
  return db().tx(() => {
    const po = getPoRow(poId);
    if (!['draft', 'pending_approval'].includes(po.status)) throw conflict(`Purchase order is ${po.status}`);
    if (!db().get(`SELECT 1 FROM po_lines WHERE purchase_order_id = ? AND packs > 0`, poId)) throw unprocessable('Purchase order has no lines');
    if (po.min_order_warning) throw unprocessable(po.min_order_warning);
    const actor: Actor = 'role' in approver ? { type: 'user', id: approver.id } : { type: 'agent', id: approver.agentId };
    if ('role' in approver) assertCanApprove(approver.role, po.total);
    db().run(`UPDATE purchase_orders SET status = 'approved', approved_by = ?, approved_at = ?, updated_at = ? WHERE id = ?`, 'role' in approver ? approver.id : `policy:${approver.byPolicy}`, nowIso(), nowIso(), poId);
    audit(actor, 'po.approved', 'purchase_order', poId, { before: { status: po.status }, after: { status: 'approved', total: po.total } });
    if ((po.saving ?? 0) > 0) {
      recordLedger({
        type: 'optimiser_saving',
        amount: po.saving!,
        sourceType: 'purchase_order',
        sourceId: poId,
        method: `Baseline (preferred offers, same needs, pack rounding and fees) $${po.baseline_total?.toFixed(2)} − optimised $${po.total.toFixed(2)}`,
        agentId: 'buyer',
      });
    }
    publish('po.updated', { id: poId, status: 'approved' });
    return getPoRow(poId);
  });
}

export function cancelPo(poId: string, actor: Actor, reason?: string): PoRow {
  return db().tx(() => {
    const po = setStatus(poId, 'cancelled', actor, { reason });
    removeLedger('optimiser_saving', 'purchase_order', poId);
    revokePortalTokens('po', poId);
    db().run(`UPDATE agent_actions SET status = 'rejected', reject_reason = 'PO cancelled', decided_at = ? WHERE status = 'proposed' AND json_extract(args_json, '$.poId') = ?`, nowIso(), poId);
    return po;
  });
}

export function poLinesView(poId: string) {
  return db()
    .all<PoLineRow & { ingredient: string; unit: string; sku: string; category: string }>(
      `SELECT l.*, i.name AS ingredient, i.unit, i.category, o.sku FROM po_lines l JOIN ingredients i ON i.id = l.ingredient_id JOIN supplier_offers o ON o.id = l.offer_id
       WHERE l.purchase_order_id = ? ORDER BY i.name`,
      poId,
    )
    .map((l) => ({ ...l, substitute: json(l.substitute_json, null) }));
}

function poEmail(po: PoRow, sup: SupplierRow, link: string, reminder: boolean): { subject: string; html: string; text: string } {
  const s = getSettings();
  const lines = poLinesView(po.id).filter((l) => l.packs > 0);
  const subject = `${reminder ? 'Reminder: please confirm ' : ''}Purchase order ${po.number} from ${s.restaurantName}`;
  const rows = lines.map((l) => [l.sku, l.ingredient, `${l.packs} × ${l.pack_size} ${l.unit}`, `$${l.unit_price.toFixed(2)}/${l.unit}`, `$${l.line_total.toFixed(2)}`]);
  const html = layout(
    subject,
    `<p>Hello ${esc(sup.name)},</p><p>${reminder ? 'We have not yet received your confirmation for' : 'Please find our purchase order'} <b>${esc(po.number)}</b> for delivery on <b>${esc(po.delivery_date)}</b>.</p>
     ${table(['SKU', 'Item', 'Quantity', 'Price', 'Line total'], rows)}
     <p>Subtotal $${po.subtotal.toFixed(2)} · Fees $${po.fees.toFixed(2)} · <b>Total $${po.total.toFixed(2)}</b></p>
     <p><a href="${esc(link)}" style="display:inline-block;background:#2f6f4f;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none">Confirm, short or substitute items</a></p>
     <p style="font-size:12px;color:#666">No login needed. The link is valid for 7 days and only shows this order.</p>${po.note ? `<p>Note: ${esc(po.note)}</p>` : ''}`,
  );
  const text = `${subject}\n\nDelivery: ${po.delivery_date}\n${lines.map((l) => `${l.sku} ${l.ingredient}: ${l.packs} x ${l.pack_size} ${l.unit} @ $${l.unit_price.toFixed(2)} = $${l.line_total.toFixed(2)}`).join('\n')}\nTotal: $${po.total.toFixed(2)}\n\nConfirm or report changes: ${link}\n\n[Illustrative demo data]`;
  return { subject, html, text };
}

/**
 * Sends an approved PO (FR-072): portal token + outbox email in one transaction. The PO becomes `sent` only after the
 * provider accepts the email; without Brevo it is marked sent via a manual portal link so the workflow continues (FR-090).
 */
export function sendPo(poId: string, actor: Actor): { po: PoRow; emailId: string; portalUrl: string } {
  return db().tx(() => {
    const po = getPoRow(poId);
    if (po.status !== 'approved') throw conflict(`Only approved purchase orders can be sent (status: ${po.status})`);
    const pending = db().get(`SELECT 1 FROM email_messages WHERE kind = 'po' AND related_id = ? AND status = 'queued'`, poId);
    if (pending) throw conflict('This purchase order is already being sent');
    const sup = db().get<SupplierRow>(`SELECT * FROM suppliers WHERE id = ?`, po.supplier_id)!;
    revokePortalTokens('po', poId);
    const { url } = createPortalToken('po', poId);
    const mail = poEmail(po, sup, url, false);
    const emailId = queueEmail({ kind: 'po', to: supplierRecipient(sup.email), toName: sup.name, ...mail, relatedType: 'purchase_order', relatedId: poId });
    audit(actor, 'po.send_requested', 'purchase_order', poId, { meta: { emailId, to: sup.email } });
    return { po, emailId, portalUrl: url };
  });
}

/** Earlier of 4 h after sending and 2 h before the supplier's cut-off (FR-077). */
export function confirmationDeadline(sup: SupplierRow, sentAt: Date): string {
  const byHours = new Date(sentAt.getTime() + getSettings().confirmationHours * 3600_000);
  const today = localDate(sentAt);
  const [h, m] = sup.cutoff_time.split(':').map(Number);
  const tzOffset = tzOffsetMinutes(sentAt);
  const cutoff = new Date(Date.parse(`${today}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00Z`) - tzOffset * 60000 - 2 * 3600_000);
  return (cutoff > sentAt && cutoff < byHours ? cutoff : byHours).toISOString();
}

function tzOffsetMinutes(d: Date): number {
  const tz = getSettings().timezone;
  const local = new Date(d.toLocaleString('en-US', { timeZone: tz }));
  const utc = new Date(d.toLocaleString('en-US', { timeZone: 'UTC' }));
  return Math.round((local.getTime() - utc.getTime()) / 60000);
}

onEmailOutcome('po', (email: EmailRow, outcome) => {
  const poId = email.related_id!;
  const po = getPoRow(poId);
  if (po.status !== 'approved') return;
  if (outcome.status === 'failed') {
    notify('po_send_failed', `${po.number} was not sent`, `Email failed: ${outcome.error}. The order stays approved — resend from the outbox.`, `/orders/${poId}`);
    return;
  }
  const sup = db().get<SupplierRow>(`SELECT * FROM suppliers WHERE id = ?`, po.supplier_id)!;
  const sentAt = now();
  const deadline = confirmationDeadline(sup, sentAt);
  db().run(
    `UPDATE purchase_orders SET status = 'sent', sent_at = ?, send_channel = ?, confirmation_deadline = ?, updated_at = ? WHERE id = ?`,
    sentAt.toISOString(),
    outcome.status === 'sent' ? 'email' : 'manual_link',
    deadline,
    nowIso(),
    poId,
  );
  audit({ type: 'system' }, 'po.sent', 'purchase_order', poId, { after: { channel: outcome.status === 'sent' ? 'email' : 'manual_link', deadline } });
  enqueue('po.confirmation_deadline', { poId, round: 1 }, { runAt: deadline, idempotencyKey: `po-deadline:${poId}:1` });
  postSystemMessage('purchase_order', poId, outcome.status === 'sent' ? `Sent to ${sup.name} by email. Confirmation due by ${deadline}.` : `Email is not configured — share the portal link from the outbox with ${sup.name}.`);
  if (outcome.status === 'not_configured') notify('po_manual_link', `${po.number}: email not configured`, 'Share the supplier portal link from the outbox manually.', `/orders/${poId}`);
  publish('po.updated', { id: poId, status: 'sent' });
});

/** One reminder to the supplier after the first missed deadline; later misses notify the chef only (FR-077). */
export function sendReminder(poId: string, actor: Actor): { emailId: string | null; escalated: boolean } {
  return db().tx(() => {
    const po = getPoRow(poId);
    if (po.status !== 'sent') return { emailId: null, escalated: false };
    if (po.reminders_sent >= 1) {
      notify('po_unconfirmed', `${po.number} still unconfirmed`, 'The supplier did not confirm after a reminder. Please call them.', `/orders/${poId}`);
      audit(actor, 'po.escalated', 'purchase_order', poId);
      return { emailId: null, escalated: true };
    }
    const sup = db().get<SupplierRow>(`SELECT * FROM suppliers WHERE id = ?`, po.supplier_id)!;
    const { url } = createPortalToken('po', poId);
    const mail = poEmail(po, sup, url, true);
    const emailId = queueEmail({ kind: 'po_reminder', to: supplierRecipient(sup.email), toName: sup.name, ...mail, relatedType: 'purchase_order', relatedId: poId, idempotencyKey: `po-reminder:${poId}:1` });
    const next = new Date(now().getTime() + getSettings().confirmationHours * 3600_000).toISOString();
    db().run(`UPDATE purchase_orders SET reminders_sent = 1, confirmation_deadline = ?, updated_at = ? WHERE id = ?`, next, nowIso(), poId);
    enqueue('po.confirmation_deadline', { poId, round: 2 }, { runAt: next, idempotencyKey: `po-deadline:${poId}:2` });
    notify('po_unconfirmed', `${po.number} not confirmed by ${sup.name}`, 'Buyer sent one reminder to the supplier.', `/orders/${poId}`);
    audit(actor, 'po.reminder_sent', 'purchase_order', poId, { meta: { emailId } });
    return { emailId, escalated: false };
  });
}

export function supplierAverageOrder(supplierId: string): number | null {
  const since = addDays(localDate(), -28);
  const r = db().get<{ a: number | null; n: number }>(
    `SELECT AVG(total) AS a, COUNT(*) AS n FROM purchase_orders WHERE supplier_id = ? AND status IN ('sent','confirmed','partially_confirmed','received','partially_received','closed') AND substr(created_at,1,10) >= ?`,
    supplierId,
    since,
  );
  return r && r.n > 0 ? r.a : null;
}

export function poDetail(poId: string) {
  const po = getPoRow(poId);
  const sup = db().get<SupplierRow>(`SELECT * FROM suppliers WHERE id = ?`, po.supplier_id)!;
  const plan = po.plan_id ? getPlan(po.plan_id) : undefined;
  const responses = db()
    .all<any>(`SELECT * FROM supplier_responses WHERE purchase_order_id = ? ORDER BY version`, poId)
    .map((r) => ({ id: r.id, version: r.version, lines: json(r.lines_json, []), eta: r.eta, untrustedNote: r.untrusted_note, receivedAt: r.received_at }));
  const emails = db().all<any>(`SELECT id, kind, to_email, subject, status, error, text, created_at FROM email_messages WHERE related_type = 'purchase_order' AND related_id = ? ORDER BY created_at`, poId);
  const receipts = db().all<any>(`SELECT * FROM receipts WHERE purchase_order_id = ?`, poId);
  return {
    ...po,
    supplier: { id: sup.id, name: sup.name, email: sup.email, minOrderValue: sup.min_order_value, minOrderType: sup.min_order_type, deliveryFee: sup.delivery_fee, belowMinFee: sup.below_min_fee, trusted: Boolean(sup.trusted), cutoffTime: sup.cutoff_time },
    lines: poLinesView(poId),
    plan: plan ? { id: plan.id, total: plan.solution.total, baselineTotal: plan.baseline.total, saving: plan.saving, method: plan.method, fallbackReason: plan.fallbackReason, explanations: plan.explanations, baseline: plan.baseline, violations: plan.violations } : null,
    responses,
    emails,
    receipts,
    requiredRole: requiredRoleFor(po.total),
  };
}

export function listPos(status?: string) {
  const rows = status
    ? db().all<PoRow & { supplier: string }>(`SELECT p.*, s.name AS supplier FROM purchase_orders p JOIN suppliers s ON s.id = p.supplier_id WHERE p.status = ? ORDER BY p.created_at DESC`, status)
    : db().all<PoRow & { supplier: string }>(`SELECT p.*, s.name AS supplier FROM purchase_orders p JOIN suppliers s ON s.id = p.supplier_id ORDER BY p.created_at DESC LIMIT 200`);
  return rows.map((r) => ({ ...r, lineCount: db().get<{ n: number }>(`SELECT COUNT(*) AS n FROM po_lines WHERE purchase_order_id = ? AND packs > 0`, r.id)!.n }));
}

export function poCsv(poId: string): string {
  const po = getPoRow(poId);
  const rows = poLinesView(poId).filter((l) => l.packs > 0);
  return ['po,sku,item,packs,pack_size,unit,qty,unit_price,line_total', ...rows.map((l) => [po.number, l.sku, `"${l.ingredient.replace(/"/g, '""')}"`, l.packs, l.pack_size, l.unit, l.qty, l.unit_price.toFixed(2), l.line_total.toFixed(2)].join(','))].join('\n');
}

export function poPrintHtml(poId: string): string {
  const po = getPoRow(poId);
  if (['draft', 'pending_approval', 'cancelled'].includes(po.status)) throw conflict('Only approved purchase orders can be printed');
  const sup = db().get<SupplierRow>(`SELECT * FROM suppliers WHERE id = ?`, po.supplier_id)!;
  const lines = poLinesView(poId).filter((l) => l.packs > 0);
  return layout(
    `Purchase order ${po.number}`,
    `<p><b>${esc(getSettings().restaurantName)}</b> → <b>${esc(sup.name)}</b><br>Status: ${esc(po.status)} · Delivery ${esc(po.delivery_date)}</p>
     ${table(['SKU', 'Item', 'Packs', 'Qty', 'Unit price', 'Line total'], lines.map((l) => [l.sku, l.ingredient, `${l.packs} × ${l.pack_size}`, `${l.qty} ${l.unit}`, `$${l.unit_price.toFixed(2)}`, `$${l.line_total.toFixed(2)}`]))}
     <p>Subtotal $${po.subtotal.toFixed(2)} · Fees $${po.fees.toFixed(2)} · <b>Total $${po.total.toFixed(2)}</b></p>`,
  );
}
