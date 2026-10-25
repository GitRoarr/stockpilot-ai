import { z } from 'zod';
import { config } from '../config.js';
import { db } from '../db/sqlite.js';
import { checkGrounding } from '../engines/grounding.js';
import { notify, publish } from '../lib/events.js';
import { getSettings } from '../lib/settings.js';
import { addDays, id, json, localDate, nowIso } from '../lib/util.js';
import { esc, layout, queueEmail } from '../services/email.js';
import { getForecast } from '../services/forecast.js';
import { ledgerSummary } from '../services/ledger.js';
import { computeNeeds } from '../services/planning.js';
import { aiAvailable, llmStructured } from './llm/gateway.js';
import { LlmUnavailable, type FallbackReason } from './llm/types.js';
import type { RunInfo } from './tools/types.js';

// Daily standup briefing (SRS FR-056, FR-093, FR-121; Solution Design §D3.8).
const REF_TYPES = ['action', 'question', 'purchase_order', 'task', 'dispute', 'ingredient'] as const;
const Item = z.object({ text: z.string().min(3).max(240), refType: z.enum(REF_TYPES).nullable().optional(), refId: z.string().nullable().optional() });
export const BriefingSchema = z.object({
  summary: z.string().min(10).max(600),
  agents: z.array(z.object({ agentId: z.enum(['pilot', 'demand-planner', 'buyer', 'ap-clerk']), done: z.array(Item).max(6), today: z.array(Item).max(6), needsYou: z.array(Item).max(6) })).min(1).max(4),
  wasteReductionIdeas: z.array(z.object({ text: z.string().min(3).max(240), ingredientIds: z.array(z.string()).min(1).max(4) })).max(4),
  risks: z.array(z.string().min(3).max(200)).max(6),
  confidence: z.enum(['high', 'medium', 'low']),
});
export type Briefing = z.infer<typeof BriefingSchema>;

// Sent to Gemini as the response schema. Item limits are enforced by BriefingSchema (Zod) instead: Gemini rejects this
// shape with "too many states for serving" when minItems/maxItems or $ref are included (verified live).
const ITEM = { type: 'object', properties: { text: { type: 'string' }, refType: { type: 'string', enum: [...REF_TYPES] }, refId: { type: 'string' } }, required: ['text'] };
const BRIEFING_JSON_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    agents: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          agentId: { type: 'string', enum: ['pilot', 'demand-planner', 'buyer', 'ap-clerk'] },
          done: { type: 'array', items: ITEM },
          today: { type: 'array', items: ITEM },
          needsYou: { type: 'array', items: ITEM },
        },
        required: ['agentId', 'done', 'today', 'needsYou'],
      },
    },
    wasteReductionIdeas: { type: 'array', items: { type: 'object', properties: { text: { type: 'string' }, ingredientIds: { type: 'array', items: { type: 'string' } } }, required: ['text', 'ingredientIds'] } },
    risks: { type: 'array', items: { type: 'string' } },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
  },
  required: ['summary', 'agents', 'wasteReductionIdeas', 'risks', 'confidence'],
};

export type BriefingFacts = ReturnType<typeof buildFacts>;

/** Every number and ID the briefing may use. The model gets only these facts. */
export function buildFacts(sinceIso: string) {
  const date = localDate();
  const needs = computeNeeds();
  const fc = getForecast(2);
  const ledger = ledgerSummary();
  const drafted = db().all<any>(`SELECT p.id, p.number, p.status, p.total, p.saving, s.name AS supplier FROM purchase_orders p JOIN suppliers s ON s.id = p.supplier_id WHERE p.created_at >= ? AND p.status <> 'cancelled' ORDER BY p.number`, sinceIso);
  const proposals = db().all<any>(`SELECT id, agent_id, tool, summary, required_role FROM agent_actions WHERE status = 'proposed' ORDER BY created_at`);
  const questions = db().all<any>(`SELECT id, agent_id, text, recommended, deadline FROM questions WHERE status = 'open' ORDER BY created_at`);
  const awaiting = db().all<any>(`SELECT p.id, p.number, s.name AS supplier, p.confirmation_deadline FROM purchase_orders p JOIN suppliers s ON s.id = p.supplier_id WHERE p.status = 'sent'`);
  const disputes = db().all<any>(`SELECT id, number, status, amount_claimed FROM disputes WHERE status IN ('draft','sent','acknowledged')`);
  const runs = db().all<any>(`SELECT agent_id, goal, status FROM agent_runs WHERE started_at >= ? AND status IN ('completed','budget_exhausted','failed')`, sinceIso);
  const tomorrow = fc.context.days[1];
  // Holidays in the coming week matter for ordering ahead (supplier lead times), not only tomorrow's.
  const upcoming = db().all<{ date: string; name: string }>(`SELECT date, MIN(name) AS name FROM holidays WHERE date > ? AND date <= ? GROUP BY date ORDER BY date`, date, addDays(date, 7));
  const beats = fc.items.filter((i) => (i.wape[i.model] ?? 9) <= (i.baselineWape ?? 0)).length;
  return {
    date,
    restaurant: getSettings().restaurantName,
    weatherTomorrow: tomorrow ? { date: tomorrow.date, tmaxF: tomorrow.tmaxF, precipIn: tomorrow.precipIn, holiday: tomorrow.holiday } : null,
    upcomingHolidays: upcoming.map((h) => ({ date: h.date, name: h.name })),
    contextStatus: Object.fromEntries(Object.entries(fc.context.status).map(([k, v]) => [k, v.status])),
    critical: needs.filter((n) => n.trace.status === 'critical').map((n) => ({ ingredientId: n.ingredientId, name: n.name, daysOfCover: n.trace.daysOfCover })),
    low: needs.filter((n) => n.trace.status === 'low').map((n) => ({ ingredientId: n.ingredientId, name: n.name, daysOfCover: n.trace.daysOfCover })),
    expiryRisks: needs.filter((n) => n.valueAtRisk > 0).map((n) => ({ ingredientId: n.ingredientId, name: n.name, unit: n.unit, atRisk: Math.round(n.expiry.reduce((s, r) => s + r.atRisk, 0) * 10) / 10, valueAtRisk: n.valueAtRisk, expiresAt: n.expiry[0]?.expiresAt })),
    inStockIngredientIds: needs.filter((n) => n.onHand > 0).map((n) => n.ingredientId),
    ordersDrafted: drafted.map((p) => ({ poId: p.id, number: p.number, supplier: p.supplier, status: p.status, total: p.total, saving: p.saving ?? 0 })),
    ordersTotal: Math.round(drafted.reduce((s, p) => s + p.total, 0) * 100) / 100,
    savingTotal: Math.round(drafted.reduce((s, p) => s + (p.saving ?? 0), 0) * 100) / 100,
    proposals: proposals.map((p) => ({ actionId: p.id, agentId: p.agent_id, tool: p.tool, summary: p.summary, requiredRole: p.required_role })),
    questions: questions.map((q) => ({ questionId: q.id, agentId: q.agent_id, text: q.text, recommended: q.recommended })),
    awaitingConfirmation: awaiting.map((p) => ({ poId: p.id, number: p.number, supplier: p.supplier, deadline: p.confirmation_deadline })),
    openDisputes: disputes.map((d) => ({ disputeId: d.id, number: d.number, status: d.status, amount: d.amount_claimed })),
    savings: ledger,
    forecast: { items: fc.items.length, atOrBelowNaive: beats },
    completedRuns: runs.map((r) => ({ agentId: r.agent_id, goal: r.goal, status: r.status })),
  };
}

const usd = (n: number) => `$${n.toFixed(2)}`;

/** Rule-based standup (FR-061): the same structure, written by templates from the facts. */
export function ruleBasedBriefing(f: BriefingFacts): Briefing {
  const byAgent = (a: string) => ({
    needsYou: [
      ...f.proposals.filter((p) => p.agentId === a).map((p) => ({ text: p.summary, refType: 'action' as const, refId: p.actionId })),
      ...f.questions.filter((q) => q.agentId === a).map((q) => ({ text: q.text, refType: 'question' as const, refId: q.questionId })),
    ].slice(0, 6),
  });
  const decisions = f.proposals.length + f.questions.length;
  return {
    summary: `${f.ordersDrafted.length} order(s) prepared totalling ${usd(f.ordersTotal)}${f.savingTotal > 0 ? `, saving ${usd(f.savingTotal)} vs preferred suppliers` : ''}. ${decisions ? `${decisions} decision(s) need you.` : 'Nothing needs you right now.'}${f.critical.length ? ` Critical: ${f.critical.map((c) => c.name).join(', ')}.` : ''}`,
    agents: [
      { agentId: 'pilot', done: [{ text: 'Ran the morning purchasing review and delegated forecasting and ordering' }], today: [{ text: 'Watch supplier confirmations and escalate blockers' }], ...byAgent('pilot') },
      {
        agentId: 'demand-planner',
        done: [{ text: `Refreshed weather and holidays (weather ${f.contextStatus.weather_forecast ?? 'not checked'}) and forecast ${f.forecast.items} dishes` }],
        today: f.upcomingHolidays.map((h) => ({ text: h.date === f.weatherTomorrow?.date ? `Holiday tomorrow: ${h.name} — the forecast includes its effect` : `${h.name} on ${h.date} — the forecast includes its effect; order ahead for supplier lead times` })),
        ...byAgent('demand-planner'),
      },
      {
        agentId: 'buyer',
        done: f.ordersDrafted.slice(0, 6).map((p) => ({ text: `${p.number} for ${p.supplier}: ${usd(p.total)} (${p.status.replace('_', ' ')})`, refType: 'purchase_order' as const, refId: p.poId })),
        today: f.awaitingConfirmation.slice(0, 6).map((p) => ({ text: `Waiting for ${p.supplier} to confirm ${p.number}`, refType: 'purchase_order' as const, refId: p.poId })),
        ...byAgent('buyer'),
      },
      { agentId: 'ap-clerk', done: [], today: f.openDisputes.map((d) => ({ text: `Follow up ${d.number} (${d.status}, ${usd(d.amount)})`, refType: 'dispute' as const, refId: d.disputeId })).slice(0, 6), ...byAgent('ap-clerk') },
    ],
    wasteReductionIdeas: f.expiryRisks.slice(0, 4).map((r) => ({ text: `Feature a special with ${r.name}: ${r.atRisk} ${r.unit} (${usd(r.valueAtRisk)}) at risk before ${r.expiresAt}`, ingredientIds: [r.ingredientId] })),
    risks: [
      ...f.critical.map((c) => `${c.name} is critical (${c.daysOfCover ?? 0} days of cover)`),
      ...(f.contextStatus.weather_forecast && f.contextStatus.weather_forecast !== 'ok' ? ['Weather unavailable — model without weather used'] : []),
    ].slice(0, 6),
    confidence: 'medium',
  };
}

/** Zod + referential + numeric grounding (AC-056). Returns the problems found. */
export function validateBriefing(b: unknown, f: BriefingFacts): { ok: true; briefing: Briefing } | { ok: false; errors: string[] } {
  const p = BriefingSchema.safeParse(b);
  if (!p.success) return { ok: false, errors: p.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) };
  const errors: string[] = [];
  const ids = new Set<string>([
    ...f.proposals.map((x) => x.actionId),
    ...f.questions.map((x) => x.questionId),
    ...f.ordersDrafted.map((x) => x.poId),
    ...f.awaitingConfirmation.map((x) => x.poId),
    ...f.openDisputes.map((x) => x.disputeId),
    ...f.critical.map((x) => x.ingredientId),
    ...f.low.map((x) => x.ingredientId),
    ...f.expiryRisks.map((x) => x.ingredientId),
  ]);
  const texts: string[] = [p.data.summary, ...p.data.risks];
  for (const a of p.data.agents)
    for (const it of [...a.done, ...a.today, ...a.needsYou]) {
      texts.push(it.text);
      if (it.refId && !ids.has(it.refId) && it.refType !== 'task') errors.push(`unknown reference ${it.refId}`);
    }
  for (const w of p.data.wasteReductionIdeas) {
    texts.push(w.text);
    for (const i of w.ingredientIds) if (!f.inStockIngredientIds.includes(i)) errors.push(`waste idea uses ingredient not in stock: ${i}`);
  }
  const g = checkGrounding(texts.join('\n'), f);
  if (!g.ok) errors.push(`numbers not in the facts: ${g.ungrounded.join(', ')}`);
  return errors.length ? { ok: false, errors } : { ok: true, briefing: p.data };
}

const SYSTEM =
  'You are Pilot, the purchasing lead of a restaurant AI team. Write the daily standup from the JSON facts only. Per agent: what was done, what is planned today, and what needs a human (link proposals and questions by their IDs). Waste-reduction ideas may only use ingredient IDs from inStockIngredientIds. If weatherTomorrow.holiday is set, name that holiday in the today items of the demand-planner agent. Also name every holiday in upcomingHolidays (with its date) in the demand-planner today items. Never state a number, price or date that is not in the facts. Keep each item short.';

export async function generateBriefing(f: BriefingFacts, useAi: boolean, fallbackReason?: string | null): Promise<{ briefing: Briefing; mode: 'ai' | 'rule_based'; reason?: FallbackReason; model?: string }> {
  if (!useAi) return { briefing: ruleBasedBriefing(f), mode: 'rule_based', reason: (fallbackReason as FallbackReason | null) ?? 'no_api_key' };
  const avail = aiAvailable();
  if (!avail.ok) return { briefing: ruleBasedBriefing(f), mode: 'rule_based', reason: avail.reason };
  let errors: string[] = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const prompt = JSON.stringify({ facts: f, ...(errors.length ? { previousErrors: errors } : {}) });
      const { response, model } = await llmStructured('briefing', { system: SYSTEM, prompt, schema: BRIEFING_JSON_SCHEMA });
      const v = validateBriefing(JSON.parse(response.text), f);
      if (v.ok) return { briefing: v.briefing, mode: 'ai', model };
      errors = v.errors;
    } catch (e) {
      if (e instanceof LlmUnavailable) return { briefing: ruleBasedBriefing(f), mode: 'rule_based', reason: e.reason };
      errors = [(e as Error).message];
    }
  }
  return { briefing: ruleBasedBriefing(f), mode: 'rule_based', reason: 'validation_failed' };
}

/** publish_briefing tool: one morning briefing per day (idempotent) + email to opted-in Chef/Owner users (FR-093). */
export async function publishBriefing(run: RunInfo, note?: string) {
  const date = localDate();
  const runKey = run.playbook === 'morning' ? `${date}:morning` : null;
  if (runKey) {
    const existing = db().get<any>(`SELECT * FROM briefings WHERE run_key = ?`, runKey);
    if (existing) return { briefingId: existing.id, mode: existing.mode, reason: existing.reason, alreadyPublished: true };
  }
  const since = db().get<{ started_at: string }>(`SELECT started_at FROM agent_runs WHERE id = ?`, run.id)?.started_at ?? nowIso();
  const facts = buildFacts(since);
  const { briefing, mode, reason, model } = await generateBriefing(facts, run.mode === 'ai', run.fallbackReason);
  const bid = id('brf');
  db().tx(() => {
    db().run(
      `INSERT INTO briefings (id, date, run_id, run_key, mode, reason, briefing_json, facts_json, created_at) VALUES (?,?,?,?,?,?,?,?,?)`,
      bid,
      date,
      run.id,
      runKey,
      mode,
      reason ?? (model ? `model:${model}` : null),
      JSON.stringify({ ...briefing, note: note ?? null }),
      JSON.stringify(facts),
      nowIso(),
    );
    if (runKey && getSettings().briefingEmail) {
      for (const u of db().all<{ email: string; name: string }>(`SELECT email, name FROM users WHERE role IN ('owner','chef') AND briefing_opt_in = 1`)) {
        queueEmail({ kind: 'briefing', to: u.email, toName: u.name, ...briefingEmail(briefing, mode, reason), relatedType: 'briefing', relatedId: bid, idempotencyKey: `briefing:${date}:${u.email}` });
      }
    }
  });
  notify('briefing', `Standup ready (${mode === 'ai' ? 'AI' : `rule-based: ${reason}`})`, briefing.summary, '/');
  publish('briefing.published', { id: bid });
  return { briefingId: bid, mode, reason, summary: briefing.summary };
}

function briefingEmail(b: Briefing, mode: string, reason?: string) {
  const names: Record<string, string> = { pilot: 'Pilot', 'demand-planner': 'Demand Planner', buyer: 'Buyer', 'ap-clerk': 'AP Clerk' };
  const link = config.APP_BASE_URL;
  const sec = (title: string, items: { text: string }[]) => (items.length ? `<p style="margin:6px 0 2px"><b>${title}</b></p><ul style="margin:0">${items.map((i) => `<li>${esc(i.text)}</li>`).join('')}</ul>` : '');
  const html = layout(
    `Standup — ${localDate()}`,
    `<p>${esc(b.summary)}</p>${b.agents.map((a) => `<h3 style="margin:14px 0 4px">${names[a.agentId]}</h3>${a.needsYou.length + a.done.length + a.today.length ? `${sec('Needs you', a.needsYou)}${sec('Done', a.done)}${sec('Today', a.today)}` : '<p style="color:#666">Nothing to report today.</p>'}`).join('')}
     ${b.wasteReductionIdeas.length ? `<h3>Waste-reduction ideas</h3><ul>${b.wasteReductionIdeas.map((w) => `<li>${esc(w.text)}</li>`).join('')}</ul>` : ''}
     <p><a href="${esc(link)}/inbox">Open the Inbox</a> · Briefing: ${mode === 'ai' ? 'AI' : `rule-based (${esc(reason)})`}</p>`,
  );
  const text = `${b.summary}\n\n${b.agents.map((a) => `${names[a.agentId]}\n${[...a.needsYou.map((i) => `! ${i.text}`), ...a.done.map((i) => `✓ ${i.text}`), ...a.today.map((i) => `→ ${i.text}`)].join('\n') || 'Nothing to report today.'}`).join('\n\n')}\n\n${link}/inbox`;
  return { subject: `StockPilot standup ${localDate()}${b.agents.some((a) => a.needsYou.length) ? ' — decisions waiting' : ''}`, html, text };
}

export function latestBriefing() {
  const r = db().get<any>(`SELECT * FROM briefings ORDER BY created_at DESC LIMIT 1`);
  return r ? { id: r.id, date: r.date, mode: r.mode, reason: r.reason, runId: r.run_id, briefing: json(r.briefing_json, null), createdAt: r.created_at } : null;
}
