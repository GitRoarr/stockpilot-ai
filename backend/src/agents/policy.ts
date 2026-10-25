import type { Role } from '@stockpilot/shared';
import { db } from '../db/sqlite.js';
import { getSettings } from '../lib/settings.js';
import { json, nowIso } from '../lib/util.js';
import { activeAgreements } from '../services/agreements.js';

// Policy engine (SRS FR-053, FR-065 – FR-069; Solution Design §D2.7). Rules are evaluated in order; the first decisive
// rule wins and is stored with the decision so the UI can say why an action needed approval.
export type Level = 'auto' | 'approve' | 'never';
export type Decision = 'auto' | 'requires_approval' | 'forbidden';

export type PolicySnapshot = {
  levels: Record<string, Level>;
  chefApprovalLimit: number;
  autoSend: { enabled: boolean; maxTotal: number; maxDeviationPct: number };
  takenAt: string;
};

export function currentPolicy(): PolicySnapshot {
  const levels: Record<string, Level> = {};
  for (const r of db().all<{ action: string; level: Level }>(`SELECT action, level FROM autonomy_policy`)) levels[r.action] = r.level;
  const s = getSettings();
  return { levels, chefApprovalLimit: s.chefApprovalLimit, autoSend: s.autoSend, takenAt: nowIso() };
}

export type PolicyContext = {
  agentTools: string[];
  policy: PolicySnapshot;
  externalText: boolean;
  /** Role ceiling of the human who started the run; null for scheduled/event runs. */
  humanRole: Role | null;
};

export type ActionFacts = {
  /** Spend of the action (PO total), for approval limits and auto-send. */
  total?: number;
  supplierTrusted?: boolean;
  supplierAverage?: number | null;
  verifierFlags?: number;
  /** record_credit: the supplier accepted the dispute in the portal. */
  supplierAccepted?: boolean;
};

export type PolicyResult = { decision: Decision; rule: string; reason: string; requiredRole: Role | null };

const SPEND_ACTIONS = new Set(['send_purchase_order', 'draft_purchase_orders_supplementary', 'accept_substitution', 'propose_po_change']);
const RANK: Record<Role, number> = { staff: 1, chef: 2, owner: 3 };

export function evaluatePolicy(ctx: PolicyContext, tool: string, action: string, facts: ActionFacts = {}): PolicyResult {
  // 1. Manifest boundary.
  if (!ctx.agentTools.includes(tool)) return { decision: 'forbidden', rule: 'tool_not_permitted', reason: `${tool} is not in this agent's manifest`, requiredRole: null };

  const level: Level = action === 'record_credit' && facts.supplierAccepted ? 'auto' : (ctx.policy.levels[action] ?? 'approve');
  const requiredRole: Role | null = SPEND_ACTIONS.has(action) && facts.total !== undefined ? (facts.total > ctx.policy.chefApprovalLimit ? 'owner' : 'chef') : action === 'propose_working_agreement' ? 'owner' : 'chef';

  // 2. Configured as never.
  if (level === 'never') return { decision: 'forbidden', rule: 'forbidden_by_policy', reason: `Policy for ${action} is "never"`, requiredRole: null };

  // The agreement itself is the Owner approval request (it starts as `proposed`), so proposing one never needs a second approval.
  if (action === 'propose_working_agreement') return { decision: 'auto', rule: 'agreement_needs_owner_approval', reason: 'Takes effect only after Owner approval', requiredRole: 'owner' };

  // 3. Working agreement of type approval_rule.
  for (const a of activeAgreements('approval_rule')) {
    if (a.params.actionType !== action) continue;
    if (a.params.maxTotal !== undefined && (facts.total ?? Infinity) > a.params.maxTotal) continue;
    return { decision: a.params.decision, rule: `working_agreement:${a.id}`, reason: a.rationale, requiredRole };
  }

  // 4. Runs triggered by external text (supplier notes, invoice text): no sending, everything else needs approval.
  if (ctx.externalText) {
    if (action === 'send_purchase_order') return { decision: 'forbidden', rule: 'external_text', reason: 'Runs triggered by supplier or invoice text cannot send orders', requiredRole: null };
    return { decision: 'requires_approval', rule: 'external_text', reason: 'Triggered by text from outside the restaurant — a human must approve', requiredRole };
  }

  // 5. Human-started runs cannot exceed that human's authority.
  if (ctx.humanRole && SPEND_ACTIONS.has(action)) {
    if (ctx.humanRole === 'staff') return { decision: 'requires_approval', rule: 'human_authority', reason: 'Started by Staff, who cannot approve spending', requiredRole };
    if (requiredRole && RANK[requiredRole] > RANK[ctx.humanRole]) return { decision: 'requires_approval', rule: 'human_authority', reason: `Exceeds the ${ctx.humanRole}'s approval limit`, requiredRole };
  }

  // 6. Approval limits: spend above the Chef limit always needs the Owner.
  if (SPEND_ACTIONS.has(action) && requiredRole === 'owner' && level !== 'auto') {
    return { decision: 'requires_approval', rule: 'approval_limit', reason: `Above the Chef limit of $${ctx.policy.chefApprovalLimit.toFixed(2)} — Owner approval`, requiredRole };
  }

  // 7. Bounded auto-send (FR-066).
  if (action === 'send_purchase_order' && ctx.policy.autoSend.enabled) {
    const failed: string[] = [];
    if (!facts.supplierTrusted) failed.push('supplier not trusted');
    if ((facts.total ?? Infinity) > ctx.policy.autoSend.maxTotal) failed.push(`total above $${ctx.policy.autoSend.maxTotal.toFixed(2)}`);
    const avg = facts.supplierAverage;
    if (!avg || Math.abs((facts.total ?? 0) - avg) / avg > ctx.policy.autoSend.maxDeviationPct / 100) failed.push(`not within ±${ctx.policy.autoSend.maxDeviationPct}% of the 4-week average`);
    if (facts.verifierFlags) failed.push('verifier flagged a line');
    if (!failed.length) return { decision: 'auto', rule: 'auto_send_rule', reason: 'Trusted supplier, within limit and usual order size', requiredRole: null };
    return { decision: 'requires_approval', rule: 'auto_send_rule', reason: `Auto-send not allowed: ${failed.join('; ')}`, requiredRole };
  }

  // 8. Configured level.
  return level === 'auto'
    ? { decision: 'auto', rule: 'policy_level', reason: `Policy for ${action} is "auto"`, requiredRole: null }
    : { decision: 'requires_approval', rule: 'policy_level', reason: `Policy for ${action} is "approve"`, requiredRole };
}

export function policySnapshotOf(runPolicyJson: string): PolicySnapshot {
  return json<PolicySnapshot>(runPolicyJson, currentPolicy());
}
