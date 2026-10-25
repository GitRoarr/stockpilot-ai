import { buildPlan } from './plan.js';
import type { OfferInput, OptimiserInput, Plan } from './types.js';

const EPS = 1e-6;
const PENALTY = 1e6;

type Candidate = { offer: OfferInput; packs: number; withinCap: boolean };

function candidates(input: OptimiserInput, ingredientId: string, need: number, cap: number): Candidate[] {
  return input.offers
    .filter((o) => o.ingredientId === ingredientId)
    .map((offer) => {
      const packs = Math.max(1, Math.ceil(need / offer.packSize - EPS));
      return { offer, packs, withinCap: packs * offer.packSize <= need + cap + EPS };
    });
}

/** Objective with fees and a large penalty for hard-minimum shortfalls, so repairs are preferred. */
function score(input: OptimiserInput, choice: Map<string, Candidate>): number {
  const sub = new Map<string, number>();
  let cost = 0;
  for (const c of choice.values()) {
    const line = c.packs * c.offer.packSize * c.offer.unitPrice;
    cost += line * (c.offer.objectiveFactor ?? 1) + (c.withinCap ? 0 : PENALTY);
    sub.set(c.offer.supplierId, (sub.get(c.offer.supplierId) ?? 0) + line);
  }
  for (const s of input.suppliers) {
    const v = sub.get(s.id);
    if (v === undefined) continue;
    cost += s.deliveryFee;
    if (v + EPS < s.minOrderValue) cost += s.minOrderType === 'soft' ? s.belowMinFee : PENALTY;
  }
  return cost;
}

/**
 * Deterministic greedy heuristic (FR-042 fallback): cheapest line per ingredient, then local search that moves single
 * lines or whole suppliers while the landed cost (fees included, hard-minimum shortfalls penalised) improves.
 */
export function greedyPlan(input: OptimiserInput): Plan {
  const needs = input.needs.filter((n) => n.need > 0);
  const cands = new Map(needs.map((n) => [n.ingredientId, candidates(input, n.ingredientId, n.need, n.cap)]));
  const choice = new Map<string, Candidate>();
  for (const n of needs) {
    const cs = cands.get(n.ingredientId)!;
    if (!cs.length) continue;
    const best = [...cs].sort(
      (a, b) =>
        Number(b.withinCap) - Number(a.withinCap) ||
        a.packs * a.offer.packSize * a.offer.unitPrice - b.packs * b.offer.packSize * b.offer.unitPrice ||
        a.offer.id.localeCompare(b.offer.id),
    )[0];
    choice.set(n.ingredientId, best);
  }

  let current = score(input, choice);
  for (let iter = 0; iter < 100; iter++) {
    let bestMove: Map<string, Candidate> | undefined;
    let bestScore = current;
    // Single-line moves.
    for (const [ing, cs] of cands) {
      for (const c of cs) {
        if (choice.get(ing)?.offer.id === c.offer.id) continue;
        const next = new Map(choice).set(ing, c);
        const s = score(input, next);
        if (s < bestScore - EPS) {
          bestScore = s;
          bestMove = next;
        }
      }
    }
    // Move every line of one supplier to the next-best supplier for each ingredient.
    for (const sup of input.suppliers) {
      const next = new Map(choice);
      let moved = false;
      for (const [ing, c] of choice) {
        if (c.offer.supplierId !== sup.id) continue;
        const alts = cands.get(ing)!.filter((a) => a.offer.supplierId !== sup.id);
        if (!alts.length) continue;
        const alt = alts.sort((a, b) => a.packs * a.offer.packSize * a.offer.unitPrice - b.packs * b.offer.packSize * b.offer.unitPrice)[0];
        next.set(ing, alt);
        moved = true;
      }
      if (!moved) continue;
      const s = score(input, next);
      if (s < bestScore - EPS) {
        bestScore = s;
        bestMove = next;
      }
    }
    if (!bestMove) break;
    choice.clear();
    for (const [k, c] of bestMove) choice.set(k, c);
    current = bestScore;
  }

  return buildPlan(input, new Map([...choice.values()].map((c) => [c.offer.id, c.packs])), 'heuristic');
}
