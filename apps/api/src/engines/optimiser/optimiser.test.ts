import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { baselinePlan, explainPlan, greedyPlan, optimise, verifyPlan, type OptimiserInput, type Solver } from './index.js';
import { buildLp } from './model.js';

// Worked example, Solution Design §D2.4 [Illustrative demo data].
const suppliers: OptimiserInput['suppliers'] = [
  { id: 'bay', name: 'Bay Meat Supply', minOrderValue: 200, minOrderType: 'soft', belowMinFee: 15, deliveryFee: 0 },
  { id: 'gg', name: 'Golden Gate Foodservice', minOrderValue: 60, minOrderType: 'hard', belowMinFee: 0, deliveryFee: 25 },
];
const offers: OptimiserInput['offers'] = [
  { id: 'o-bm-pat', supplierId: 'bay', ingredientId: 'patty', sku: 'BM-PAT6', packSize: 24, unitPrice: 1.65, preferred: true },
  { id: 'o-gg-pat', supplierId: 'gg', ingredientId: 'patty', sku: 'GG-44120', packSize: 48, unitPrice: 1.52, preferred: false },
  { id: 'o-bm-ctb', supplierId: 'bay', ingredientId: 'chicken', sku: 'BM-CTB', packSize: 10, unitPrice: 3.4, preferred: true },
  { id: 'o-gg-ctb', supplierId: 'gg', ingredientId: 'chicken', sku: 'GG-23310', packSize: 40, unitPrice: 3.25, preferred: false },
  { id: 'o-gg-fry', supplierId: 'gg', ingredientId: 'fries', sku: 'GG-81002', packSize: 30, unitPrice: 1.1, preferred: true },
];
const example: OptimiserInput = {
  suppliers,
  offers,
  needs: [
    { ingredientId: 'patty', name: 'Beef patty 6 oz', need: 92.3, cap: 30 },
    { ingredientId: 'chicken', name: 'Chicken thigh, boneless', need: 38.0, cap: 15 },
    { ingredientId: 'fries', name: 'Fries 3/8" frozen', need: 41.0, cap: 40 },
  ],
};

describe('optimiser — AC-040 worked example', () => {
  it('buys all three items from Golden Gate for $366.92', async () => {
    const plan = await optimise(example);
    expect(plan.method).toBe('milp');
    expect(plan.violations).toEqual([]);
    expect(plan.total).toBe(366.92);
    expect(plan.lines.every((l) => l.supplierId === 'gg')).toBe(true);
    expect(plan.lines.map((l) => [l.sku, l.qty, l.lineTotal]).sort()).toEqual(
      [
        ['GG-23310', 40, 130],
        ['GG-44120', 96, 145.92],
        ['GG-81002', 60, 66],
      ].sort(),
    );
    expect(verifyPlan(example, plan)).toEqual([]);
  });

  it('baseline is $385.40 and the saving $18.48', async () => {
    const base = baselinePlan(example);
    expect(base.total).toBe(385.4);
    const plan = await optimise(example);
    expect(Math.round((base.total - plan.total) * 100) / 100).toBe(18.48);
    const why = explainPlan(example, plan, base);
    expect(why.patty).toContain('$0.13/unit cheaper');
    expect(why._summary).toContain('one delivery instead of 2');
  });

  it('shortage replan: 8.0 lb chicken without Golden Gate chicken → Bay Meat 1 × 10 lb + $15 fee = $49.00 (AC-076)', async () => {
    const input: OptimiserInput = {
      suppliers,
      offers: offers.filter((o) => o.id !== 'o-gg-ctb'),
      needs: [{ ingredientId: 'chicken', name: 'Chicken thigh, boneless', need: 8.0, cap: 15 }],
    };
    const plan = await optimise(input);
    expect(plan.violations).toEqual([]);
    expect(plan.lines).toHaveLength(1);
    expect(plan.lines[0]).toMatchObject({ sku: 'BM-CTB', packs: 1, lineTotal: 34 });
    expect(plan.suppliers[0]).toMatchObject({ belowMinFee: 15, total: 49 });
    expect(plan.total).toBe(49);
  });

  it('greedy heuristic finds the same plan on the worked example', () => {
    const plan = greedyPlan(example);
    expect(plan.method).toBe('heuristic');
    expect(plan.total).toBe(366.92);
  });
});

describe('optimiser — AC-042 verifier rejects an invalid solver result', () => {
  it('uses the greedy fallback when the mocked solution violates a hard minimum', async () => {
    const model = buildLp(example);
    // Mocked solver: fries alone from Golden Gate would be $33 < $60 hard minimum.
    const bad: Solver = async () => {
      const columns: Record<string, number> = {};
      for (const [col, offerId] of model.x) columns[col] = offerId === 'o-bm-pat' ? 4 : offerId === 'o-bm-ctb' ? 4 : 0;
      for (const [col, offerId] of model.x) if (offerId === 'o-gg-fry') columns[col] = 1;
      return { status: 'Optimal', columns };
    };
    const plan = await optimise({ ...example, needs: example.needs.map((n) => (n.ingredientId === 'fries' ? { ...n, need: 20 } : n)) }, { solver: bad });
    expect(plan.method).toBe('heuristic');
    expect(plan.fallbackReason).toMatch(/verifier_rejected/);
    expect(plan.violations).toEqual([]);
  });

  it('falls back when the solver throws', async () => {
    const plan = await optimise(example, { solver: async () => Promise.reject(new Error('wasm unavailable')) });
    expect(plan.method).toBe('heuristic');
    expect(plan.fallbackReason).toContain('wasm unavailable');
    expect(plan.total).toBe(366.92);
  });
});

describe('baseline respects hard minimums', () => {
  it('tops up a preferred supplier below its hard minimum instead of reporting an impossible baseline', () => {
    const input: OptimiserInput = {
      suppliers: [{ id: 'pd', name: 'Pacific Dry Goods', minOrderValue: 100, minOrderType: 'hard', belowMinFee: 0, deliveryFee: 0 }],
      offers: [
        { id: 'flour', supplierId: 'pd', ingredientId: 'flour', sku: 'F', packSize: 50, unitPrice: 0.62, preferred: true },
        { id: 'oil', supplierId: 'pd', ingredientId: 'oil', sku: 'O', packSize: 4, unitPrice: 28, preferred: true },
      ],
      needs: [
        { ingredientId: 'flour', name: 'Flour', need: 20, cap: 200 },
        { ingredientId: 'oil', name: 'Oil', need: 2, cap: 10 },
      ],
    };
    const base = baselinePlan(input);
    expect(base.violations).toEqual([]);
    expect(base.total).toBeGreaterThanOrEqual(100);
  });
});

describe('optimiser — AC-045 infeasible needs', () => {
  it('returns the closest plan with violated constraints', async () => {
    const input: OptimiserInput = {
      suppliers: [{ id: 'gg', name: 'Golden Gate Foodservice', minOrderValue: 500, minOrderType: 'hard', belowMinFee: 0, deliveryFee: 25 }],
      offers: [offers[4]],
      needs: [{ ingredientId: 'fries', name: 'Fries', need: 10, cap: 25 }],
    };
    const plan = await optimise(input);
    expect(plan.method).toBe('heuristic');
    expect(plan.fallbackReason).toBe('infeasible');
    expect(plan.violations.some((v) => v.includes('below hard minimum'))).toBe(true);
  });

  it('reports an ingredient without any offer', async () => {
    const plan = await optimise({ ...example, needs: [...example.needs, { ingredientId: 'saffron', name: 'Saffron', need: 1, cap: 1 }] });
    expect(plan.violations).toContain('Saffron: no feasible offer');
  });
});

describe('optimiser — property: every returned plan passes the verifier or lists its violations', () => {
  const arb = fc.record({
    nIng: fc.integer({ min: 1, max: 5 }),
    nSup: fc.integer({ min: 1, max: 3 }),
    seed: fc.array(fc.double({ min: 0.05, max: 0.95, noNaN: true }), { minLength: 60, maxLength: 60 }),
  });
  it('holds for random instances', async () => {
    await fc.assert(
      fc.asyncProperty(arb, async ({ nIng, nSup, seed }) => {
        let k = 0;
        const r = () => seed[k++ % seed.length];
        const sups = Array.from({ length: nSup }, (_, s) => ({
          id: `s${s}`,
          name: `S${s}`,
          minOrderValue: Math.round(r() * 150),
          minOrderType: (r() > 0.5 ? 'hard' : 'soft') as 'hard' | 'soft',
          belowMinFee: Math.round(r() * 20),
          deliveryFee: Math.round(r() * 30),
        }));
        const offs: OptimiserInput['offers'] = [];
        const needs: OptimiserInput['needs'] = [];
        for (let i = 0; i < nIng; i++) {
          needs.push({ ingredientId: `i${i}`, name: `I${i}`, need: Math.round(r() * 60 * 10) / 10 + 1, cap: Math.round(r() * 40) + 10 });
          for (const s of sups)
            if (r() > 0.3) offs.push({ id: `o${i}${s.id}`, supplierId: s.id, ingredientId: `i${i}`, sku: `K${i}${s.id}`, packSize: [1, 5, 10, 24][Math.floor(r() * 4)], unitPrice: Math.round(r() * 500) / 100 + 0.1, preferred: false });
        }
        const input = { suppliers: sups, offers: offs, needs };
        const plan = await optimise(input);
        const v = verifyPlan(input, plan);
        // Either valid, or the plan honestly reports what it violates.
        return v.length === 0 ? plan.method === 'milp' || plan.violations.length === 0 : plan.violations.length > 0;
      }),
      { numRuns: 60 },
    );
  });

  it('MILP is never worse than greedy', async () => {
    const plan = await optimise(example);
    expect(plan.total).toBeLessThanOrEqual(greedyPlan(example).total);
  });
});
