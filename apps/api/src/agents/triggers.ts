import type { Role } from '@stockpilot/shared';
import { db } from '../db/sqlite.js';
import { registerJob } from '../jobs/worker.js';
import { localDate } from '../lib/util.js';
import { ensureThread, onMention } from '../services/collaboration.js';
import { onDisputeEvent } from '../services/disputes.js';
import { onInvoiceEvent } from '../services/invoices.js';
import { onPortalEvent } from '../services/portal.js';
import { getPoRow } from '../services/purchaseOrders.js';
import { onReceivingEvent } from '../services/receiving.js';
import { onActionEvent } from './actions.js';
import { cancelRun, questionTimedOut, resumeAgent, runAgent, startRun } from './runtime.js';

// Proactive and event-driven runs (SRS FR-055, FR-058, FR-115). Wired once at start-up.
let wired = false;

export function startMorningRun(opts: { trigger: 'schedule' | 'manual' | 'catch_up'; user?: { id: string; role: Role } }): string {
  const date = localDate();
  return startRun({
    agentId: 'pilot',
    goal: `Run the morning purchasing workflow for ${date}: check team and stock status, delegate forecasting to Demand Planner and ordering to Buyer, then publish the standup.`,
    taskTitle: `Morning run ${date}`,
    trigger: opts.trigger,
    playbook: 'morning',
    // Scheduled runs are idempotent per day (AC-055); a manual "Run morning now" starts a new run.
    runKey: opts.trigger === 'manual' ? undefined : `${date}:morning`,
    authority: opts.user ? { role: opts.user.role, userId: opts.user.id } : null,
    payload: { date, linkedType: 'team', linkedId: 'team' },
  });
}

export function wireTriggers(): void {
  if (wired) return;
  wired = true;

  registerJob('agent.run', async ({ runId }) => runAgent(runId));
  registerJob('agent.resume', async ({ runId }) => resumeAgent(runId));
  registerJob('question.timeout', ({ questionId }) => questionTimedOut(questionId));
  registerJob('delegation.timeout', ({ childRunId }) => {
    const r = db().get<{ status: string }>(`SELECT status FROM agent_runs WHERE id = ?`, childRunId);
    if (r && !['completed', 'failed', 'budget_exhausted', 'cancelled'].includes(r.status)) cancelRun(childRunId, { type: 'system' });
  });
  registerJob('morning.run', () => {
    startMorningRun({ trigger: 'schedule' });
  });

  // FR-077: deadline → Buyer follows up once, then escalates.
  registerJob('po.confirmation_deadline', ({ poId, round }) => {
    const po = getPoRow(poId);
    if (po.status !== 'sent') return;
    startRun({
      agentId: 'buyer',
      goal: `${po.number} was not confirmed by its deadline (${round === 1 ? 'first' : 'second'} miss). Follow up with the supplier.`,
      trigger: 'po.unconfirmed_deadline',
      playbook: 'po_deadline',
      runKey: `deadline:${poId}:${round}`,
      payload: { poId, round, linkedType: 'purchase_order', linkedId: poId },
      threadId: ensureThread('purchase_order', poId),
    });
  });

  onPortalEvent((event, p) => {
    if (event !== 'supplier.responded') return;
    const shortages = p.shortages as unknown[];
    const subs = p.substitutionActions as unknown[];
    if (!shortages.length && !subs.length) return;
    const po = getPoRow(String(p.poId));
    const resp = db().get<{ untrusted_note: string | null }>(`SELECT untrusted_note FROM supplier_responses WHERE id = ?`, String(p.responseId));
    startRun({
      agentId: 'buyer',
      goal: `Supplier responded to ${po.number}: replan any shortfall (optimize_order with scope "shortage" and this poId, then draft_purchase_orders, then send_purchase_order for each new order so it reaches the Inbox for approval) and, for each substitution proposal in substitutionActions, ask the chef with ask_human, passing its actionId and recommending "No" when it is above the price tolerance.`,
      trigger: 'supplier.responded',
      playbook: 'supplier_response',
      runKey: `response:${p.responseId}`,
      externalText: Boolean(p.externalText),
      payload: {
        poId: po.id,
        poNumber: po.number,
        responseId: p.responseId,
        shortages,
        substitutionActions: subs,
        // What each substitution proposal is, so the agent can ask a meaningful question (IDs alone are not enough).
        substitutions: (subs as string[]).map((aid) => {
          const a = db().get<{ summary: string; args_json: string }>(`SELECT summary, args_json FROM agent_actions WHERE id = ?`, aid);
          return { actionId: aid, summary: a?.summary, aboveTolerance: Boolean(a && JSON.parse(a.args_json).flagged) };
        }),
        ...(resp?.untrusted_note ? { untrusted_supplier_note: resp.untrusted_note } : {}), linkedType: 'purchase_order', linkedId: po.id },
      threadId: ensureThread('purchase_order', po.id),
    });
  });

  onActionEvent((event, p) => {
    if (event !== 'substitution.rejected') return;
    const po = getPoRow(String(p.poId));
    const line = db().get<{ ingredient_id: string; need: number; offer_id: string }>(`SELECT ingredient_id, need, offer_id FROM po_lines WHERE id = ?`, String(p.poLineId));
    if (!line || line.need <= 0) return;
    startRun({
      agentId: 'buyer',
      goal: `The substitute on ${po.number} was rejected: cover the shortfall from another supplier (optimize_order with scope "shortage", draft_purchase_orders, then send_purchase_order so the new order waits for approval).`,
      trigger: 'substitution.rejected',
      playbook: 'supplier_response',
      runKey: `subst-rejected:${p.poLineId}`,
      payload: { poId: po.id, poNumber: po.number, shortages: [{ poLineId: p.poLineId, ingredientId: line.ingredient_id, shortfall: line.need, offerId: line.offer_id }], substitutionActions: [], linkedType: 'purchase_order', linkedId: po.id },
      threadId: ensureThread('purchase_order', po.id),
    });
  });

  onReceivingEvent((event, p) => {
    if (event !== 'delivery.received') return;
    const po = getPoRow(String(p.poId));
    startRun({
      agentId: 'ap-clerk',
      goal: `Delivery for ${po.number} was received. Check for an invoice to reconcile.`,
      trigger: 'delivery.received',
      playbook: 'delivery_received',
      runKey: `delivery:${p.receiptId}`,
      payload: { poId: po.id, poNumber: po.number, receiptId: p.receiptId, linkedType: 'purchase_order', linkedId: po.id },
      threadId: ensureThread('purchase_order', po.id),
    });
  });

  // Only code-computed facts are passed for invoices — never OCR text — so these runs are not "external text" (FR-059).
  onInvoiceEvent((event, p) => {
    if (event !== 'invoice.matched_with_variances') return;
    startRun({
      agentId: 'ap-clerk',
      goal: 'The three-way match found variances above the dispute minimum. Open a dispute and prepare the credit request.',
      trigger: 'invoice.matched_with_variances',
      playbook: 'invoice_variances',
      runKey: `variances:${p.invoiceId}`,
      payload: { invoiceId: p.invoiceId, varianceTotal: p.total, linkedType: 'invoice', linkedId: p.invoiceId },
      threadId: ensureThread('invoice', String(p.invoiceId)),
    });
  });

  onDisputeEvent((event, p) => {
    if (event !== 'dispute.accepted') return;
    startRun({
      agentId: 'ap-clerk',
      goal: 'The supplier accepted the credit request in the portal. Record the credit.',
      trigger: 'dispute.accepted',
      playbook: 'dispute_accepted',
      runKey: `dispute-accepted:${p.disputeId}`,
      payload: { disputeId: p.disputeId, linkedType: 'dispute', linkedId: p.disputeId },
      threadId: ensureThread('dispute', String(p.disputeId)),
    });
  });

  // FR-115: @mention in any thread starts a run in that thread with the user's role as the authority ceiling.
  onMention(({ agentId, threadId, messageId, body, user }) => {
    if (!db().get(`SELECT 1 FROM agents WHERE id = ?`, agentId)) return;
    const t = db().get<{ linked_type: string; linked_id: string }>(`SELECT linked_type, linked_id FROM threads WHERE id = ?`, threadId);
    startRun({
      agentId,
      goal: body.slice(0, 400),
      trigger: 'mention',
      playbook: 'chat',
      threadId,
      authority: { role: user.role as Role, userId: user.id },
      payload: { message: body, messageId, linkedType: t?.linked_type, linkedId: t?.linked_id },
    });
  });
}
