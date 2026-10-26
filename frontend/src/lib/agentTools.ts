import { agentName } from '../components/ui';

// Plain-language wording for agent tools, run triggers and policy decisions. The raw names stay available in the
// run page's "Technical details" view and in tooltips, so the audit trail is unchanged.

/** What each manifest tool lets an agent do (Team page) — also the step title in a run trace. */
export const TOOL_LABEL: Record<string, string> = {
  add_demand_event: 'Add demand events',
  ask_human: 'Ask you a question',
  delegate_task: 'Delegate to teammates',
  draft_purchase_orders: 'Draft purchase orders',
  get_backtest_report: 'Check forecast accuracy',
  get_forecast: 'Read the forecast',
  get_inventory_status: 'Check stock levels',
  get_invoice_match: 'Match invoices',
  get_reorder_plan: 'Read reorder needs',
  get_savings_summary: 'Read savings',
  get_supplier_offers: 'Compare supplier offers',
  get_team_status: 'Check team status',
  open_dispute: 'Open disputes',
  optimize_order: 'Optimise orders',
  post_message: 'Post in team chat',
  propose_po_change: 'Propose order changes',
  propose_working_agreement: 'Propose standing rules',
  publish_briefing: 'Publish the standup',
  record_credit: 'Record supplier credits',
  refresh_context: 'Refresh weather & holidays',
  send_dispute_email: 'Email credit requests',
  send_purchase_order: 'Send orders to suppliers',
  send_supplier_followup: 'Follow up with suppliers',
  simulate_scenario: 'Run what-if scenarios',
};

export const toolLabel = (name: string) => TOOL_LABEL[name] ?? sentence(name.replace(/_/g, ' '));

const sentence = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const lowerFirst = (s: string) => (s ? s.charAt(0).toLowerCase() + s.slice(1) : s);
const money = (n: unknown) => (typeof n === 'number' ? `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '');
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const list = (xs: string[], max = 4) => (xs.length > max ? `${xs.slice(0, max).join(', ')} and ${xs.length - max} more` : xs.join(', '));
/** Delegated results carry nested outputs as JSON strings (sometimes truncated); parse when possible. */
const obj = (v: unknown): any => {
  if (typeof v !== 'string') return v;
  try {
    return JSON.parse(v);
  } catch {
    return null;
  }
};

/** What the agent decided to do, as a sentence (the arguments are in Technical details). */
export function describeCall(name: string, args: any = {}): string {
  switch (name) {
    case 'delegate_task':
      return `Asked ${agentName(args.agent)} to ${lowerFirst(String(args.goal ?? 'take on a task')).replace(/\.$/, '')}`;
    case 'ask_human':
      return `Asked you: “${args.question}”`;
    case 'post_message':
      return 'Posted in team chat';
    case 'refresh_context':
      return 'Refresh weather and holidays';
    case 'get_forecast':
      return args.menuItem ? `Read the forecast for ${args.menuItem}` : `Read the ${args.days ?? 7}-day forecast`;
    case 'optimize_order':
      return args.scope === 'shortage' ? 'Find another supplier for the shortfall' : 'Compare suppliers for the cheapest total order';
    case 'send_purchase_order':
      return 'Send an order to its supplier';
    default:
      return toolLabel(name);
  }
}

/** One-line outcome of a tool call, from its real result. */
export function describeResult(name: string, raw: any): { text: string; tone: 'ok' | 'wait' | 'error' } {
  const r = obj(raw);
  if (r && typeof r === 'object' && 'error' in r) {
    const issues = Array.isArray(r.issues) ? r.issues.map((i: any) => (i.path ? `${i.path}: ${i.message}` : i.message)).join('; ') : '';
    const why = r.error === 'validation_error' ? `the request was incomplete${issues ? ` (${issues})` : ''} — the agent retried` : (r.message ?? r.reason ?? String(r.error).replace(/_/g, ' '));
    return { text: `Not done: ${why}`, tone: 'error' };
  }
  if (r?.status === 'pending_approval') return { text: `Waiting for approval${r.requiredRole ? ` (${sentence(r.requiredRole)})` : ''}: ${r.summary ?? toolLabel(name)}`, tone: 'wait' };
  if (!r || typeof r !== 'object') return { text: 'Done', tone: 'ok' };
  switch (name) {
    case 'delegate_task':
      return { text: `${agentName(r.agent)} ${r.status === 'completed' ? 'finished' : String(r.status ?? 'replied').replace(/_/g, ' ')}${r.finalMessage ? `: ${r.finalMessage}` : ''}`, tone: r.status === 'completed' ? 'ok' : 'wait' };
    case 'get_team_status': {
      const busy = (r.agents ?? []).filter((a: any) => a.status !== 'idle').length;
      return { text: `${plural(r.agents?.length ?? 0, 'agent')} (${busy} busy) · ${plural(r.pendingApprovals ?? 0, 'approval')} waiting · ${plural(r.openQuestions ?? 0, 'open question')}`, tone: 'ok' };
    }
    case 'get_inventory_status': {
      const parts = [`${plural(r.critical?.length ?? 0, 'critical item')}`, `${r.low?.length ?? 0} low`, `${plural(r.itemsNeedingOrder ?? 0, 'item')} to order`];
      if (r.valueAtRisk) parts.push(`${money(r.valueAtRisk)} at risk of expiry`);
      return { text: parts.join(' · '), tone: 'ok' };
    }
    case 'refresh_context': {
      const st = Object.entries(r).map(([k, v]: [string, any]) => `${k} ${v?.status ?? ''}`.trim());
      return { text: st.length ? `Sources: ${st.join(', ')}` : 'Updated', tone: 'ok' };
    }
    case 'get_forecast':
      return { text: `Forecast for ${plural(r.items?.length ?? 0, 'dish', 'dishes')}${r.highUncertainty?.length ? ` · uncertain: ${list(r.highUncertainty, 3)}` : ''}`, tone: 'ok' };
    case 'get_backtest_report':
      return { text: `${r.itemsAtOrBelowNaive ?? 0} of ${plural(r.itemCount ?? 0, 'dish', 'dishes')} forecast at least as well as the simple baseline`, tone: 'ok' };
    case 'get_reorder_plan':
      return { text: r.count ? `${plural(r.count, 'ingredient')} need ordering: ${list((r.items ?? []).map((i: any) => i.name))}` : 'Nothing needs ordering', tone: 'ok' };
    case 'optimize_order':
      if (r.message) return { text: r.message, tone: 'ok' };
      return { text: `Best plan ${money(r.total)} across ${plural(r.suppliers?.length ?? 0, 'supplier')}${r.saving > 0 ? ` — ${money(r.saving)} (${r.savingPct}%) less than the preferred suppliers` : ''}`, tone: 'ok' };
    case 'draft_purchase_orders': {
      const pos: any[] = r.purchaseOrders ?? [];
      return { text: `Drafted ${plural(pos.length, 'order')}: ${pos.map((p) => `${p.number} ${money(p.total)}`).join(', ')}`, tone: 'ok' };
    }
    case 'send_purchase_order':
      return { text: r.number ? `${r.number} sent to the supplier` : 'Sent', tone: 'ok' };
    case 'propose_po_change':
      return { text: `${r.number ?? 'Order'} updated — now ${money(r.total)}`, tone: 'ok' };
    case 'publish_briefing':
      return { text: r.alreadyPublished ? 'Today’s standup was already published' : `Standup published${r.mode === 'ai' ? '' : ' (rules engine)'}`, tone: 'ok' };
    case 'get_invoice_match':
      return { text: `${r.number ?? 'Invoice'}: ${r.variances?.length ? `${plural(r.variances.length, 'difference')} totalling ${money(r.varianceTotal)}` : 'matches the order and delivery'}`, tone: 'ok' };
    case 'open_dispute':
      return { text: `${r.number ?? 'Dispute'} drafted for ${money(r.amountClaimed)}`, tone: 'ok' };
    case 'record_credit':
      return { text: `Credit of ${money(r.amountCredited)} recorded`, tone: 'ok' };
    case 'add_demand_event':
      return { text: `Demand event added for ${r.date}`, tone: 'ok' };
    case 'propose_working_agreement':
      return { text: 'Standing rule proposed — the Owner approves it in the Inbox', tone: 'wait' };
    default:
      return { text: r.summary ?? r.message ?? 'Done', tone: 'ok' };
  }
}

const TRIGGER: Record<string, string> = {
  manual: 'started manually',
  schedule: 'scheduled morning run',
  catch_up: 'catch-up morning run',
  mention: 'mentioned in chat',
  delegated: 'delegated by a teammate',
  fallback: 'rules engine follow-up',
  plan: 'from a plan',
  'po.unconfirmed_deadline': 'supplier did not confirm in time',
  'supplier.responded': 'supplier replied',
  'substitution.rejected': 'substitute rejected',
  'delivery.received': 'delivery received',
  'invoice.matched_with_variances': 'invoice differences found',
  'dispute.accepted': 'supplier accepted a credit',
};
export const triggerLabel = (t: string) => TRIGGER[t] ?? t.replace(/[._]/g, ' ');

const DECISION: Record<string, string> = { auto: 'Ran automatically', requires_approval: 'Needs approval', forbidden: 'Not allowed' };
export const decisionLabel = (d: string) => DECISION[d] ?? sentence(d.replace(/_/g, ' '));

const RULE: Record<string, string> = {
  policy_level: 'Autonomy policy',
  approval_limit: 'Above the Chef’s approval limit',
  human_authority: 'Limited by the role that started the run',
  external_text: 'Started by text from outside the restaurant',
  auto_send_rule: 'Auto-send rule',
  agreement_needs_owner_approval: 'Standing rules need the Owner',
  forbidden_by_policy: 'Blocked by the autonomy policy',
  tool_not_permitted: 'Not one of this agent’s tools',
};
export const ruleLabel = (r: string) => RULE[r] ?? sentence(r.replace(/_/g, ' '));

const AUDIT: Record<string, string> = {
  'auth.login': 'Signed in',
  'auth.register': 'Created an account',
  'run.started': 'Agent run started',
  'run.completed': 'Agent run completed',
  'run.resumed': 'Agent run resumed',
  'run.failed': 'Agent run failed',
  'run.fallback': 'Switched to the rules engine',
  'task.created': 'Task created',
  'task.updated': 'Task updated',
  'po.drafted': 'Purchase order drafted',
  'po.status': 'Purchase order status changed',
  'po.approved': 'Purchase order approved',
  'po.send_requested': 'Purchase order queued to send',
  'po.sent': 'Purchase order sent',
  'po.reminder_sent': 'Supplier reminder sent',
  'action.proposed': 'Approval requested',
  'action.approved': 'Approved',
  'action.rejected': 'Rejected',
  'action.executed': 'Action carried out',
  'email.sent': 'Email sent',
  'email.not_configured': 'Email not sent (no email key)',
  'email.failed': 'Email failed',
  'template.deployed': 'AI team deployed',
  'agent.paused': 'Agent paused',
  'agent.resumed': 'Agent resumed',
};
/** Audit event names (e.g. "po.send_requested", "tool.get_forecast") in words. */
export const auditLabel = (a: string) => AUDIT[a] ?? (a.startsWith('tool.') ? `Used: ${toolLabel(a.slice(5))}` : sentence(a.replace(/[._]/g, ' ')));
export const entityLabel = (e: string | null | undefined) => (e ? e.replace(/_/g, ' ') : '');

/** Short readable version of an audit event's details; the raw JSON stays in the tooltip. */
export function auditDetail(v: unknown): string {
  if (!v || typeof v !== 'object') return v ? String(v) : '';
  const o = v as Record<string, unknown>;
  const words = (x: unknown) => String(x).replace(/_/g, ' ');
  if ('from' in o && 'to' in o) return `${words(o.from)} → ${words(o.to)}`;
  return Object.entries(o)
    .filter(([, x]) => x !== null && x !== undefined && typeof x !== 'object')
    .slice(0, 4)
    .map(([k, x]) => `${words(k)}: ${typeof x === 'number' && /total|amount|saving/i.test(k) ? money(x) : words(x)}`)
    .join(' · ');
}

const EMAIL_KIND: Record<string, string> = { po: 'Purchase order', po_reminder: 'Supplier reminder', briefing: 'Morning standup', dispute: 'Credit request' };
export const emailKindLabel = (k: string) => EMAIL_KIND[k] ?? sentence(k.replace(/_/g, ' '));
