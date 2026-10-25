import { z } from 'zod';
import { db } from '../../db/sqlite.js';
import { activeAgreements } from '../../services/agreements.js';
import { computeNeeds, createPlan, getPlan, offers as allOffers, suppliers as allSuppliers } from '../../services/planning.js';
import { approvePo, draftFromPlan, editLine, getPoRow, sendPo, sendReminder, setStatus, supplierAverageOrder } from '../../services/purchaseOrders.js';
import { localDate } from '../../lib/util.js';
import { ToolError, type ToolDef } from './types.js';

// Buyer tools (SRS FR-030 – FR-045, FR-070 – FR-077). Quantities always come from the engines (FR-054).
export const getReorderPlan: ToolDef<{ onlyNeeded?: boolean }> = {
  name: 'get_reorder_plan',
  description: 'Reorder needs per ingredient with the calculation trace (coverage horizon, demand, safety stock, usable stock, on order, shelf cap, status).',
  cls: 'read',
  schema: z.object({ onlyNeeded: z.boolean().optional().describe('Only ingredients with a need > 0 or not ok (default true)') }).strict(),
  execute: (a) => {
    const needs = computeNeeds();
    const rows = needs.filter((n) => a.onlyNeeded === false || n.trace.need > 0 || n.trace.status !== 'ok');
    return {
      date: localDate(),
      count: rows.length,
      items: rows.map((n) => ({
        ingredientId: n.ingredientId,
        name: n.name,
        unit: n.unit,
        need: n.trace.need,
        status: n.trace.status,
        H: n.trace.H,
        demandH: n.trace.demandH,
        safety: n.trace.safety,
        usable: n.trace.usable,
        onOrder: n.trace.onOrder,
        daysOfCover: n.trace.daysOfCover,
        flags: n.trace.flags,
        model: n.trace.model,
      })),
    };
  },
};

export const getSupplierOffers: ToolDef<{ ingredient: string }> = {
  name: 'get_supplier_offers',
  description: 'All active supplier offers for an ingredient (name or id): supplier, SKU, pack size, unit price, lead time, preferred flag, availability and working-agreement exclusions.',
  cls: 'read',
  schema: z.object({ ingredient: z.string().min(2).max(80) }).strict(),
  execute: (a) => {
    const ing =
      db().get<{ id: string; name: string; unit: string; category: string }>(`SELECT id, name, unit, category FROM ingredients WHERE id = ? OR lower(name) = lower(?)`, a.ingredient, a.ingredient) ??
      db().get<{ id: string; name: string; unit: string; category: string }>(`SELECT id, name, unit, category FROM ingredients WHERE lower(name) LIKE lower(?) ORDER BY length(name) LIMIT 1`, `%${a.ingredient}%`);
    if (!ing) throw new ToolError('unknown_ingredient', `No ingredient matches "${a.ingredient}"`);
    const sups = new Map(allSuppliers().map((s) => [s.id, s]));
    const excl = activeAgreements('exclude_supplier');
    return {
      ingredientId: ing.id,
      name: ing.name,
      unit: ing.unit,
      offers: allOffers()
        .filter((o) => o.ingredient_id === ing.id)
        .map((o) => {
          const s = sups.get(o.supplier_id)!;
          return {
            offerId: o.id,
            supplier: s.name,
            supplierId: s.id,
            sku: o.sku,
            packSize: o.pack_size,
            unitPrice: o.unit_price,
            leadTimeDays: o.lead_time_days,
            preferred: Boolean(o.preferred),
            available: !o.unavailable_until || o.unavailable_until < localDate(),
            minOrder: `${s.min_order_type} $${s.min_order_value.toFixed(2)}`,
            deliveryFee: s.delivery_fee,
            excludedByAgreement: excl.some((x) => x.params.supplierId === s.id && (x.params.ingredientId === ing.id || x.params.category === ing.category)),
          };
        }),
    };
  },
};

const optimizeSchema = z
  .object({
    scope: z.enum(['all', 'shortage']).describe('all = every ingredient with a need; shortage = cover the shortfall the supplier reported on poId'),
    poId: z.string().optional().describe('Required for scope=shortage'),
    ingredientIds: z.array(z.string()).max(40).optional().describe('Optional: restrict scope=all to these ingredients'),
  })
  .strict();

/** Shortfalls are derived by code from the supplier's response (need − confirmed), never passed by the model. */
export function shortagesFor(poId: string): { ingredientId: string; shortfall: number; offerId: string }[] {
  const lines = db().all<{ ingredient_id: string; need: number; confirmed_qty: number | null; unavailable: number; offer_id: string; substitute_json: string | null }>(`SELECT * FROM po_lines WHERE purchase_order_id = ? AND packs > 0`, poId);
  return lines
    .filter((l) => l.unavailable || (l.confirmed_qty !== null && l.confirmed_qty < l.need))
    .map((l) => ({ ingredientId: l.ingredient_id, shortfall: Math.round((l.need - (l.unavailable ? 0 : (l.confirmed_qty ?? 0))) * 1000) / 1000, offerId: l.offer_id }))
    .filter((s) => s.shortfall > 0);
}

export const optimizeOrder: ToolDef<z.infer<typeof optimizeSchema>> = {
  name: 'optimize_order',
  description: 'Run the multi-supplier optimiser (MILP, verified; greedy fallback) on the current needs or on a supplier shortage. Returns a planId, the split per supplier, total landed cost, baseline and saving.',
  cls: 'compute',
  schema: optimizeSchema,
  execute: async (a) => {
    let plan;
    if (a.scope === 'shortage') {
      if (!a.poId) throw new ToolError('missing_po', 'poId is required for scope=shortage');
      const po = getPoRow(a.poId);
      const short = shortagesFor(a.poId);
      if (!short.length) return { planId: null, message: 'No shortfall on this order' };
      plan = await createPlan({ trigger: `shortage:${po.number}`, needsOverride: short.map((s) => ({ ingredientId: s.ingredientId, need: s.shortfall })), excludeOfferIds: short.map((s) => s.offerId) });
    } else {
      const needs = a.ingredientIds?.length ? computeNeeds().filter((n) => a.ingredientIds!.includes(n.ingredientId)).map((n) => ({ ingredientId: n.ingredientId, need: n.trace.need })) : undefined;
      plan = await createPlan({ trigger: 'plan', needsOverride: needs });
    }
    const supName = new Map(allSuppliers().map((s) => [s.id, s.name]));
    return {
      planId: plan.id,
      method: plan.method,
      fallbackReason: plan.fallbackReason,
      total: plan.solution.total,
      baselineTotal: plan.baseline.total,
      saving: plan.saving,
      savingPct: plan.savingPct,
      violations: plan.violations,
      suppliers: plan.solution.suppliers.map((s) => ({ supplier: s.name, subtotal: s.subtotal, fees: s.deliveryFee + s.belowMinFee, total: s.total, lines: plan.solution.lines.filter((l) => l.supplierId === s.supplierId).length })),
      lines: plan.solution.lines.slice(0, 25).map((l) => ({ ingredientId: l.ingredientId, supplier: supName.get(l.supplierId), sku: l.sku, packs: l.packs, qty: l.qty, lineTotal: l.lineTotal, why: plan.explanations[l.ingredientId] })),
      summary: plan.explanations._summary,
      excludedByAgreements: plan.excludedByAgreements.length,
    };
  },
};

export const draftPurchaseOrders: ToolDef<{ planId: string }> = {
  name: 'draft_purchase_orders',
  description: 'Create draft purchase orders (one per supplier) from an optimiser planId. Quantities are taken from the plan.',
  cls: 'act',
  schema: z.object({ planId: z.string() }).strict(),
  actionType: () => 'draft_purchase_orders',
  prepare: (a) => {
    const plan = getPlan(a.planId);
    if (!plan) throw new ToolError('unknown_plan', 'Plan not found');
    if (plan.violations.length) throw new ToolError('plan_infeasible', `Plan violates constraints (${plan.violations.join('; ')}) — ask a human instead of drafting`);
    const sups = plan.solution.suppliers.map((s) => `${s.name} $${s.total.toFixed(2)}`).join(', ');
    const supplementary = plan.trigger.startsWith('shortage:');
    return {
      summary: supplementary ? `Create and send supplementary PO for ${plan.trigger.slice(9)} shortfall: ${sups}` : `Draft ${plan.solution.suppliers.length} PO(s): ${sups} (saving $${plan.saving.toFixed(2)} vs preferred suppliers)`,
      facts: { total: plan.solution.total },
    };
  },
  execute: (a, ctx) => {
    const plan = getPlan(a.planId)!;
    const supplementary = plan.trigger.startsWith('shortage:');
    const parent = supplementary ? db().get<{ id: string }>(`SELECT id FROM purchase_orders WHERE number = ?`, plan.trigger.slice(9))?.id : undefined;
    const pos = draftFromPlan(a.planId, ctx.actor, { supersede: !supplementary, parentPoId: parent });
    // A human approved "create and send" for a supplementary order: approve it under their authority and send it.
    if (supplementary && ctx.approver) {
      for (const po of pos) {
        approvePo(po.id, ctx.approver);
        sendPo(po.id, { type: 'user', id: ctx.approver.id });
      }
    }
    return { purchaseOrders: pos.map((p) => ({ poId: p.id, number: p.number, supplierId: p.supplier_id, total: p.total, saving: p.saving, status: supplementary && ctx.approver ? 'approved_sending' : p.status, minimumWarning: p.min_order_warning })) };
  },
};

const changeSchema = z.object({ poId: z.string(), lineId: z.string(), packs: z.number().int().min(0).max(1000), reason: z.string().min(3).max(300) }).strict();
export const proposePoChange: ToolDef<z.infer<typeof changeSchema>> = {
  name: 'propose_po_change',
  description: 'Propose changing the number of packs on a draft PO line (0 removes it). The engines re-validate totals and minimums; a human approves.',
  cls: 'act',
  schema: changeSchema,
  prepare: (a) => {
    const po = getPoRow(a.poId);
    if (po.status !== 'draft') throw new ToolError('not_draft', `${po.number} is ${po.status}; only drafts can change`);
    const line = db().get<{ packs: number; pack_size: number; unit_price: number; ingredient_id: string }>(`SELECT * FROM po_lines WHERE id = ? AND purchase_order_id = ?`, a.lineId, a.poId);
    if (!line) throw new ToolError('unknown_line', 'Line not on this PO');
    const name = db().get<{ name: string }>(`SELECT name FROM ingredients WHERE id = ?`, line.ingredient_id)!.name;
    return { summary: `${po.number}: change ${name} from ${line.packs} to ${a.packs} packs — ${a.reason}`, facts: { total: po.total + (a.packs - line.packs) * line.pack_size * line.unit_price } };
  },
  execute: (a, ctx) => {
    const po = editLine(a.poId, a.lineId, { packs: a.packs, note: a.reason }, ctx.approver ? { type: 'user', id: ctx.approver.id } : ctx.actor);
    return { poId: po.id, number: po.number, total: po.total, saving: po.saving, minimumWarning: po.min_order_warning };
  },
};

export const sendPurchaseOrder: ToolDef<{ poId: string }> = {
  name: 'send_purchase_order',
  description: 'Send a purchase order to its supplier by email with a portal link. Usually requires human approval (autonomy policy).',
  cls: 'act',
  schema: z.object({ poId: z.string() }).strict(),
  prepare: (a) => {
    const po = getPoRow(a.poId);
    if (!['draft', 'pending_approval', 'approved'].includes(po.status)) throw new ToolError('invalid_status', `${po.number} is ${po.status}`);
    if (po.min_order_warning) throw new ToolError('below_minimum', po.min_order_warning);
    const sup = db().get<{ name: string; trusted: number }>(`SELECT name, trusted FROM suppliers WHERE id = ?`, po.supplier_id)!;
    return {
      summary: `Approve and send ${po.number} to ${sup.name} — $${po.total.toFixed(2)}${(po.saving ?? 0) > 0 ? ` (saves $${po.saving!.toFixed(2)})` : ''}`,
      facts: { total: po.total, supplierTrusted: Boolean(sup.trusted), supplierAverage: supplierAverageOrder(po.supplier_id) },
    };
  },
  onProposed: (a) => {
    const po = getPoRow(a.poId);
    if (po.status === 'draft') setStatus(a.poId, 'pending_approval', { type: 'agent', id: 'buyer' });
  },
  onRejected: (a, reason, actor) => {
    const po = getPoRow(a.poId);
    if (po.status === 'pending_approval') setStatus(a.poId, 'draft', actor, { reason });
  },
  execute: (a, ctx) => {
    const po = getPoRow(a.poId);
    if (po.status !== 'approved') approvePo(a.poId, ctx.approver ?? { agentId: ctx.run.agentId, byPolicy: 'auto_send_rule' });
    const r = sendPo(a.poId, ctx.approver ? { type: 'user', id: ctx.approver.id } : ctx.actor);
    return { poId: a.poId, number: po.number, status: 'sending', emailId: r.emailId };
  },
};

export const sendSupplierFollowup: ToolDef<{ poId: string }> = {
  name: 'send_supplier_followup',
  description: 'Send the one allowed reminder to a supplier that has not confirmed a sent PO by its deadline; a second miss escalates to the chef only.',
  cls: 'act',
  schema: z.object({ poId: z.string() }).strict(),
  prepare: (a) => {
    const po = getPoRow(a.poId);
    if (po.status !== 'sent') throw new ToolError('not_waiting', `${po.number} is ${po.status}; no follow-up needed`);
    return { summary: `${po.reminders_sent ? 'Escalate' : 'Remind supplier about'} ${po.number}` };
  },
  execute: (a, ctx) => sendReminder(a.poId, ctx.actor),
};
