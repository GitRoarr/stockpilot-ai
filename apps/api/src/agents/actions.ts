import type { Role } from '@stockpilot/shared';
import { db } from '../db/sqlite.js';
import { audit, publish, type Actor } from '../lib/events.js';
import { addDays, AppError, conflict, forbidden, json, localDate, notFound, nowIso, round2 } from '../lib/util.js';
import { listAgreements, proposeAgreement } from '../services/agreements.js';
import { ensureThread, postMessage } from '../services/collaboration.js';
import { assertCanApprove, getPoRow, poLinesView, recalcPo } from '../services/purchaseOrders.js';
import { registerActionDecider } from './runtime.js';
import { TOOLS } from './tools/index.js';
import type { ExecContext, RunInfo } from './tools/types.js';

// Inbox: proposals, questions and agreement proposals (SRS FR-068, FR-117, FR-119).
type ActionRow = {
  id: string;
  run_id: string | null;
  agent_id: string;
  tool: string;
  args_json: string;
  summary: string;
  policy_decision: string;
  decided_by_rule: string;
  required_role: Role | null;
  status: string;
  approver_id: string | null;
  reject_reason: string | null;
  result_json: string | null;
  created_at: string;
  decided_at: string | null;
};

const RANK: Record<Role, number> = { staff: 1, chef: 2, owner: 3 };

function getAction(aid: string): ActionRow {
  const a = db().get<ActionRow>(`SELECT * FROM agent_actions WHERE id = ?`, aid);
  if (!a) throw notFound('Proposal not found');
  return a;
}

function runInfoFor(a: ActionRow): RunInfo {
  const r = a.run_id ? db().get<any>(`SELECT * FROM agent_runs WHERE id = ?`, a.run_id) : undefined;
  return {
    id: r?.id ?? `system:${a.id}`,
    agentId: a.agent_id,
    taskId: r?.task_id ?? null,
    threadId: r?.thread_id ?? null,
    parentRunId: r?.parent_run_id ?? null,
    trigger: r?.trigger ?? 'event',
    playbook: r?.playbook ?? 'event',
    payload: json(r?.payload_json, {}),
    externalText: Boolean(r?.external_text),
    authorityRole: r?.authority_role ?? 'system',
    authorityUserId: r?.authority_user_id ?? null,
    depth: r?.depth ?? 0,
    mode: r?.mode ?? 'deterministic',
  };
}

function threadFor(a: ActionRow): string {
  const args = json<any>(a.args_json, {});
  if (args.poId) return ensureThread('purchase_order', args.poId);
  if (args.disputeId) return ensureThread('dispute', args.disputeId);
  if (args.invoiceId) return ensureThread('invoice', args.invoiceId);
  const r = a.run_id ? db().get<{ thread_id: string | null; task_id: string | null }>(`SELECT thread_id, task_id FROM agent_runs WHERE id = ?`, a.run_id) : undefined;
  return r?.thread_id ?? ensureThread('task', r?.task_id ?? a.id);
}

// Substitutions are proposed by the portal service on behalf of Buyer (FR-075).
async function executeSubstitution(a: ActionRow, user: { id: string; role: Role }): Promise<unknown> {
  const args = json<any>(a.args_json, {});
  const s = args.untrusted_substitute;
  const line = db().get<any>(`SELECT * FROM po_lines WHERE id = ? AND purchase_order_id = ?`, args.poLineId, args.poId);
  if (!line) throw notFound('PO line not found');
  db().tx(() => {
    db().run(`UPDATE po_lines SET substitute_json = ?, unit_price = ?, confirmed_qty = qty, line_total = ?, unavailable = 0 WHERE id = ?`, JSON.stringify({ ...s, acceptedBy: user.id, originalPrice: line.unit_price }), s.unitPrice, round2(line.qty * s.unitPrice), line.id);
    recalcPo(args.poId);
    const lines = poLinesView(args.poId).filter((l) => l.packs > 0);
    const pending = db().get(`SELECT 1 FROM agent_actions WHERE tool = 'accept_substitution' AND status = 'proposed' AND id <> ? AND json_extract(args_json, '$.poId') = ?`, a.id, args.poId);
    if (!pending && lines.every((l) => !l.unavailable && l.confirmed_qty !== null && l.confirmed_qty >= l.qty - 1e-6)) db().run(`UPDATE purchase_orders SET status = 'confirmed', updated_at = ? WHERE id = ? AND status = 'partially_confirmed'`, nowIso(), args.poId);
  });
  return { poId: args.poId, accepted: s.description, unitPrice: s.unitPrice };
}

type Emit = (event: string, payload: Record<string, unknown>) => void;
let emit: Emit = () => {};
export function onActionEvent(fn: Emit): void {
  emit = fn;
}

export async function approveAction(aid: string, user: { id: string; role: Role }): Promise<unknown> {
  const a = getAction(aid);
  if (a.status !== 'proposed') throw conflict(`Proposal is already ${a.status}`);
  if (user.role === 'staff') throw forbidden('Staff cannot approve proposals.');
  if (a.required_role && RANK[user.role] < RANK[a.required_role]) throw new AppError(403, 'approval_limit_exceeded', `This proposal needs ${a.required_role} approval.`);
  const args = json<any>(a.args_json, {});
  if (args.poId && ['send_purchase_order'].includes(a.tool)) assertCanApprove(user.role, getPoRow(args.poId).total);
  db().run(`UPDATE agent_actions SET status = 'approved', approver_id = ?, decided_at = ? WHERE id = ? AND status = 'proposed'`, user.id, nowIso(), aid);
  let result: unknown;
  try {
    if (a.tool === 'accept_substitution') result = await executeSubstitution(a, user);
    else {
      const tool = TOOLS[a.tool];
      const ctx: ExecContext = { run: runInfoFor(a), actor: { type: 'agent', id: a.agent_id }, stepNo: 0, callIndex: 0, approver: user };
      result = await tool.execute(tool.schema.parse(args), ctx);
    }
  } catch (e) {
    // Leave the proposal open so the user can fix the cause (e.g. approval limit) and retry.
    db().run(`UPDATE agent_actions SET status = 'proposed', approver_id = NULL, decided_at = NULL WHERE id = ?`, aid);
    throw e;
  }
  db().run(`UPDATE agent_actions SET status = 'executed', result_json = ? WHERE id = ?`, JSON.stringify(result ?? null), aid);
  audit({ type: 'user', id: user.id }, 'action.approved', 'agent_action', aid, { meta: { tool: a.tool, summary: a.summary } });
  postMessage(threadFor(a), { type: 'user', id: user.id }, `Approved: ${a.summary}`);
  publish('action.decided', { id: aid, status: 'executed' });
  return result;
}

export type RejectTags = { supplierId?: string; category?: string; ingredientId?: string };

export async function rejectAction(aid: string, user: { id: string; role: Role }, reason: string, tags?: RejectTags): Promise<void> {
  const a = getAction(aid);
  if (a.status !== 'proposed') throw conflict(`Proposal is already ${a.status}`);
  if (user.role === 'staff') throw forbidden('Staff cannot decide proposals.');
  const actor: Actor = { type: 'user', id: user.id };
  const args = json<any>(a.args_json, {});
  db().run(`UPDATE agent_actions SET status = 'rejected', approver_id = ?, reject_reason = ?, decided_at = ? WHERE id = ?`, user.id, reason, nowIso(), aid);
  if (a.tool === 'accept_substitution') {
    db().run(`UPDATE po_lines SET unavailable = 1, confirmed_qty = 0 WHERE id = ?`, args.poLineId);
    recalcPo(args.poId);
  } else {
    TOOLS[a.tool]?.onRejected?.(args, reason, actor);
  }
  audit(actor, 'action.rejected', 'agent_action', aid, { meta: { tool: a.tool, reason, tags } });
  postMessage(threadFor(a), actor, `Rejected: ${a.summary} — ${reason}`);
  publish('action.decided', { id: aid, status: 'rejected' });
  if (tags?.supplierId && (tags.category || tags.ingredientId)) recordCorrection({ ...tags, supplierId: tags.supplierId }, `rejected:${aid}`, actor);
  if (a.tool === 'accept_substitution') emit('substitution.rejected', { poId: args.poId, poLineId: args.poLineId });
}

registerActionDecider(async (aid, decision, user, reason) => {
  if (decision === 'approve') await approveAction(aid, user);
  else await rejectAction(aid, user, reason ?? 'Rejected');
});

// ── Learning from corrections (FR-119, Solution Design §D3.7): ≥ 2 similar corrections in 30 days → Buyer proposes a rule ──
export function recordCorrection(c: { supplierId: string; category?: string; ingredientId?: string }, evidence: string, actor: Actor): void {
  audit(actor, 'correction', 'supplier', c.supplierId, { meta: { ...c, evidence } });
  const since = addDays(localDate(), -30);
  const similar = db()
    .all<{ meta_json: string }>(`SELECT meta_json FROM audit_events WHERE action = 'correction' AND entity_id = ? AND at >= ?`, c.supplierId, since)
    .map((r) => json<any>(r.meta_json, {}))
    .filter((m) => (c.category && m.category === c.category) || (c.ingredientId && m.ingredientId === c.ingredientId));
  if (similar.length < 2) return;
  const params = c.category ? { supplierId: c.supplierId, category: c.category } : { supplierId: c.supplierId, ingredientId: c.ingredientId };
  if (listAgreements().some((x) => x.type === 'exclude_supplier' && ['proposed', 'active'].includes(x.status) && JSON.stringify(x.params) === JSON.stringify(params))) return;
  const sup = db().get<{ name: string }>(`SELECT name FROM suppliers WHERE id = ?`, c.supplierId)?.name ?? c.supplierId;
  const what = c.category ?? db().get<{ name: string }>(`SELECT name FROM ingredients WHERE id = ?`, c.ingredientId ?? '')?.name;
  const ag = proposeAgreement('buyer', { type: 'exclude_supplier', params } as never, `You corrected ${what} from ${sup} ${similar.length} times in 30 days. Stop buying ${what} from ${sup}?`, similar.map((m) => ({ type: 'correction', id: m.evidence })));
  audit({ type: 'agent', id: 'buyer' }, 'agreement.proposed_from_corrections', 'working_agreement', ag.id, { meta: { evidence: similar.map((m) => m.evidence) } });
}

/** A user removing a draft PO line (packs → 0) is a correction of that supplier for that ingredient's category. */
export function correctionFromLineEdit(poId: string, lineId: string, packsBefore: number, packsAfter: number, actor: Actor): void {
  if (!(packsBefore > 0 && packsAfter === 0) || actor.type !== 'user') return;
  const po = getPoRow(poId);
  const l = db().get<{ ingredient_id: string; category: string }>(`SELECT l.ingredient_id, i.category FROM po_lines l JOIN ingredients i ON i.id = l.ingredient_id WHERE l.id = ?`, lineId);
  if (l) recordCorrection({ supplierId: po.supplier_id, category: l.category }, `line_removed:${lineId}`, actor);
}

export function inbox(user: { role: Role }) {
  const proposals = db()
    .all<ActionRow & { agent_name: string }>(`SELECT a.*, g.display_name AS agent_name FROM agent_actions a LEFT JOIN agents g ON g.id = a.agent_id WHERE a.status = 'proposed' ORDER BY a.created_at DESC`)
    .map((a) => {
      const args = json<any>(a.args_json, {});
      const po = args.poId ? db().get<any>(`SELECT p.id, p.number, p.status, p.total, p.saving, p.baseline_total, s.name AS supplier FROM purchase_orders p JOIN suppliers s ON s.id = p.supplier_id WHERE p.id = ?`, args.poId) : null;
      const reason = a.decided_by_rule === 'external_text' ? 'Triggered by text from outside the restaurant' : a.decided_by_rule === 'approval_limit' ? 'Above the Chef approval limit' : a.decided_by_rule.startsWith('working_agreement') ? 'Working agreement' : a.decided_by_rule === 'auto_send_rule' ? 'Auto-send conditions not met' : a.decided_by_rule === 'human_authority' ? "Exceeds the requesting user's authority" : 'Autonomy policy requires approval';
      return {
        id: a.id,
        agentId: a.agent_id,
        agentName: a.agent_name,
        tool: a.tool,
        summary: a.summary,
        args,
        decidedByRule: a.decided_by_rule,
        why: reason,
        requiredRole: a.required_role,
        canDecide: user.role !== 'staff' && (!a.required_role || RANK[user.role] >= RANK[a.required_role]),
        runId: a.run_id,
        createdAt: a.created_at,
        purchaseOrder: po,
        lines: args.poId ? poLinesView(args.poId).filter((l) => l.packs > 0).map((l) => ({ id: l.id, ingredient: l.ingredient, category: l.category, packs: l.packs, packSize: l.pack_size, unit: l.unit, unitPrice: l.unit_price, lineTotal: l.line_total, rationale: l.rationale, edited: Boolean(l.edited_by_user) })) : [],
      };
    });
  const questions = db()
    .all<any>(`SELECT q.*, g.display_name AS agent_name FROM questions q LEFT JOIN agents g ON g.id = q.agent_id WHERE q.status = 'open' ORDER BY q.created_at DESC`)
    .map((q) => ({ id: q.id, agentId: q.agent_id, agentName: q.agent_name, text: q.text, options: json(q.options_json, []), recommended: q.recommended, deadline: q.deadline, actionId: q.action_id, runId: q.run_id, taskId: q.task_id, createdAt: q.created_at }));
  const agreements = listAgreements().filter((x) => x.status === 'proposed');
  return { proposals, questions, agreements, counts: { proposals: proposals.length, questions: questions.length, agreements: agreements.length } };
}
