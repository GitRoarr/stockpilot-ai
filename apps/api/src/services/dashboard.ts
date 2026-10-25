import { db } from '../db/sqlite.js';
import { latestBriefing } from '../agents/briefing.js';
import { aiAvailable, modelCallStats } from '../agents/llm/gateway.js';
import { getSettings } from '../lib/settings.js';
import { localDate, nowIso } from '../lib/util.js';
import { getForecast } from './forecast.js';
import { ledgerSummary } from './ledger.js';
import { computeNeeds } from './planning.js';

// Today / standup dashboard (SRS FR-096, FR-097). Verified and estimated savings are separate fields; none sums them.
export function dashboard() {
  const needs = computeNeeds();
  const fc = getForecast(7);
  const ledger = ledgerSummary();
  const posByStatus = Object.fromEntries(db().all<{ status: string; n: number }>(`SELECT status, COUNT(*) AS n FROM purchase_orders WHERE status <> 'cancelled' GROUP BY status`).map((r) => [r.status, r.n]));
  const decisions = {
    proposals: db().get<{ n: number }>(`SELECT COUNT(*) AS n FROM agent_actions WHERE status = 'proposed'`)!.n,
    questions: db().get<{ n: number }>(`SELECT COUNT(*) AS n FROM questions WHERE status = 'open'`)!.n,
    agreements: db().get<{ n: number }>(`SELECT COUNT(*) AS n FROM working_agreements WHERE status = 'proposed'`)!.n,
  };
  const beats = fc.items.filter((i) => (i.wape[i.model] ?? 9) <= (i.baselineWape ?? 0)).length;
  const sel = fc.items.map((i) => i.wape[i.model] ?? 0);
  const naive = fc.items.map((i) => i.baselineWape ?? 0);
  const avg = (a: number[]) => (a.length ? Math.round((a.reduce((x, y) => x + y, 0) / a.length) * 1000) / 10 : null);
  const s = getSettings();
  const ai = aiAvailable();
  const lastMorning = db().get<any>(`SELECT id, status, mode, fallback_reason, started_at, ended_at FROM agent_runs WHERE playbook = 'morning' ORDER BY started_at DESC LIMIT 1`);
  return {
    date: localDate(),
    restaurant: s.restaurantName,
    illustrativeData: s.demoData,
    verifiedSavings: { month: ledger.month, optimiser: ledger.verified.optimiserSaving, creditsRecovered: ledger.verified.creditRecovered, total: ledger.verified.total },
    pendingCredits: ledger.pending.creditPending,
    estimatedSavings: { wasteAvoided: ledger.estimates.wasteAvoided, timeSaved: ledger.estimates.timeSaved, methods: ledger.estimates.methods },
    stock: {
      critical: needs.filter((n) => n.trace.status === 'critical').map((n) => ({ id: n.ingredientId, name: n.name, daysOfCover: n.trace.daysOfCover, unit: n.unit })),
      low: needs.filter((n) => n.trace.status === 'low').map((n) => ({ id: n.ingredientId, name: n.name, daysOfCover: n.trace.daysOfCover, unit: n.unit })),
      valueAtRisk: Math.round(needs.reduce((s2, n) => s2 + n.valueAtRisk, 0) * 100) / 100,
      expiryRisks: needs.filter((n) => n.valueAtRisk > 0).map((n) => ({ id: n.ingredientId, name: n.name, unit: n.unit, atRisk: Math.round(n.expiry.reduce((a, r) => a + r.atRisk, 0) * 10) / 10, value: n.valueAtRisk, expiresAt: n.expiry[0]?.expiresAt })),
      expired: needs.filter((n) => n.expiredQty > 0).map((n) => ({ id: n.ingredientId, name: n.name, qty: n.expiredQty, unit: n.unit })),
    },
    posByStatus,
    decisions,
    briefing: latestBriefing(),
    lastMorningRun: lastMorning ?? null,
    context: { days: fc.context.days, status: fc.context.status, attribution: 'Weather data by Open-Meteo.com (CC BY 4.0)' },
    forecastAccuracy: { items: fc.items.length, atOrBelowNaive: beats, avgWapePct: avg(sel), avgNaiveWapePct: avg(naive), note: 'Rolling-origin backtest on recent daily sales' },
    ai: { available: ai.ok, reason: ai.reason ?? null, ...modelCallStats() },
    purchasing: purchasing(),
    supplierIssues: supplierIssues(),
    agentActivity: db().all<any>(
      `SELECT id, agent_id AS agentId, trigger, goal, status, mode, fallback_reason AS fallbackReason, parent_run_id AS parentRunId, steps_used AS steps, started_at AS startedAt, ended_at AS endedAt
       FROM agent_runs ORDER BY started_at DESC LIMIT 12`,
    ),
    recentEvents: db().all<any>(
      `SELECT a.id, a.at, a.action, a.actor_type AS actorType, a.actor_id AS actorId, COALESCE(u.name, ag.display_name) AS actorName, a.entity_type AS entityType, a.entity_id AS entityId
       FROM audit_events a LEFT JOIN users u ON a.actor_type = 'user' AND u.id = a.actor_id LEFT JOIN agents ag ON a.actor_type = 'agent' AND ag.id = a.actor_id
       WHERE a.action NOT LIKE 'auth.%' ORDER BY a.at DESC LIMIT 10`,
    ),
  };
}

/** Latest optimiser plan (baseline vs optimised cost, both from the engine) and the approval queue. */
function purchasing() {
  const plan = db().get<{ id: string; created_at: string; method: string; total: number; baseline_total: number; saving: number; fallback_reason: string | null }>(
    `SELECT id, created_at, method, total, baseline_total, saving, fallback_reason FROM plans ORDER BY created_at DESC LIMIT 1`,
  );
  const pending = db().get<{ n: number; total: number | null; saving: number | null }>(`SELECT COUNT(*) AS n, SUM(total) AS total, SUM(COALESCE(saving, 0)) AS saving FROM purchase_orders WHERE status = 'pending_approval'`)!;
  const open = db().get<{ n: number; total: number | null }>(`SELECT COUNT(*) AS n, SUM(total) AS total FROM purchase_orders WHERE status IN ('approved','sent','confirmed','partially_confirmed','partially_received')`)!;
  return {
    plan: plan
      ? { id: plan.id, createdAt: plan.created_at, method: plan.method, planned: plan.total, baseline: plan.baseline_total, saving: plan.saving, savingPct: plan.baseline_total > 0 ? Math.round((plan.saving / plan.baseline_total) * 1000) / 10 : null, fallbackReason: plan.fallback_reason }
      : null,
    pendingApproval: { count: pending.n, total: Math.round((pending.total ?? 0) * 100) / 100, saving: Math.round((pending.saving ?? 0) * 100) / 100 },
    inFlight: { count: open.n, total: Math.round((open.total ?? 0) * 100) / 100 },
  };
}

/** Purchase orders that need a look: missed confirmation deadlines, partial confirmations, late or due deliveries. */
function supplierIssues() {
  const today = localDate();
  const rows = db().all<{ id: string; number: string; supplier: string; status: string; delivery_date: string | null; confirmation_deadline: string | null; reminders_sent: number }>(
    `SELECT p.id, p.number, s.name AS supplier, p.status, p.delivery_date, p.confirmation_deadline, p.reminders_sent FROM purchase_orders p JOIN suppliers s ON s.id = p.supplier_id
     WHERE p.status IN ('sent','confirmed','partially_confirmed','partially_received') ORDER BY p.delivery_date`,
  );
  const out: { poId: string; number: string; supplier: string; kind: 'unconfirmed' | 'partial' | 'late' | 'due_today'; severity: 'red' | 'amber' | 'blue'; detail: string }[] = [];
  for (const r of rows) {
    if (r.status === 'sent' && r.confirmation_deadline && r.confirmation_deadline < nowIso()) out.push({ poId: r.id, number: r.number, supplier: r.supplier, kind: 'unconfirmed', severity: 'red', detail: `Not confirmed by the deadline${r.reminders_sent ? ` · ${r.reminders_sent} reminder(s) sent` : ''}` });
    else if (r.status === 'partially_confirmed') out.push({ poId: r.id, number: r.number, supplier: r.supplier, kind: 'partial', severity: 'amber', detail: 'Supplier confirmed only part of the order' });
    if (r.delivery_date && r.delivery_date < today && r.status !== 'partially_received') out.push({ poId: r.id, number: r.number, supplier: r.supplier, kind: 'late', severity: 'red', detail: `Delivery was due ${r.delivery_date}` });
    else if (r.delivery_date === today) out.push({ poId: r.id, number: r.number, supplier: r.supplier, kind: 'due_today', severity: 'blue', detail: 'Delivery due today' });
  }
  return out;
}
