import { db } from '../db/sqlite.js';
import { addDays, id, localDate, nowIso, round2 } from '../lib/util.js';
import { latestModelRun } from './forecast.js';

// Agent scorecards (SRS FR-120): a performance review in dollars, accuracy and reliability. Estimates are separate.
export type Scorecard = {
  agentId: string | null;
  periodStart: string;
  periodEnd: string;
  metrics: {
    tasksCompleted: number;
    medianResolutionMinutes: number | null;
    verifiedSavingsUsd: number;
    forecastWapePct?: number | null;
    naiveWapePct?: number | null;
    approvalWithoutEditRate?: number | null;
    variancesRecoveredUsd?: number;
    questionsAsked: number;
    escalations: number;
    policyViolations: number;
    modelCalls: number;
    fallbackRuns: number;
  };
  estimates: { humanHoursReplaced: number; method: string };
};

// [Assumption] minutes a human purchasing manager would spend per completed task type.
const MINUTES_PER_TASK = 12;

function median(a: number[]): number | null {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function computeScorecard(agentId: string | null, periodStart: string, periodEnd: string): Scorecard {
  const from = `${periodStart}T00:00:00.000Z`;
  const to = `${addDays(periodEnd, 1)}T00:00:00.000Z`;
  const agentFilter = agentId ? 'AND assignee_id = ?' : `AND assignee_type = 'agent'`;
  const args = (extra: unknown[] = []) => (agentId ? [from, to, agentId, ...extra] : [from, to, ...extra]) as any[];

  const tasksCompleted = db().get<{ n: number }>(`SELECT COUNT(*) AS n FROM tasks WHERE status = 'done' AND updated_at >= ? AND updated_at < ? ${agentFilter}`, ...args())!.n;
  const runs = db().all<{ started_at: string; ended_at: string }>(`SELECT started_at, ended_at FROM agent_runs WHERE status = 'completed' AND ended_at >= ? AND ended_at < ? ${agentId ? 'AND agent_id = ?' : ''}`, ...args());
  const med = median(runs.map((r) => (Date.parse(r.ended_at) - Date.parse(r.started_at)) / 60000));
  const savings = db().get<{ s: number | null }>(`SELECT SUM(amount) AS s FROM ledger_entries WHERE verified = 1 AND created_at >= ? AND created_at < ? ${agentId ? 'AND agent_id = ?' : ''}`, ...args())!.s ?? 0;
  const questionsAsked = db().get<{ n: number }>(`SELECT COUNT(*) AS n FROM questions WHERE created_at >= ? AND created_at < ? ${agentId ? 'AND agent_id = ?' : ''}`, ...args())!.n;
  const escalations =
    db().get<{ n: number }>(`SELECT COUNT(*) AS n FROM questions WHERE status = 'escalated' AND created_at >= ? AND created_at < ? ${agentId ? 'AND agent_id = ?' : ''}`, ...args())!.n +
    db().get<{ n: number }>(`SELECT COUNT(*) AS n FROM agent_runs WHERE status IN ('failed','budget_exhausted') AND started_at >= ? AND started_at < ? ${agentId ? 'AND agent_id = ?' : ''}`, ...args())!.n;
  // A violation = an action executed although the policy forbade it or required approval and nobody approved it.
  const policyViolations = db().get<{ n: number }>(
    `SELECT COUNT(*) AS n FROM agent_actions WHERE created_at >= ? AND created_at < ? ${agentId ? 'AND agent_id = ?' : ''}
     AND status = 'executed' AND (policy_decision = 'forbidden' OR (policy_decision = 'requires_approval' AND approver_id IS NULL))`,
    ...args(),
  )!.n;
  const modelCalls = db().get<{ n: number }>(`SELECT COUNT(*) AS n FROM model_calls WHERE at >= ? AND at < ? ${agentId ? 'AND purpose = ?' : ''}`, ...(agentId ? [from, to, `agent:${agentId}`] : [from, to]))!.n;
  const fallbackRuns = db().get<{ n: number }>(`SELECT COUNT(*) AS n FROM agent_runs WHERE mode = 'deterministic' AND started_at >= ? AND started_at < ? ${agentId ? 'AND agent_id = ?' : ''}`, ...args())!.n;

  const metrics: Scorecard['metrics'] = {
    tasksCompleted,
    medianResolutionMinutes: med === null ? null : Math.round(med * 10) / 10,
    verifiedSavingsUsd: round2(savings),
    questionsAsked,
    escalations,
    policyViolations,
    modelCalls,
    fallbackRuns,
  };
  if (!agentId || agentId === 'demand-planner') {
    const mr = latestModelRun();
    if (mr && mr.backtests.length) {
      const sel = mr.backtests.map((b) => b.wape[b.selected] ?? 0);
      const naive = mr.backtests.map((b) => b.wape.M1 ?? 0);
      metrics.forecastWapePct = Math.round((sel.reduce((a, b) => a + b, 0) / sel.length) * 1000) / 10;
      metrics.naiveWapePct = Math.round((naive.reduce((a, b) => a + b, 0) / naive.length) * 1000) / 10;
    } else {
      metrics.forecastWapePct = null;
      metrics.naiveWapePct = null;
    }
  }
  if (!agentId || agentId === 'buyer') {
    const pos = db().all<{ id: string }>(`SELECT id FROM purchase_orders WHERE created_by_type = 'agent' AND approved_at >= ? AND approved_at < ?`, from, to);
    const clean = pos.filter((p) => !db().get(`SELECT 1 FROM po_lines WHERE purchase_order_id = ? AND edited_by_user = 1`, p.id)).length;
    metrics.approvalWithoutEditRate = pos.length ? Math.round((clean / pos.length) * 1000) / 1000 : null;
  }
  if (!agentId || agentId === 'ap-clerk') {
    metrics.variancesRecoveredUsd = round2(db().get<{ s: number | null }>(`SELECT SUM(amount) AS s FROM ledger_entries WHERE type = 'credit_recovered' AND created_at >= ? AND created_at < ?`, from, to)!.s ?? 0);
  }
  return {
    agentId,
    periodStart,
    periodEnd,
    metrics,
    estimates: {
      humanHoursReplaced: Math.round(((tasksCompleted * MINUTES_PER_TASK) / 60) * 10) / 10,
      method: `[Assumption] ${MINUTES_PER_TASK} minutes of a purchasing manager's time per task the team completed (${tasksCompleted} tasks) — an estimate, not a measurement`,
    },
  };
}

export function scorecardFor(agentId: string | null, period: 'week' | 'month' = 'week'): Scorecard {
  const end = localDate();
  return computeScorecard(agentId, addDays(end, period === 'week' ? -6 : -29), end);
}

export function snapshotScorecards(): void {
  const end = localDate();
  const start = addDays(end, -6);
  for (const a of [null, ...db().all<{ id: string }>(`SELECT id FROM agents`).map((r) => r.id)]) {
    const sc = computeScorecard(a, start, end);
    db().run(`INSERT INTO scorecard_snapshots (id, agent_id, period_start, period_end, metrics_json, estimates_json, created_at) VALUES (?,?,?,?,?,?,?)`, id('scs'), a, start, end, JSON.stringify(sc.metrics), JSON.stringify(sc.estimates), nowIso());
  }
}
