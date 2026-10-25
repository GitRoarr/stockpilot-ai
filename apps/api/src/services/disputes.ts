import { z } from 'zod';
import { db } from '../db/sqlite.js';
import { aiAvailable, llmStructured } from '../agents/llm/gateway.js';
import { LlmUnavailable } from '../agents/llm/types.js';
import { checkGrounding } from '../engines/grounding.js';
import { audit, notify, publish, type Actor } from '../lib/events.js';
import { getSettings } from '../lib/settings.js';
import { conflict, id, notFound, nowIso, round2, unprocessable } from '../lib/util.js';
import { postSystemMessage, ensureThread } from './collaboration.js';
import { esc, layout, onEmailOutcome, queueEmail, supplierRecipient, table } from './email.js';
import { recordLedger, removeLedger } from './ledger.js';
import { createPortalToken, revokePortalTokens } from './portalTokens.js';

// Disputes and credit recovery (SRS FR-086, FR-087; Solution Design §D4.3). The facts table is rendered by code;
// only the covering text may come from Gemini, and it is grounding-checked against the facts.
export type DisputeRow = {
  id: string;
  number: string;
  supplier_id: string;
  invoice_id: string;
  status: 'draft' | 'sent' | 'acknowledged' | 'credited' | 'partially_credited' | 'rejected' | 'closed';
  amount_claimed: number;
  amount_credited: number;
  email_subject: string | null;
  email_body: string | null;
  text_mode: string | null;
  supplier_reply: string | null;
  created_at: string;
  updated_at: string;
};

export function getDispute(did: string): DisputeRow {
  const d = db().get<DisputeRow>(`SELECT * FROM disputes WHERE id = ?`, did);
  if (!d) throw notFound('Dispute not found');
  return d;
}

function facts(invoiceId: string) {
  const inv = db().get<any>(`SELECT i.*, s.name AS supplier, p.number AS po_number FROM invoices i JOIN suppliers s ON s.id = i.supplier_id LEFT JOIN purchase_orders p ON p.id = i.purchase_order_id WHERE i.id = ?`, invoiceId);
  if (!inv) throw notFound('Invoice not found');
  const variances = db().all<{ id: string; type: string; description: string; amount: number }>(`SELECT id, type, description, amount FROM variances WHERE invoice_id = ? AND amount > 0`, invoiceId);
  return { invoiceNumber: inv.number, poNumber: inv.po_number, supplier: inv.supplier, supplierId: inv.supplier_id, invoiceTotal: inv.total, variances, total: round2(variances.reduce((s, v) => s + v.amount, 0)) };
}

const TextSchema = z.object({ subject: z.string().min(5).max(140), body: z.string().min(20).max(1500) });

async function disputeText(f: ReturnType<typeof facts>): Promise<{ subject: string; body: string; mode: string }> {
  const template = {
    subject: `Credit request for invoice ${f.invoiceNumber} (${f.poNumber})`,
    body: `Hello ${f.supplier} team,\n\nWhen we checked invoice ${f.invoiceNumber} against purchase order ${f.poNumber} and our delivery record, we found the differences listed below. Please issue a credit note for $${f.total.toFixed(2)}, or reply through the link if you see it differently.\n\nThank you,\n${getSettings().restaurantName}`,
  };
  const ai = aiAvailable();
  if (!ai.ok) return { ...template, mode: `template (${ai.reason})` };
  const schema = { type: 'object', properties: { subject: { type: 'string' }, body: { type: 'string' } }, required: ['subject', 'body'] };
  let lastReason = 'validation_failed';
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const { response, model } = await llmStructured('dispute_text', {
        system:
          'You are the AP Clerk of a restaurant. Write a short, polite credit-request email to a supplier. A facts table with every amount is attached by the system below your text — do not repeat amounts except the total, and never state a number that is not in the facts.',
        prompt: JSON.stringify({ facts: f, ...(attempt ? { correction: 'Previous text used numbers that are not in the facts. Use only the total.' } : {}) }),
        schema,
      });
      const t = TextSchema.parse(JSON.parse(response.text));
      const g = checkGrounding(`${t.subject}\n${t.body}`, f);
      if (g.ok) return { ...t, mode: `gemini:${model}` };
    } catch (e) {
      if (e instanceof LlmUnavailable) return { ...template, mode: `template (${e.reason})` };
    }
  }
  return { ...template, mode: `template (${lastReason})` };
}

/** AP Clerk opens a dispute draft for variances above the minimum (FR-086). Idempotent per invoice. */
export async function openDispute(invoiceId: string, actor: Actor): Promise<DisputeRow> {
  const existing = db().get<DisputeRow>(`SELECT * FROM disputes WHERE invoice_id = ?`, invoiceId);
  if (existing) return existing;
  const f = facts(invoiceId);
  if (!f.variances.length) throw unprocessable('No variances to dispute');
  if (f.total < getSettings().disputeMinimum) throw unprocessable(`Variances total $${f.total.toFixed(2)}, below the $${getSettings().disputeMinimum.toFixed(2)} dispute minimum`);
  const text = await disputeText(f);
  return db().tx(() => {
    const again = db().get<DisputeRow>(`SELECT * FROM disputes WHERE invoice_id = ?`, invoiceId);
    if (again) return again;
    const did = id('dsp');
    const n = db().get<{ n: number | null }>(`SELECT MAX(CAST(substr(number, 5) AS INTEGER)) AS n FROM disputes`)!.n ?? 500;
    db().run(
      `INSERT INTO disputes (id, number, supplier_id, invoice_id, status, amount_claimed, email_subject, email_body, text_mode, created_at, updated_at) VALUES (?,?,?,?,'draft',?,?,?,?,?,?)`,
      did,
      `DSP-${n + 1}`,
      f.supplierId,
      invoiceId,
      f.total,
      text.subject,
      text.body,
      text.mode,
      nowIso(),
      nowIso(),
    );
    db().run(`UPDATE variances SET dispute_id = ? WHERE invoice_id = ? AND amount > 0`, did, invoiceId);
    db().run(`UPDATE invoices SET status = 'disputed' WHERE id = ?`, invoiceId);
    recordLedger({ type: 'credit_pending', amount: f.total, sourceType: 'dispute', sourceId: did, method: 'Sum of computed variances (three-way match)', agentId: 'ap-clerk' });
    ensureThread('dispute', did);
    audit(actor, 'dispute.opened', 'dispute', did, { after: { amount: f.total, variances: f.variances } });
    postSystemMessage('invoice', invoiceId, `Dispute DSP-${n + 1} drafted for $${f.total.toFixed(2)}.`);
    publish('dispute.updated', { id: did });
    return getDispute(did);
  });
}

function disputeEmail(d: DisputeRow, link: string) {
  const f = facts(d.invoice_id);
  const html = layout(
    d.email_subject ?? 'Credit request',
    `<p style="white-space:pre-wrap">${esc(d.email_body)}</p>${table(['Type', 'Detail', 'Amount'], f.variances.map((v) => [v.type.replace('_', ' '), v.description, `$${v.amount.toFixed(2)}`]))}
     <p><b>Total credit requested: $${d.amount_claimed.toFixed(2)}</b></p>
     <p><a href="${esc(link)}" style="display:inline-block;background:#2f6f4f;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none">Accept or reject this request</a></p>`,
  );
  const text = `${d.email_body}\n\n${f.variances.map((v) => `- ${v.description}: $${v.amount.toFixed(2)}`).join('\n')}\nTotal: $${d.amount_claimed.toFixed(2)}\n\nRespond: ${link}`;
  return { subject: d.email_subject ?? 'Credit request', html, text };
}

export function sendDispute(did: string, actor: Actor): { emailId: string } {
  return db().tx(() => {
    const d = getDispute(did);
    if (d.status !== 'draft') throw conflict(`Dispute is ${d.status}`);
    if (db().get(`SELECT 1 FROM email_messages WHERE kind = 'dispute' AND related_id = ? AND status = 'queued'`, did)) throw conflict('Already sending');
    const sup = db().get<{ email: string; name: string }>(`SELECT email, name FROM suppliers WHERE id = ?`, d.supplier_id)!;
    revokePortalTokens('dispute', did);
    const { url } = createPortalToken('dispute', did, 14);
    const emailId = queueEmail({ kind: 'dispute', to: supplierRecipient(sup.email), toName: sup.name, ...disputeEmail(d, url), relatedType: 'dispute', relatedId: did });
    audit(actor, 'dispute.send_requested', 'dispute', did, { meta: { emailId } });
    return { emailId };
  });
}

onEmailOutcome('dispute', (email, outcome) => {
  const d = getDispute(email.related_id!);
  if (d.status !== 'draft' || outcome.status === 'failed') return;
  db().run(`UPDATE disputes SET status = 'sent', updated_at = ? WHERE id = ?`, nowIso(), d.id);
  audit({ type: 'system' }, 'dispute.sent', 'dispute', d.id, { meta: { channel: outcome.status === 'sent' ? 'email' : 'manual_link' } });
  postSystemMessage('dispute', d.id, outcome.status === 'sent' ? 'Credit request emailed to the supplier.' : 'Email not configured — share the dispute link from the outbox.');
  publish('dispute.updated', { id: d.id });
});

type Emit = (event: string, payload: Record<string, unknown>) => void;
let emit: Emit = () => {};
export function onDisputeEvent(fn: Emit): void {
  emit = fn;
}

/** Supplier response through the portal link (FR-087). */
export function supplierDisputeResponse(did: string, decision: 'accept' | 'reject', note: string | undefined): DisputeRow {
  const d = db().tx(() => {
    const d = getDispute(did);
    if (d.status !== 'sent') throw conflict(`This credit request is ${d.status}`);
    const status = decision === 'accept' ? 'acknowledged' : 'rejected';
    db().run(`UPDATE disputes SET status = ?, supplier_reply = ?, updated_at = ? WHERE id = ?`, status, note ?? null, nowIso(), did);
    audit({ type: 'supplier', id: d.supplier_id }, `dispute.supplier_${decision}`, 'dispute', did, { meta: { untrusted_note: note } });
    postSystemMessage('dispute', did, decision === 'accept' ? 'Supplier accepted the credit request.' : 'Supplier rejected the credit request.');
    if (decision === 'reject') {
      removeLedger('credit_pending', 'dispute', did);
      notify('dispute', `${d.number} rejected by the supplier`, 'Review the reply and decide next steps.', `/disputes/${did}`);
    }
    return getDispute(did);
  });
  publish('dispute.updated', { id: did });
  if (decision === 'accept') emit('dispute.accepted', { disputeId: did });
  return d;
}

/** Records a credit (agent after portal acceptance, or a user from a credit note). Ledger: credit_recovered (AC-087). */
export function recordCredit(did: string, amount: number | undefined, actor: Actor, note?: string): DisputeRow {
  const res = db().tx(() => {
    const d = getDispute(did);
    if (!['sent', 'acknowledged'].includes(d.status)) throw conflict(`Dispute is ${d.status}`);
    const amt = round2(amount ?? d.amount_claimed);
    if (amt <= 0 || amt > d.amount_claimed + 0.005) throw unprocessable(`Credit must be between $0.01 and $${d.amount_claimed.toFixed(2)}`);
    const status = amt + 0.005 >= d.amount_claimed ? 'credited' : 'partially_credited';
    db().run(`UPDATE disputes SET status = ?, amount_credited = ?, updated_at = ? WHERE id = ?`, status, amt, nowIso(), did);
    removeLedger('credit_pending', 'dispute', did);
    recordLedger({ type: 'credit_recovered', amount: amt, sourceType: 'dispute', sourceId: did, method: note ? `Credit note: ${note}` : 'Supplier accepted the credit request in the portal', agentId: 'ap-clerk' });
    audit(actor, 'dispute.credited', 'dispute', did, { after: { status, amount: amt } });
    postSystemMessage('dispute', did, `Credit of $${amt.toFixed(2)} recorded (${status.replace('_', ' ')}).`);
    return getDispute(did);
  });
  publish('dispute.updated', { id: did });
  return res;
}

export function closeDispute(did: string, actor: Actor): DisputeRow {
  const d = getDispute(did);
  if (!['credited', 'partially_credited', 'rejected'].includes(d.status)) throw conflict(`Dispute is ${d.status}`);
  db().run(`UPDATE disputes SET status = 'closed', updated_at = ? WHERE id = ?`, nowIso(), did);
  db().run(`UPDATE invoices SET status = 'closed' WHERE id = ?`, d.invoice_id);
  revokePortalTokens('dispute', did);
  audit(actor, 'dispute.closed', 'dispute', did);
  return getDispute(did);
}

export function disputeDetail(did: string) {
  const d = getDispute(did);
  const f = facts(d.invoice_id);
  const emails = db().all<any>(`SELECT id, status, to_email, subject, text, error, created_at FROM email_messages WHERE related_type = 'dispute' AND related_id = ? ORDER BY created_at`, did);
  const poId = db().get<{ purchase_order_id: string | null }>(`SELECT purchase_order_id FROM invoices WHERE id = ?`, d.invoice_id)?.purchase_order_id ?? null;
  return { ...d, supplier: f.supplier, invoiceNumber: f.invoiceNumber, invoiceTotal: f.invoiceTotal, poNumber: f.poNumber, poId, variances: f.variances, emails };
}

export function listDisputes() {
  return db().all<any>(`SELECT d.*, s.name AS supplier, i.number AS invoice_number FROM disputes d JOIN suppliers s ON s.id = d.supplier_id JOIN invoices i ON i.id = d.invoice_id ORDER BY d.created_at DESC`);
}
