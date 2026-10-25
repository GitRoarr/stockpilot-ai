import { db } from '../db/sqlite.js';
import { latestBriefing } from '../agents/briefing.js';
import { aiAvailable, modelCallStats } from '../agents/llm/gateway.js';
import { getSettings } from '../lib/settings.js';
import { localDate } from '../lib/util.js';
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
    forecastAccuracy: { items: fc.items.length, atOrBelowNaive: beats, avgWapePct: avg(sel), avgNaiveWapePct: avg(naive), note: 'Illustrative demo data — demonstrates the pipeline, not real-world accuracy' },
    ai: { available: ai.ok, reason: ai.reason ?? null, ...modelCallStats() },
  };
}
