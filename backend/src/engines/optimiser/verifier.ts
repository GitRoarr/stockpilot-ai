import { r2 } from './plan.js';
import type { OptimiserInput, Plan } from './types.js';

const EPS = 1e-6;

/**
 * Independent verifier (FR-043): recomputes every constraint and the cost from the raw offers.
 * Returns the list of violations; an empty list means the plan is valid.
 */
export function verifyPlan(input: OptimiserInput, plan: Plan): string[] {
  const v: string[] = [];
  const offers = new Map(input.offers.map((o) => [o.id, o]));
  const suppliers = new Map(input.suppliers.map((s) => [s.id, s]));
  const qtyByIng = new Map<string, number>();
  const subBySup = new Map<string, number>();

  for (const l of plan.lines) {
    const o = offers.get(l.offerId);
    if (!o) {
      v.push(`line uses unknown or excluded offer ${l.offerId}`);
      continue;
    }
    if (!Number.isInteger(l.packs) || l.packs < 0) v.push(`${o.sku}: packs must be a whole number ≥ 0`);
    if (o.supplierId !== l.supplierId || o.ingredientId !== l.ingredientId) v.push(`${o.sku}: supplier/ingredient mismatch`);
    if (Math.abs(l.unitPrice - o.unitPrice) > EPS) v.push(`${o.sku}: unit price differs from offer`);
    const qty = l.packs * o.packSize;
    if (Math.abs(qty - l.qty) > 1e-3) v.push(`${o.sku}: quantity ≠ packs × pack size`);
    const lineTotal = r2(qty * o.unitPrice);
    if (Math.abs(lineTotal - l.lineTotal) > 0.005) v.push(`${o.sku}: line total arithmetic`);
    qtyByIng.set(o.ingredientId, (qtyByIng.get(o.ingredientId) ?? 0) + qty);
    subBySup.set(o.supplierId, r2((subBySup.get(o.supplierId) ?? 0) + lineTotal));
  }

  for (const n of input.needs) {
    if (n.need <= 0) continue;
    const q = qtyByIng.get(n.ingredientId) ?? 0;
    if (q + EPS < n.need) v.push(`${n.name}: coverage ${round(q)} < need ${round(n.need)}`);
    if (q > n.need + n.cap + EPS) v.push(`${n.name}: ${round(q)} exceeds overbuy cap ${round(n.need + n.cap)}`);
  }

  let total = 0;
  for (const [sid, sub] of subBySup) {
    const s = suppliers.get(sid);
    if (!s) {
      v.push(`unknown supplier ${sid}`);
      continue;
    }
    if (s.minOrderType === 'hard' && sub + EPS < s.minOrderValue) v.push(`${s.name}: order $${sub.toFixed(2)} below hard minimum $${s.minOrderValue.toFixed(2)}`);
    const fee = s.minOrderType === 'soft' && sub + EPS < s.minOrderValue ? s.belowMinFee : 0;
    const ps = plan.suppliers.find((p) => p.supplierId === sid);
    const expected = r2(sub + s.deliveryFee + fee);
    if (!ps || Math.abs(ps.total - expected) > 0.005) v.push(`${s.name}: supplier total arithmetic`);
    total += expected;
  }
  if (Math.abs(r2(total) - plan.total) > 0.005) v.push(`plan total $${plan.total.toFixed(2)} ≠ recomputed $${r2(total).toFixed(2)}`);
  return v;
}

const round = (n: number) => Math.round(n * 10) / 10;
