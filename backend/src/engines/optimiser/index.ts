import { buildLp } from './model.js';
import { buildPlan, r2 } from './plan.js';
import { greedyPlan } from './greedy.js';
import { verifyPlan } from './verifier.js';
import type { OptimiserInput, Plan, Solver } from './types.js';

export * from './types.js';
export { verifyPlan } from './verifier.js';
export { greedyPlan } from './greedy.js';

const EPS = 1e-6;

/** Baseline (FR-044): every ingredient from its preferred offer (cheapest line if none preferred), same needs and fees. */
export function baselinePlan(input: OptimiserInput): Plan {
  const packs = new Map<string, number>();
  for (const n of input.needs) {
    if (n.need <= 0) continue;
    const os = input.offers.filter((o) => o.ingredientId === n.ingredientId);
    if (!os.length) continue;
    const o =
      os.find((x) => x.preferred) ??
      [...os].sort((a, b) => Math.ceil(n.need / a.packSize - EPS) * a.packSize * a.unitPrice - Math.ceil(n.need / b.packSize - EPS) * b.packSize * b.unitPrice)[0];
    packs.set(o.id, Math.max(1, Math.ceil(n.need / o.packSize - EPS)));
  }
  // A baseline that misses a hard minimum is not something a buyer could place: top that supplier up with the
  // cheapest additional packs of its own lines, within the overbuy caps, as a human would.
  const offers = new Map(input.offers.map((o) => [o.id, o]));
  for (const sup of input.suppliers.filter((x) => x.minOrderType === 'hard' && x.minOrderValue > 0)) {
    for (let guard = 0; guard < 200; guard++) {
      const sub = [...packs].filter(([id]) => offers.get(id)?.supplierId === sup.id).reduce((a, [id, k]) => a + k * offers.get(id)!.packSize * offers.get(id)!.unitPrice, 0);
      if (sub === 0 || sub + EPS >= sup.minOrderValue) break;
      const options = [...packs]
        .map(([id, k]) => ({ id, k, o: offers.get(id)! }))
        .filter(({ o }) => o.supplierId === sup.id)
        .filter(({ id, k, o }) => {
          const n = input.needs.find((x) => x.ingredientId === o.ingredientId)!;
          return (k + 1) * o.packSize <= n.need + n.cap + EPS && id;
        })
        .sort((a, b) => a.o.packSize * a.o.unitPrice - b.o.packSize * b.o.unitPrice);
      if (!options.length) break;
      packs.set(options[0].id, options[0].k + 1);
    }
  }
  const plan = buildPlan(input, packs, 'baseline');
  plan.violations = verifyPlan(input, plan);
  return plan;
}

export type OptimiseOptions = { solver?: Solver };

/**
 * optimise (FR-040 – FR-045): MILP → verifier → greedy fallback (→ verifier). If nothing is feasible, the closest plan
 * is returned with its violations listed for a human decision.
 */
export async function optimise(input: OptimiserInput, opts: OptimiseOptions = {}): Promise<Plan> {
  const needs = input.needs.filter((n) => n.need > 0);
  if (!needs.length) return { lines: [], suppliers: [], total: 0, method: 'milp', violations: [] };
  const uncovered = needs.filter((n) => !input.offers.some((o) => o.ingredientId === n.ingredientId)).map((n) => `${n.name}: no feasible offer`);

  let fallbackReason: string | undefined;
  try {
    const solver = opts.solver ?? (await import('./highs.js')).highsSolver;
    const model = buildLp(input);
    const res = await solver(model.lp);
    if (res.status === 'Optimal') {
      const packs = new Map<string, number>();
      for (const [col, offerId] of model.x) packs.set(offerId, Math.round(res.columns[col] ?? 0));
      const plan = buildPlan(input, packs, 'milp');
      const violations = verifyPlan(input, plan);
      if (!violations.length && !uncovered.length) return plan;
      fallbackReason = violations.length ? `verifier_rejected: ${violations[0]}` : 'uncovered_ingredients';
    } else {
      fallbackReason = res.status === 'Infeasible' ? 'infeasible' : `solver_status: ${res.status}`;
    }
  } catch (e) {
    fallbackReason = `solver_error: ${(e as Error).message}`;
  }

  const plan = greedyPlan(input);
  plan.violations = [...uncovered, ...verifyPlan(input, plan)];
  plan.fallbackReason = fallbackReason;
  return plan;
}

/** Per-ingredient explanation of the choice vs. the baseline (FR-044). */
export function explainPlan(input: OptimiserInput, plan: Plan, baseline: Plan): Record<string, string> {
  const sup = new Map(input.suppliers.map((s) => [s.id, s.name]));
  const out: Record<string, string> = {};
  for (const l of plan.lines) {
    const b = baseline.lines.find((x) => x.ingredientId === l.ingredientId);
    const name = sup.get(l.supplierId) ?? l.supplierId;
    if (!b || b.offerId === l.offerId) {
      out[l.ingredientId] = `${name} (preferred offer): ${l.packs} × ${l.packSize} at $${l.unitPrice.toFixed(2)}`;
      continue;
    }
    const diff = r2(b.unitPrice - l.unitPrice);
    out[l.ingredientId] =
      diff > 0
        ? `${name}: $${diff.toFixed(2)}/unit cheaper than ${sup.get(b.supplierId)} (preferred)`
        : `${name}: $${Math.abs(diff).toFixed(2)}/unit dearer than ${sup.get(b.supplierId)}, but lower total landed cost (fees/minimums)`;
  }
  const feeLine =
    plan.suppliers.length < baseline.suppliers.length
      ? `${plan.suppliers.length === 1 ? 'one delivery' : `${plan.suppliers.length} deliveries`} instead of ${baseline.suppliers.length}`
      : undefined;
  if (feeLine) out._summary = feeLine;
  return out;
}
