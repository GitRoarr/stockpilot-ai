import { describe, expect, it } from 'vitest';
import { computeNeed, expiryRisks } from './reorder.js';

describe('computeNeed (Solution Design §D2.2)', () => {
  it('reproduces the beef patty worked example (AC-031)', () => {
    const t = computeNeed({
      ingredientId: 'ing_beef_patty',
      demandByDay: [30, 41, 32, 35],
      H: 3,
      leadTimeDays: 1,
      safetyDays: 1,
      serviceLevel: 0.95,
      sigmaH: 12.0,
      usable: 45,
      onOrder: 0,
      perishable: true,
      shelfLifeDays: 4,
    });
    expect(t.demandH).toBe(103);
    expect(t.avgDaily).toBe(34.3);
    expect(t.safetyStatTerm).toBe(19.7);
    expect(t.safety).toBe(34.3);
    expect(t.need).toBe(92.3);
    expect(t.flags).toEqual([]);
  });

  it('uses the statistical term when it dominates the safety-days floor', () => {
    const t = computeNeed({
      ingredientId: 'x', demandByDay: [10, 10], H: 2, leadTimeDays: 1, safetyDays: 0.5, serviceLevel: 0.95,
      sigmaH: 10, usable: 0, onOrder: 0, perishable: false, shelfLifeDays: 30,
    });
    expect(t.safety).toBe(16.4);
    expect(t.need).toBe(36.4);
  });

  it('caps perishables by shelf-life usage and flags it', () => {
    const t = computeNeed({
      ingredientId: 'x', demandByDay: [10, 10, 10], H: 3, leadTimeDays: 1, safetyDays: 1, serviceLevel: 0.95,
      sigmaH: 0, usable: 0, onOrder: 0, perishable: true, shelfLifeDays: 1,
    });
    expect(t.shelfCap).toBe(20);
    expect(t.need).toBe(20);
    expect(t.flags).toContain('capped_by_shelf_life');
  });

  it('classifies critical and low stock', () => {
    const base = { ingredientId: 'x', demandByDay: [10, 10], H: 2, leadTimeDays: 1, safetyDays: 1, serviceLevel: 0.95, sigmaH: 0, onOrder: 0, perishable: false, shelfLifeDays: 30 };
    expect(computeNeed({ ...base, usable: 5 }).status).toBe('critical');
    expect(computeNeed({ ...base, usable: 15 }).status).toBe('low');
    expect(computeNeed({ ...base, usable: 25 }).status).toBe('ok');
  });
});

describe('expiryRisks (FR-035)', () => {
  it('reports the unused remainder of a batch expiring inside the window', () => {
    // 2 lb basil expiring in 2 days, 0.25 lb/day demand → 0.5 lb used, 1.5 lb at risk.
    const r = expiryRisks([{ id: 'b1', qty: 2, expiresAt: '2026-10-26' }], [0.25, 0.25, 0.25, 0.25], '2026-10-24', 3);
    expect(r).toEqual([{ batchId: 'b1', expiresAt: '2026-10-26', qty: 2, projectedUse: 0.5, atRisk: 1.5 }]);
  });

  it('consumes the earliest-expiring batch first and ignores batches outside the window', () => {
    const r = expiryRisks(
      [
        { id: 'late', qty: 5, expiresAt: '2026-11-10' },
        { id: 'soon', qty: 1, expiresAt: '2026-10-25' },
      ],
      [2, 2, 2],
      '2026-10-24',
      3,
    );
    expect(r).toEqual([]);
  });
});
