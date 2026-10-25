import { db } from '../db/sqlite.js';
import { audit, publish, type Actor } from '../lib/events.js';
import { addDays, id, localDate, nowIso, round2, unprocessable } from '../lib/util.js';

// Stock batches and movements (SRS FR-005, FR-006, FR-036). Batches are consumed FIFO by expiry.
export type BatchRow = { id: string; ingredient_id: string; qty: number; received_at: string; expires_at: string; source: string | null };

export function batches(ingredientId?: string): BatchRow[] {
  return ingredientId
    ? db().all<BatchRow>(`SELECT * FROM stock_batches WHERE ingredient_id = ? AND qty > 0 ORDER BY expires_at, received_at`, ingredientId)
    : db().all<BatchRow>(`SELECT * FROM stock_batches WHERE qty > 0 ORDER BY expires_at, received_at`);
}

/** A batch is usable on days strictly before its expiry date; "usable" for planning = expires after tomorrow. */
export function stockSummary(ingredientId: string, today = localDate()): { onHand: number; usable: number; expired: number } {
  const tomorrow = addDays(today, 1);
  let onHand = 0;
  let usable = 0;
  let expired = 0;
  for (const b of batches(ingredientId)) {
    onHand += b.qty;
    if (b.expires_at > tomorrow) usable += b.qty;
    if (b.expires_at <= today) expired += b.qty;
  }
  return { onHand: round3(onHand), usable: round3(usable), expired: round3(expired) };
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

function consumeFifo(ingredientId: string, qty: number): void {
  let left = qty;
  for (const b of batches(ingredientId)) {
    if (left <= 1e-9) break;
    const take = Math.min(b.qty, left);
    db().run(`UPDATE stock_batches SET qty = ? WHERE id = ?`, round3(b.qty - take), b.id);
    left -= take;
  }
}

export function addBatch(ingredientId: string, qty: number, expiresAt: string, source: string, receivedAt = localDate()): string {
  const bid = id('bat');
  db().run(`INSERT INTO stock_batches (id, ingredient_id, qty, received_at, expires_at, source) VALUES (?,?,?,?,?,?)`, bid, ingredientId, round3(qty), receivedAt, expiresAt, source);
  return bid;
}

export type MovementInput =
  | { type: 'receive'; qty: number; expiresAt?: string; reason?: string }
  | { type: 'waste'; qty: number; reason: string }
  | { type: 'count_adjust'; countedQty: number; reason?: string; expiresAt?: string }
  | { type: 'write_off'; reason?: string };

export function recordMovement(ingredientId: string, m: MovementInput, actor: Actor): { onHand: number; usable: number; delta: number } {
  const ing = db().get<{ id: string; name: string; shelf_life_days: number }>(`SELECT id, name, shelf_life_days FROM ingredients WHERE id = ?`, ingredientId);
  if (!ing) throw unprocessable('Unknown ingredient');
  const today = localDate();
  return db().tx(() => {
    const before = stockSummary(ingredientId, today);
    let delta = 0;
    if (m.type === 'receive') {
      addBatch(ingredientId, m.qty, m.expiresAt ?? addDays(today, ing.shelf_life_days), 'manual_receive');
      delta = m.qty;
    } else if (m.type === 'waste') {
      if (m.qty > before.onHand + 1e-9) throw unprocessable(`Cannot waste ${m.qty} — only ${before.onHand} on hand`, { onHand: before.onHand });
      consumeFifo(ingredientId, m.qty);
      delta = -m.qty;
    } else if (m.type === 'count_adjust') {
      delta = round3(m.countedQty - before.onHand);
      if (delta > 0) addBatch(ingredientId, delta, m.expiresAt ?? addDays(today, ing.shelf_life_days), 'count_adjust');
      else if (delta < 0) consumeFifo(ingredientId, -delta);
    } else {
      const expired = batches(ingredientId).filter((b) => b.expires_at <= today);
      for (const b of expired) db().run(`UPDATE stock_batches SET qty = 0 WHERE id = ?`, b.id);
      delta = -round3(expired.reduce((s, b) => s + b.qty, 0));
    }
    db().run(
      `INSERT INTO stock_movements (id, ingredient_id, type, qty_delta, reason, actor_id, created_at) VALUES (?,?,?,?,?,?,?)`,
      id('mov'),
      ingredientId,
      m.type,
      delta,
      'reason' in m ? (m.reason ?? null) : null,
      actor.id ?? null,
      nowIso(),
    );
    const after = stockSummary(ingredientId, today);
    audit(actor, `stock.${m.type}`, 'ingredient', ingredientId, { before, after, meta: { delta } });
    publish('stock.updated', { ingredientId });
    return { ...after, delta: round2(delta) };
  });
}
