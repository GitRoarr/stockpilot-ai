import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { matchLines, normalizeDescription, tokens } from './matcher.js';
import { arithmeticIssues, threeWayMatch } from './variance.js';
import { checkGrounding, extractNumbers } from './grounding.js';

describe('matcher (FR-084)', () => {
  const po = [
    { id: 'pl1', sku: 'GG-44120', description: 'Beef patty 6 oz', offerId: 'o1' },
    { id: 'pl2', sku: 'GG-23310', description: 'Chicken thigh, boneless', offerId: 'o2' },
    { id: 'pl3', sku: 'GG-81002', description: 'Fries 3/8" frozen', offerId: 'o3' },
  ];
  it('matches by SKU, then by description similarity, else unmatched', () => {
    const res = matchLines(
      [
        { index: 0, description: 'PATTY BEEF 6OZ', sku: 'GG-44120' },
        { index: 1, description: 'Chicken Thigh Boneless 40 lb', sku: null },
        { index: 2, description: 'Truffle oil', sku: 'GG-99999' },
      ],
      po,
    );
    expect(res.map((r) => [r.poLineId, r.method])).toEqual([
      ['pl1', 'sku'],
      ['pl2', 'similarity'],
      [null, 'none'],
    ]);
  });
  it('uses stored supplier aliases', () => {
    const aliases = new Map([[normalizeDescription('Spuds shoestring'), 'o3']]);
    expect(matchLines([{ index: 0, description: 'Spuds shoestring' }], po, aliases)[0]).toMatchObject({ poLineId: 'pl3', method: 'alias' });
  });
  it('strips units and pack sizes from descriptions', () => {
    expect(tokens('Chicken thigh, boneless 40# 10 LB case')).toEqual(['chicken', 'thigh', 'boneless']);
  });
  it('is idempotent (property)', () => {
    fc.assert(
      fc.property(fc.array(fc.string({ maxLength: 20 }), { maxLength: 5 }), (descs) => {
        const inv = descs.map((d, i) => ({ index: i, description: d }));
        expect(matchLines(inv, po)).toEqual(matchLines(inv, po));
      }),
    );
  });
});

describe('three-way match — AC-085 worked example (Solution Design §D2.6)', () => {
  it('finds price_over $9.60 and short_shipped $32.50, total $42.10', () => {
    const r = threeWayMatch(
      [
        { invoiceLineId: 'a', description: 'Beef patty 6 oz', invoicedQty: 96, invoicedPrice: 1.62, extended: 155.52, po: { ordered: 96, agreedPrice: 1.52 }, received: { accepted: 96, rejected: 0 } },
        { invoiceLineId: 'b', description: 'Chicken thigh', invoicedQty: 40, invoicedPrice: 3.25, extended: 130, po: { ordered: 40, agreedPrice: 3.25 }, received: { accepted: 30, rejected: 0 } },
        { invoiceLineId: 'c', description: 'Fries', invoicedQty: 60, invoicedPrice: 1.1, extended: 66, po: { ordered: 60, agreedPrice: 1.1 }, received: { accepted: 60, rejected: 0 } },
      ],
      { invoiced: 25, agreed: 25 },
    );
    expect(r.variances.map((v) => [v.type, v.amount])).toEqual([
      ['price_over', 9.6],
      ['short_shipped', 32.5],
    ]);
    expect(r.total).toBe(42.1);
    // Invoice total 155.52 + 130 + 66 + 25 = 376.52
    expect(arithmeticIssues({ lines: [{ qty: 96, unitPrice: 1.62, extended: 155.52 }, { qty: 40, unitPrice: 3.25, extended: 130 }, { qty: 60, unitPrice: 1.1, extended: 66 }], subtotal: 351.52, deliveryFee: 25, tax: 0, total: 376.52 })).toEqual([]);
  });

  it('price within tolerance is not a variance; not_ordered and damaged_billed are', () => {
    const r = threeWayMatch([
      { invoiceLineId: 'a', description: 'Patty', invoicedQty: 10, invoicedPrice: 1.53, extended: 15.3, po: { ordered: 10, agreedPrice: 1.52 }, received: { accepted: 10, rejected: 0 } },
      { invoiceLineId: 'b', description: 'Truffle oil', invoicedQty: 1, invoicedPrice: 18, extended: 18, po: null, received: null },
      { invoiceLineId: 'c', description: 'Romaine', invoicedQty: 12, invoicedPrice: 2, extended: 24, po: { ordered: 12, agreedPrice: 2 }, received: { accepted: 10, rejected: 2 } },
    ]);
    expect(r.variances.map((v) => [v.type, v.amount])).toEqual([
      ['not_ordered', 18],
      ['damaged_billed', 4],
    ]);
  });
});

describe('extraction arithmetic — AC-083', () => {
  it('flags 40 × $3.25 extracted as $103.00', () => {
    const issues = arithmeticIssues({ lines: [{ qty: 40, unitPrice: 3.25, extended: 103 }], total: 103 });
    expect(issues[0].field).toBe('lines.0.extended');
    expect(issues[0].message).toContain('math_error');
  });
});

describe('grounding check — AC-056', () => {
  const facts = { saving: 18.48, total: 366.92, critical: ['Chicken thigh'], counts: { pos: 2 }, wape: 0.123 };
  it('accepts numbers present in the facts (with display rounding), dates and IDs', () => {
    expect(checkGrounding('Saved $18.48 on PO-1042 ($366.92 total, 2 orders) — WAPE 12.3%, delivery 2026-10-25 at 10:00.', facts).ok).toBe(true);
  });
  it('rejects a number that is not in the facts', () => {
    const r = checkGrounding('We saved $25.00 today.', facts);
    expect(r.ok).toBe(false);
    expect(r.ungrounded).toEqual([25]);
  });
  it('extracts numbers with thousands separators', () => {
    expect(extractNumbers('Limit $1,500.00 and 40 lb')).toEqual([1500, 40]);
  });
});
