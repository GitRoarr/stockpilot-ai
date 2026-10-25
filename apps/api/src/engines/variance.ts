// Three-way match and variances (Solution Design §D2.6, SRS FR-085). Pure function.

export type VarianceType = 'short_shipped' | 'price_over' | 'not_ordered' | 'damaged_billed' | 'math_error';

export type ThreeWayLine = {
  invoiceLineId: string;
  description: string;
  invoicedQty: number;
  invoicedPrice: number;
  extended: number;
  /** null = invoice line without a PO line */
  po: { ordered: number; agreedPrice: number } | null;
  /** accepted = ok + damaged; rejected = refused at the door */
  received: { accepted: number; rejected: number } | null;
};

export type Tolerance = { pricePct: number; priceAbs: number };
export const DEFAULT_TOLERANCE: Tolerance = { pricePct: 0.02, priceAbs: 0.02 };

export type Variance = { invoiceLineId: string; type: VarianceType; description: string; amount: number };

export type MatchRow = {
  invoiceLineId: string;
  description: string;
  ordered: number | null;
  received: number | null;
  invoiced: number;
  agreedPrice: number | null;
  invoicedPrice: number;
  variances: VarianceType[];
};

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2));

export function threeWayMatch(
  lines: ThreeWayLine[],
  fees: { invoiced: number; agreed: number } = { invoiced: 0, agreed: 0 },
  tol: Tolerance = DEFAULT_TOLERANCE,
): { rows: MatchRow[]; variances: Variance[]; total: number } {
  const variances: Variance[] = [];
  const rows: MatchRow[] = [];
  for (const l of lines) {
    const types: VarianceType[] = [];
    const push = (type: VarianceType, description: string, amount: number) => {
      if (Math.abs(amount) < 0.005) return;
      types.push(type);
      variances.push({ invoiceLineId: l.invoiceLineId, type, description, amount: r2(amount) });
    };
    const computed = r2(l.invoicedQty * l.invoicedPrice);
    if (Math.abs(computed - l.extended) > 0.01) {
      push('math_error', `${l.description}: ${fmt(l.invoicedQty)} × $${l.invoicedPrice.toFixed(2)} = $${computed.toFixed(2)}, billed $${l.extended.toFixed(2)}`, l.extended - computed);
    }
    if (!l.po) {
      push('not_ordered', `${l.description}: not on the purchase order`, l.extended);
    } else {
      const accepted = l.received?.accepted ?? 0;
      const rejected = l.received?.rejected ?? 0;
      const rejectedBilled = Math.max(0, Math.min(rejected, l.invoicedQty - accepted));
      if (rejectedBilled > 0) push('damaged_billed', `${l.description}: ${fmt(rejectedBilled)} rejected at delivery but billed`, rejectedBilled * l.invoicedPrice);
      const short = l.invoicedQty - accepted - rejectedBilled;
      if (short > 1e-6) push('short_shipped', `${l.description}: billed ${fmt(l.invoicedQty)}, received ${fmt(accepted)}`, short * l.invoicedPrice);
      const agreed = l.po.agreedPrice;
      if (l.invoicedPrice > agreed * (1 + tol.pricePct) + 1e-9 && l.invoicedPrice > agreed + tol.priceAbs + 1e-9) {
        const q = Math.min(l.invoicedQty, accepted);
        push('price_over', `${l.description}: billed $${l.invoicedPrice.toFixed(2)} vs agreed $${agreed.toFixed(2)} × ${fmt(q)}`, (l.invoicedPrice - agreed) * q);
      }
    }
    rows.push({
      invoiceLineId: l.invoiceLineId,
      description: l.description,
      ordered: l.po?.ordered ?? null,
      received: l.received ? l.received.accepted : null,
      invoiced: l.invoicedQty,
      agreedPrice: l.po?.agreedPrice ?? null,
      invoicedPrice: l.invoicedPrice,
      variances: types,
    });
  }
  if (fees.invoiced > fees.agreed + 0.01) {
    variances.push({ invoiceLineId: '', type: 'price_over', description: `Fees billed $${fees.invoiced.toFixed(2)} vs agreed $${fees.agreed.toFixed(2)}`, amount: r2(fees.invoiced - fees.agreed) });
  }
  const total = r2(variances.filter((v) => v.amount > 0).reduce((s, v) => s + v.amount, 0));
  return { rows, variances, total };
}

/** Extraction arithmetic checks (FR-083): line qty × price = extended ± $0.01; Σ lines + fees + tax = total ± $0.01. */
export function arithmeticIssues(x: {
  lines: { qty: number; unitPrice: number; extended: number }[];
  subtotal?: number | null;
  tax?: number | null;
  deliveryFee?: number | null;
  total: number;
}): { field: string; message: string }[] {
  const issues: { field: string; message: string }[] = [];
  let sum = 0;
  x.lines.forEach((l, i) => {
    const c = r2(l.qty * l.unitPrice);
    if (Math.abs(c - l.extended) > 0.01) issues.push({ field: `lines.${i}.extended`, message: `math_error: ${fmt(l.qty)} × $${l.unitPrice.toFixed(2)} = $${c.toFixed(2)}, extracted $${l.extended.toFixed(2)}` });
    sum += l.extended;
  });
  sum = r2(sum);
  if (x.subtotal != null && Math.abs(sum - x.subtotal) > 0.01) issues.push({ field: 'subtotal', message: `math_error: lines sum to $${sum.toFixed(2)}, subtotal $${x.subtotal.toFixed(2)}` });
  const expected = r2(sum + (x.deliveryFee ?? 0) + (x.tax ?? 0));
  if (Math.abs(expected - x.total) > 0.01) issues.push({ field: 'total', message: `math_error: lines + fees + tax = $${expected.toFixed(2)}, total $${x.total.toFixed(2)}` });
  return issues;
}
