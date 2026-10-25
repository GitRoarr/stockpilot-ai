import { db } from '../db/sqlite.js';
import { publish } from '../lib/events.js';
import { id, localDate, nowIso, round2 } from '../lib/util.js';

// Savings ledger with provenance (SRS FR-095 – FR-097). Verified and estimated amounts are never summed together.
export type LedgerType = 'optimiser_saving' | 'credit_recovered' | 'credit_pending' | 'waste_avoided_estimate' | 'time_saved_estimate';
const VERIFIED: LedgerType[] = ['optimiser_saving', 'credit_recovered'];

export function recordLedger(e: { type: LedgerType; amount: number; sourceType: string; sourceId: string; method: string; agentId?: string | null }): void {
  db().run(
    `INSERT INTO ledger_entries (id, type, amount, verified, source_type, source_id, method, agent_id, created_at) VALUES (?,?,?,?,?,?,?,?,?)
     ON CONFLICT(type, source_type, source_id) DO UPDATE SET amount = excluded.amount, method = excluded.method`,
    id('led'),
    e.type,
    round2(e.amount),
    VERIFIED.includes(e.type) ? 1 : 0,
    e.sourceType,
    e.sourceId,
    e.method,
    e.agentId ?? null,
    nowIso(),
  );
  publish('ledger.updated', { type: e.type });
}

export function removeLedger(type: LedgerType, sourceType: string, sourceId: string): void {
  db().run(`DELETE FROM ledger_entries WHERE type = ? AND source_type = ? AND source_id = ?`, type, sourceType, sourceId);
}

export type LedgerSummary = {
  month: string;
  verified: { optimiserSaving: number; creditRecovered: number; total: number };
  pending: { creditPending: number };
  estimates: { wasteAvoided: number; timeSaved: number; methods: Record<string, string> };
};

export function ledgerSummary(): LedgerSummary {
  const month = localDate().slice(0, 7);
  const sum = (type: LedgerType, monthOnly = true) =>
    round2(db().get<{ s: number | null }>(`SELECT SUM(amount) AS s FROM ledger_entries WHERE type = ? ${monthOnly ? 'AND substr(created_at,1,7) = ?' : ''}`, ...(monthOnly ? [type, month] : [type]))!.s ?? 0);
  const optimiserSaving = sum('optimiser_saving');
  const creditRecovered = sum('credit_recovered');
  const methods: Record<string, string> = {};
  for (const r of db().all<{ type: string; method: string }>(`SELECT type, method FROM ledger_entries WHERE verified = 0 GROUP BY type`)) methods[r.type] = r.method;
  return {
    month,
    verified: { optimiserSaving, creditRecovered, total: round2(optimiserSaving + creditRecovered) },
    pending: { creditPending: sum('credit_pending', false) },
    estimates: { wasteAvoided: sum('waste_avoided_estimate'), timeSaved: sum('time_saved_estimate'), methods },
  };
}

export function ledgerEntries(limit = 200) {
  return db().all(`SELECT * FROM ledger_entries ORDER BY created_at DESC LIMIT ?`, limit);
}
