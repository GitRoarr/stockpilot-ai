import type { OptimiserInput } from './types.js';

export type LpModel = {
  lp: string;
  /** column name → offer id (x), supplier id (u, v) */
  x: Map<string, string>;
  u: Map<string, string>;
  v: Map<string, string>;
};

const num = (n: number) => {
  const s = Number(n.toFixed(6)).toString();
  return s.includes('e') ? n.toFixed(6) : s;
};

function term(coef: number, name: string, first: boolean): string {
  const sign = coef < 0 ? '-' : first ? '' : '+';
  return `${sign} ${num(Math.abs(coef))} ${name}`.trim();
}

/**
 * CPLEX LP formulation of Solution Design §D2.4. Offers are pre-filtered (feasible offers only) by the caller.
 * x = integer packs per offer, u = supplier used, v = soft minimum not met (pays small-order fee).
 */
export function buildLp(input: OptimiserInput): LpModel {
  const needs = input.needs.filter((n) => n.need > 0);
  const needIds = new Set(needs.map((n) => n.ingredientId));
  const offers = input.offers.filter((o) => needIds.has(o.ingredientId));
  const x = new Map<string, string>();
  const u = new Map<string, string>();
  const v = new Map<string, string>();
  const xName = new Map<string, string>();
  offers.forEach((o, k) => {
    x.set(`x${k}`, o.id);
    xName.set(o.id, `x${k}`);
  });
  const usedSuppliers = input.suppliers.filter((s) => offers.some((o) => o.supplierId === s.id));
  const uName = new Map<string, string>();
  const vName = new Map<string, string>();
  usedSuppliers.forEach((s, k) => {
    u.set(`u${k}`, s.id);
    uName.set(s.id, `u${k}`);
    if (s.minOrderType === 'soft' && s.minOrderValue > 0 && s.belowMinFee > 0) {
      v.set(`v${k}`, s.id);
      vName.set(s.id, `v${k}`);
    }
  });

  const obj: string[] = [];
  for (const o of offers) obj.push(term(o.unitPrice * o.packSize * (o.objectiveFactor ?? 1), xName.get(o.id)!, obj.length === 0));
  for (const s of usedSuppliers) {
    if (s.deliveryFee > 0) obj.push(term(s.deliveryFee, uName.get(s.id)!, obj.length === 0));
    if (vName.has(s.id)) obj.push(term(s.belowMinFee, vName.get(s.id)!, obj.length === 0));
  }
  if (!obj.length) obj.push('0 u0');

  const cons: string[] = [];
  const bounds: string[] = [];
  let c = 0;
  for (const n of needs) {
    const os = offers.filter((o) => o.ingredientId === n.ingredientId);
    if (!os.length) continue;
    const lhs = os.map((o, k) => term(o.packSize, xName.get(o.id)!, k === 0)).join(' ');
    cons.push(` c${c++}: ${lhs} >= ${num(n.need)}`);
    cons.push(` c${c++}: ${lhs} <= ${num(n.need + Math.max(0, n.cap))}`);
    for (const o of os) {
      const M = Math.ceil((n.need + Math.max(0, n.cap)) / o.packSize + 1e-9);
      bounds.push(` 0 <= ${xName.get(o.id)} <= ${M}`);
      cons.push(` c${c++}: ${xName.get(o.id)} - ${M} ${uName.get(o.supplierId)} <= 0`);
    }
  }
  for (const s of usedSuppliers) {
    if (s.minOrderValue <= 0) continue;
    const os = offers.filter((o) => o.supplierId === s.id);
    const lhs = os.map((o, k) => term(o.unitPrice * o.packSize, xName.get(o.id)!, k === 0)).join(' ');
    if (s.minOrderType === 'hard') {
      cons.push(` c${c++}: ${lhs} - ${num(s.minOrderValue)} ${uName.get(s.id)} >= 0`);
    } else if (vName.has(s.id)) {
      cons.push(` c${c++}: ${lhs} - ${num(s.minOrderValue)} ${uName.get(s.id)} + ${num(s.minOrderValue)} ${vName.get(s.id)} >= 0`);
      cons.push(` c${c++}: ${vName.get(s.id)} - ${uName.get(s.id)} <= 0`);
    }
  }

  const lp = [
    'Minimize',
    ` obj: ${obj.join(' ')}`,
    'Subject To',
    ...(cons.length ? cons : [' c0: u0 >= 0']),
    'Bounds',
    ...bounds,
    ...[...u.keys(), ...v.keys()].map((n) => ` 0 <= ${n} <= 1`),
    ...(x.size ? ['General', ` ${[...x.keys()].join(' ')}`] : []),
    ...(u.size || v.size ? ['Binary', ` ${[...u.keys(), ...v.keys()].join(' ')}`] : []),
    'End',
  ].join('\n');
  return { lp, x, u, v };
}
