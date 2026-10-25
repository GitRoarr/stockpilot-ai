import { db } from '../db/sqlite.js';
import { audit, publish, type Actor } from '../lib/events.js';
import { addDays, conflict, id, localDate, nowIso, unprocessable } from '../lib/util.js';
import { postSystemMessage } from './collaboration.js';
import { addBatch } from './inventory.js';
import { getPoRow, poLinesView } from './purchaseOrders.js';

// Receiving deliveries against a PO (SRS FR-080). Accepted quantities become stock batches.
export type ReceiveLine = { poLineId: string; qtyReceived: number; qtyRejected?: number; condition: 'ok' | 'damaged' | 'rejected'; expiresAt?: string };

const RECEIVABLE = ['sent', 'confirmed', 'partially_confirmed', 'partially_received'];

type Emit = (event: string, payload: Record<string, unknown>) => void;
let emit: Emit = () => {};
export function onReceivingEvent(fn: Emit): void {
  emit = fn;
}

/** Lines pre-filled from the supplier confirmation (FR-080). */
export function receivingForm(poId: string) {
  const po = getPoRow(poId);
  const received = receivedByLine(poId);
  return {
    po: { id: po.id, number: po.number, status: po.status, deliveryDate: po.delivery_date, eta: po.eta },
    lines: poLinesView(poId)
      .filter((l) => l.packs > 0)
      .map((l) => {
        const expected = l.unavailable ? 0 : (l.confirmed_qty ?? l.qty);
        const already = received.get(l.id)?.accepted ?? 0;
        return { poLineId: l.id, ingredient: l.ingredient, unit: l.unit, ordered: l.qty, confirmed: l.confirmed_qty, unavailable: Boolean(l.unavailable), alreadyReceived: already, prefill: Math.max(0, expected - already) };
      }),
  };
}

export function receivedByLine(poId: string): Map<string, { accepted: number; rejected: number }> {
  const out = new Map<string, { accepted: number; rejected: number }>();
  for (const r of db().all<{ po_line_id: string; a: number; r: number }>(
    `SELECT rl.po_line_id, SUM(rl.qty_received) AS a, SUM(rl.qty_rejected) AS r FROM receipt_lines rl JOIN receipts rc ON rc.id = rl.receipt_id WHERE rc.purchase_order_id = ? GROUP BY rl.po_line_id`,
    poId,
  ))
    out.set(r.po_line_id, { accepted: r.a ?? 0, rejected: r.r ?? 0 });
  return out;
}

export function receiveDelivery(poId: string, lines: ReceiveLine[], actor: Actor): { receiptId: string; status: string } {
  const result = db().tx(() => {
    const po = getPoRow(poId);
    if (!RECEIVABLE.includes(po.status)) throw conflict(`Cannot receive a purchase order that is ${po.status}`);
    const poLines = new Map(poLinesView(poId).map((l) => [l.id, l]));
    if (!lines.length) throw unprocessable('No lines to receive');
    const today = localDate();
    const rid = id('rcp');
    db().run(`INSERT INTO receipts (id, purchase_order_id, received_by, received_at) VALUES (?,?,?,?)`, rid, poId, actor.id ?? null, nowIso());
    for (const l of lines) {
      const pl = poLines.get(l.poLineId);
      if (!pl) throw unprocessable(`Line ${l.poLineId} is not on ${po.number}`);
      const accepted = l.condition === 'rejected' ? 0 : l.qtyReceived;
      const rejected = l.condition === 'rejected' ? l.qtyReceived + (l.qtyRejected ?? 0) : (l.qtyRejected ?? 0);
      const shelf = db().get<{ shelf_life_days: number }>(`SELECT shelf_life_days FROM ingredients WHERE id = ?`, pl.ingredient_id)!.shelf_life_days;
      const expiresAt = l.expiresAt ?? addDays(today, shelf);
      db().run(
        `INSERT INTO receipt_lines (id, receipt_id, po_line_id, qty_received, qty_rejected, condition, expires_at) VALUES (?,?,?,?,?,?,?)`,
        id('rcl'),
        rid,
        l.poLineId,
        accepted,
        rejected,
        l.condition,
        expiresAt,
      );
      if (accepted > 0) {
        addBatch(pl.ingredient_id, accepted, expiresAt, `receipt:${rid}`, today);
        db().run(`INSERT INTO stock_movements (id, ingredient_id, type, qty_delta, reason, actor_id, created_at) VALUES (?,?,'receive',?,?,?,?)`, id('mov'), pl.ingredient_id, accepted, `${po.number}`, actor.id ?? null, nowIso());
      }
    }
    const got = receivedByLine(poId);
    const complete = [...poLines.values()].filter((l) => l.packs > 0 && !l.unavailable).every((l) => (got.get(l.id)?.accepted ?? 0) + (got.get(l.id)?.rejected ?? 0) >= (l.confirmed_qty ?? l.qty) - 1e-6);
    const status = complete ? 'received' : 'partially_received';
    db().run(`UPDATE purchase_orders SET status = ?, updated_at = ? WHERE id = ?`, status, nowIso(), poId);
    audit(actor, 'delivery.received', 'purchase_order', poId, { after: { receiptId: rid, status, lines } });
    postSystemMessage('purchase_order', poId, `Delivery received (${status.replace('_', ' ')}).`);
    return { receiptId: rid, status, poNumber: po.number };
  });
  publish('po.updated', { id: poId, status: result.status });
  emit('delivery.received', { poId, receiptId: result.receiptId });
  return result;
}
