import type { OptimiserInput, Plan, PlanLine, PlanMethod, PlanSupplier } from './types.js';

export const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const EPS = 1e-6;

/** Builds a plan (costs, fees, totals) from pack counts per offer. Fees follow the supplier terms. */
export function buildPlan(input: OptimiserInput, packsByOffer: Map<string, number>, method: PlanMethod): Plan {
  const offers = new Map(input.offers.map((o) => [o.id, o]));
  const lines: PlanLine[] = [];
  for (const [offerId, packs] of packsByOffer) {
    if (packs <= 0) continue;
    const o = offers.get(offerId);
    if (!o) continue;
    const qty = packs * o.packSize;
    lines.push({
      offerId,
      supplierId: o.supplierId,
      ingredientId: o.ingredientId,
      sku: o.sku,
      packs,
      packSize: o.packSize,
      qty: Math.round(qty * 1000) / 1000,
      unitPrice: o.unitPrice,
      lineTotal: r2(qty * o.unitPrice),
    });
  }
  const suppliers: PlanSupplier[] = [];
  for (const s of input.suppliers) {
    const sl = lines.filter((l) => l.supplierId === s.id);
    if (!sl.length) continue;
    const subtotal = r2(sl.reduce((a, l) => a + l.lineTotal, 0));
    const belowMinFee = s.minOrderType === 'soft' && subtotal + EPS < s.minOrderValue ? s.belowMinFee : 0;
    suppliers.push({ supplierId: s.id, name: s.name, subtotal, deliveryFee: s.deliveryFee, belowMinFee, total: r2(subtotal + s.deliveryFee + belowMinFee) });
  }
  const total = r2(suppliers.reduce((a, s) => a + s.total, 0));
  return { lines, suppliers, total, method, violations: [] };
}

export function packsMap(plan: Plan): Map<string, number> {
  return new Map(plan.lines.map((l) => [l.offerId, l.packs]));
}
