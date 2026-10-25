import { z } from 'zod';
import { db } from '../db/sqlite.js';
import { audit, notify, publish, type Actor } from '../lib/events.js';
import { conflict, id, json, notFound, nowIso, unprocessable } from '../lib/util.js';

// Working agreements (SRS FR-119, Solution Design §D3.7): structured rules applied by engines and policy, not by prompt.
const supplierScope = z.object({ supplierId: z.string(), ingredientId: z.string().optional(), category: z.string().optional() }).refine((p) => p.ingredientId || p.category, 'ingredientId or category required');

export const AgreementSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('exclude_supplier'), params: supplierScope }),
  z.object({ type: z.literal('prefer_supplier'), params: z.object({ supplierId: z.string(), ingredientId: z.string().optional(), category: z.string().optional(), maxPremiumPct: z.number().min(0).max(20) }) }),
  z.object({ type: z.literal('min_order_override'), params: z.object({ ingredientId: z.string(), minQty: z.number().positive() }) }),
  z.object({ type: z.literal('rounding_preference'), params: z.object({ category: z.string(), direction: z.enum(['up', 'down']) }) }),
  z.object({ type: z.literal('approval_rule'), params: z.object({ actionType: z.string(), maxTotal: z.number().min(0).optional(), decision: z.enum(['auto', 'requires_approval', 'forbidden']) }) }),
  z.object({ type: z.literal('quiet_hours'), params: z.object({ channel: z.enum(['email', 'telegram']), from: z.string().regex(/^\d{2}:\d{2}$/), to: z.string().regex(/^\d{2}:\d{2}$/) }) }),
  z.object({ type: z.literal('notify_preference'), params: z.object({ userId: z.string(), eventTypes: z.array(z.string()).min(1), channel: z.enum(['in_app', 'email']) }) }),
]);
export type AgreementInput = z.infer<typeof AgreementSchema>;

export type Agreement = {
  id: string;
  agentId: string;
  type: AgreementInput['type'];
  params: Record<string, any>;
  rationale: string;
  evidence: { type: string; id: string; note?: string }[];
  status: 'proposed' | 'active' | 'revoked' | 'rejected';
  approvedBy: string | null;
  createdAt: string;
  decidedAt: string | null;
};

function rowTo(r: any): Agreement {
  return {
    id: r.id,
    agentId: r.agent_id,
    type: r.type,
    params: json(r.params_json, {}),
    rationale: r.rationale,
    evidence: json(r.evidence_json, []),
    status: r.status,
    approvedBy: r.approved_by,
    createdAt: r.created_at,
    decidedAt: r.decided_at,
  };
}

export function listAgreements(): Agreement[] {
  return db().all(`SELECT * FROM working_agreements ORDER BY created_at DESC`).map(rowTo);
}

export function activeAgreements(type?: string): Agreement[] {
  return (type ? db().all(`SELECT * FROM working_agreements WHERE status = 'active' AND type = ?`, type) : db().all(`SELECT * FROM working_agreements WHERE status = 'active'`)).map(rowTo);
}

export function proposeAgreement(agentId: string, input: AgreementInput, rationale: string, evidence: Agreement['evidence']): Agreement {
  const parsed = AgreementSchema.parse(input);
  const dup = db().get(`SELECT id FROM working_agreements WHERE status IN ('proposed','active') AND type = ? AND params_json = ?`, parsed.type, JSON.stringify(parsed.params));
  if (dup) return getAgreement((dup as { id: string }).id);
  const aid = id('wag');
  db().run(
    `INSERT INTO working_agreements (id, agent_id, type, params_json, rationale, evidence_json, status, created_at) VALUES (?,?,?,?,?,?,'proposed',?)`,
    aid,
    agentId,
    parsed.type,
    JSON.stringify(parsed.params),
    rationale,
    JSON.stringify(evidence),
    nowIso(),
  );
  audit({ type: 'agent', id: agentId }, 'agreement.proposed', 'working_agreement', aid, { after: parsed });
  notify('agreement', 'Working agreement proposed', rationale, '/settings#agreements');
  publish('agreement.updated', { id: aid });
  return getAgreement(aid);
}

export function getAgreement(aid: string): Agreement {
  const r = db().get(`SELECT * FROM working_agreements WHERE id = ?`, aid);
  if (!r) throw notFound('Agreement not found');
  return rowTo(r);
}

/** Owner approval with a conflict check: an exclusion must not remove the last offer of an active ingredient. */
export function approveAgreement(aid: string, actor: Actor): Agreement {
  const a = getAgreement(aid);
  if (a.status !== 'proposed') throw conflict(`Agreement is ${a.status}`);
  if (a.type === 'exclude_supplier') {
    const affected = db().all<{ id: string; name: string }>(
      a.params.ingredientId ? `SELECT id, name FROM ingredients WHERE active = 1 AND id = ?` : `SELECT id, name FROM ingredients WHERE active = 1 AND category = ?`,
      a.params.ingredientId ?? a.params.category,
    );
    const otherExclusions = activeAgreements('exclude_supplier');
    for (const ing of affected) {
      const remaining = db()
        .all<{ supplier_id: string }>(`SELECT supplier_id FROM supplier_offers WHERE ingredient_id = ? AND active = 1`, ing.id)
        .filter((o) => o.supplier_id !== a.params.supplierId && !otherExclusions.some((x) => x.params.supplierId === o.supplier_id && (x.params.ingredientId === ing.id || x.params.category === a.params.category)));
      if (!remaining.length) throw unprocessable(`Conflict: this would remove the last offer for ${ing.name}`);
    }
  }
  db().run(`UPDATE working_agreements SET status = 'active', approved_by = ?, decided_at = ? WHERE id = ?`, actor.id ?? null, nowIso(), aid);
  audit(actor, 'agreement.approved', 'working_agreement', aid, { after: a.params });
  publish('agreement.updated', { id: aid });
  return getAgreement(aid);
}

export function decideAgreement(aid: string, decision: 'rejected' | 'revoked', actor: Actor): Agreement {
  const a = getAgreement(aid);
  if (decision === 'rejected' && a.status !== 'proposed') throw conflict(`Agreement is ${a.status}`);
  if (decision === 'revoked' && a.status !== 'active') throw conflict(`Agreement is ${a.status}`);
  db().run(`UPDATE working_agreements SET status = ?, decided_at = ? WHERE id = ?`, decision, nowIso(), aid);
  audit(actor, `agreement.${decision}`, 'working_agreement', aid);
  publish('agreement.updated', { id: aid });
  return getAgreement(aid);
}

export function agreementsPromptText(): string {
  const act = activeAgreements();
  if (!act.length) return 'none';
  return act.map((a) => `- ${a.type} ${JSON.stringify(a.params)} (${a.rationale})`).join('\n');
}
