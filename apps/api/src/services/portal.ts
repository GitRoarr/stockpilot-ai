import { z } from 'zod';
import { db } from '../db/sqlite.js';
import { audit, notify, publish } from '../lib/events.js';
import { getSettings } from '../lib/settings.js';
import { conflict, id, json, nowIso, round2, unprocessable } from '../lib/util.js';
import { postMessage, ensureThread } from './collaboration.js';
import { getPoRow, poLinesView, recalcPo } from './purchaseOrders.js';
import { requiredRoleFor } from './purchaseOrders.js';

// Supplier portal responses (SRS FR-073 – FR-076, Solution Design §D4.1 – §D4.2). Free text is stored as untrusted.
export const SupplierResponseSchema = z.object({
  lines: z
    .array(
      z.object({
        poLineId: z.string(),
        action: z.enum(['confirm', 'reduce', 'unavailable', 'substitute']),
        qty: z.number().nonnegative().optional(),
        substitute: z.object({ description: z.string().min(2).max(120), packSize: z.number().positive(), unitPrice: z.number().nonnegative() }).optional(),
      }),
    )
    .min(1),
  eta: z.string().max(40).optional(),
  note: z.string().max(1000).optional(),
});
export type SupplierResponse = z.infer<typeof SupplierResponseSchema>;

type Emit = (event: string, payload: Record<string, unknown>) => void;
let emit: Emit = () => {};
export function onPortalEvent(fn: Emit): void {
  emit = fn;
}

export function portalPoView(poId: string) {
  const po = getPoRow(poId);
  const sup = db().get<{ name: string }>(`SELECT name FROM suppliers WHERE id = ?`, po.supplier_id)!;
  const last = db().get<any>(`SELECT * FROM supplier_responses WHERE purchase_order_id = ? ORDER BY version DESC LIMIT 1`, poId);
  return {
    restaurant: getSettings().restaurantName,
    supplier: sup.name,
    po: { id: po.id, number: po.number, status: po.status, deliveryDate: po.delivery_date, subtotal: po.subtotal, fees: po.fees, total: po.total, note: po.note, eta: po.eta },
    lines: poLinesView(poId)
      .filter((l) => l.packs > 0)
      .map((l) => ({ id: l.id, sku: l.sku, item: l.ingredient, unit: l.unit, packs: l.packs, packSize: l.pack_size, qty: l.qty, unitPrice: l.unit_price, lineTotal: l.line_total, confirmedQty: l.confirmed_qty, unavailable: Boolean(l.unavailable), substitute: l.substitute })),
    lastResponse: last ? { version: last.version, receivedAt: last.received_at } : null,
    acceptsResponses: ['sent', 'confirmed', 'partially_confirmed'].includes(po.status),
  };
}

export function submitSupplierResponse(poId: string, input: SupplierResponse) {
  const r = SupplierResponseSchema.parse(input);
  const out = db().tx(() => {
    const po = getPoRow(poId);
    if (!['sent', 'confirmed', 'partially_confirmed'].includes(po.status)) throw conflict(`This order is ${po.status} and can no longer be changed here`);
    const lines = new Map(poLinesView(poId).map((l) => [l.id, l]));
    for (const l of r.lines) {
      const pl = lines.get(l.poLineId);
      if (!pl) throw unprocessable('Unknown line on this order');
      if (l.action === 'reduce' && (l.qty === undefined || l.qty >= pl.qty)) throw unprocessable(`${pl.ingredient}: a reduced quantity must be lower than ${pl.qty}`);
      if (l.action === 'substitute' && !l.substitute) throw unprocessable(`${pl.ingredient}: describe the substitute`);
    }
    const version = (db().get<{ v: number | null }>(`SELECT MAX(version) AS v FROM supplier_responses WHERE purchase_order_id = ?`, poId)!.v ?? 0) + 1;
    const rid = id('spr');
    db().run(`INSERT INTO supplier_responses (id, purchase_order_id, version, lines_json, eta, untrusted_note, received_at) VALUES (?,?,?,?,?,?,?)`, rid, poId, version, JSON.stringify(r.lines), r.eta ?? null, r.note ?? null, nowIso());

    const shortages: { poLineId: string; ingredientId: string; ingredient: string; shortfall: number; offerId: string }[] = [];
    const substitutionActions: string[] = [];
    const tol = getSettings().substitutionTolerancePct;
    for (const l of r.lines) {
      const pl = lines.get(l.poLineId)!;
      if (l.action === 'confirm') db().run(`UPDATE po_lines SET confirmed_qty = qty, unavailable = 0 WHERE id = ?`, pl.id);
      else if (l.action === 'reduce') db().run(`UPDATE po_lines SET confirmed_qty = ?, unavailable = 0 WHERE id = ?`, l.qty!, pl.id);
      else if (l.action === 'unavailable') db().run(`UPDATE po_lines SET confirmed_qty = 0, unavailable = 1 WHERE id = ?`, pl.id);
      if (l.action === 'reduce' || l.action === 'unavailable') {
        const confirmed = l.action === 'unavailable' ? 0 : l.qty!;
        // Shortfall against the planned need, not the pack-rounded quantity (AC-076: 38.0 − 30 = 8.0).
        const shortfall = Math.round((pl.need - confirmed) * 1000) / 1000;
        if (shortfall > 0) shortages.push({ poLineId: pl.id, ingredientId: pl.ingredient_id, ingredient: pl.ingredient, shortfall, offerId: pl.offer_id });
      }
      if (l.action === 'substitute') {
        const s = l.substitute!;
        const diffPct = pl.unit_price > 0 ? (s.unitPrice - pl.unit_price) / pl.unit_price : 0;
        const flagged = diffPct > tol;
        const total = round2(pl.qty * s.unitPrice);
        const aid = id('act');
        db().run(
          `INSERT INTO agent_actions (id, run_id, agent_id, tool, args_json, summary, policy_decision, decided_by_rule, required_role, status, idempotency_key, created_at)
           VALUES (?,NULL,'buyer','accept_substitution',?,?,'requires_approval','policy_level',?,'proposed',?,?)`,
          aid,
          JSON.stringify({ poId, poLineId: pl.id, untrusted_substitute: s, originalPrice: pl.unit_price, diffPct: Math.round(diffPct * 1000) / 10, flagged, qty: pl.qty, total }),
          `Accept substitute "${s.description}" for ${pl.ingredient} at $${s.unitPrice.toFixed(2)}/${pl.unit} (${diffPct >= 0 ? '+' : ''}${(diffPct * 100).toFixed(1)}% vs $${pl.unit_price.toFixed(2)})${flagged ? ' — above price tolerance' : ''}`,
          requiredRoleFor(total),
          `substitution:${rid}:${pl.id}`,
          nowIso(),
        );
        substitutionActions.push(aid);
      }
    }
    const fresh = poLinesView(poId).filter((l) => l.packs > 0);
    const allConfirmed = fresh.every((l) => !l.unavailable && l.confirmed_qty !== null && l.confirmed_qty >= l.qty - 1e-6);
    const status = allConfirmed && !substitutionActions.length ? 'confirmed' : 'partially_confirmed';
    db().run(`UPDATE purchase_orders SET status = ?, eta = COALESCE(?, eta), updated_at = ? WHERE id = ?`, status, r.eta ?? null, nowIso(), poId);
    recalcPo(poId);
    audit({ type: 'supplier', id: po.supplier_id }, 'supplier.responded', 'purchase_order', poId, { after: { version, status, lines: r.lines, eta: r.eta }, meta: { untrusted_note: r.note } });
    const parts = [`Supplier response v${version}: ${status.replace('_', ' ')}`];
    if (r.eta) parts.push(`ETA ${r.eta}`);
    if (shortages.length) parts.push(`short: ${shortages.map((s) => `${s.ingredient} ${s.shortfall}`).join(', ')}`);
    postMessage(ensureThread('purchase_order', poId), { type: 'supplier', id: po.supplier_id }, parts.join(' · '), { evidence: r.note ? [{ type: 'untrusted_note', label: 'Supplier note (untrusted)', data: r.note }] : [] });
    return { responseId: rid, version, status, shortages, substitutionActions, number: po.number, externalText: Boolean(r.note || r.lines.some((l) => l.substitute)) };
  });
  publish('po.updated', { id: poId, status: out.status });
  if (out.substitutionActions.length) publish('action.proposed', { ids: out.substitutionActions });
  notify('supplier_response', `${out.number}: supplier ${out.status.replace('_', ' ')}`, out.shortages.length ? `Shortage on ${out.shortages.map((s) => s.ingredient).join(', ')} — Buyer is replanning` : undefined, `/orders/${poId}`);
  emit('supplier.responded', { poId, responseId: out.responseId, shortages: out.shortages, substitutionActions: out.substitutionActions, externalText: out.externalText });
  return out;
}

export function responseLines(responseId: string) {
  const r = db().get<{ lines_json: string; untrusted_note: string | null }>(`SELECT lines_json, untrusted_note FROM supplier_responses WHERE id = ?`, responseId);
  return r ? { lines: json(r.lines_json, []), untrustedNote: r.untrusted_note } : null;
}
