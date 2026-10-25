import { z } from 'zod';
import { db } from '../../db/sqlite.js';
import { refreshContext } from '../../services/context.js';
import { eventExtras, getForecast, ingredientDemand, menuItems, salesMix } from '../../services/forecast.js';
import { audit, publish } from '../../lib/events.js';
import { addDays, daysBetween, id, localDate, nowIso, round1 } from '../../lib/util.js';
import { ToolError, type ToolDef } from './types.js';

// Demand Planner tools (SRS FR-010, FR-020 – FR-029).
const r1 = round1;

export const refreshContextTool: ToolDef<{ force?: boolean }> = {
  name: 'refresh_context',
  description: 'Refresh the weather forecast (Open-Meteo), historical weather and public holidays (Nager.Date). Returns the status of each source.',
  cls: 'compute',
  schema: z.object({ force: z.boolean().optional() }).strict(),
  execute: async (a) => {
    const st = await refreshContext({ force: a.force });
    return Object.fromEntries(Object.entries(st).map(([k, v]) => [k, { status: v.status, message: v.message }]));
  },
};

export const getForecastTool: ToolDef<{ days?: number; menuItem?: string }> = {
  name: 'get_forecast',
  description: 'Dish demand forecast for the next days (selected model per dish, WAPE vs seasonal naive, prediction interval, weather/holiday effects, demand events).',
  cls: 'read',
  schema: z.object({ days: z.number().int().min(1).max(7).optional(), menuItem: z.string().max(80).optional() }).strict(),
  execute: (a) => {
    const fc = getForecast(a.days ?? 7);
    const items = fc.items.filter((i) => !a.menuItem || i.name.toLowerCase().includes(a.menuItem.toLowerCase()) || i.menuItemId === a.menuItem);
    const highUncertainty = items.filter((i) => i.daily[1] && i.daily[1].p90 - i.daily[1].p10 > 0.6 * Math.max(1, i.daily[1].value)).map((i) => i.name);
    return {
      historyEnd: fc.historyEnd,
      items: items.map((i) => ({
        menuItemId: i.menuItemId,
        name: i.name,
        model: i.model,
        wape: i.wape[i.model] === null ? null : r1((i.wape[i.model] as number) * 100),
        naiveWape: i.baselineWape === null ? null : r1(i.baselineWape * 100),
        next: i.daily.map((d) => ({ date: d.date, qty: r1(d.value), p10: r1(d.p10), p90: r1(d.p90), effectPct: r1(d.effect * 100), event: d.eventExtra ? r1(d.eventExtra) : undefined })),
      })),
      context: fc.context.days.map((d) => ({ date: d.date, tmaxF: d.tmaxF, precipIn: d.precipIn, holiday: d.holiday, holidayEve: d.holidayEve })),
      contextStatus: Object.fromEntries(Object.entries(fc.context.status).map(([k, v]) => [k, v.status])),
      events: fc.events.map((e) => ({ id: e.id, date: e.date, description: e.description })),
      highUncertainty,
    };
  },
};

export const getBacktestReport: ToolDef<Record<string, never>> = {
  name: 'get_backtest_report',
  description: 'Rolling-origin backtest (last 28 days, horizons 1–7): WAPE per model (M1 seasonal naive, M2 weekday mean, M3 Holt-Winters, M4 + weather/holiday) and the selected model per dish.',
  cls: 'read',
  schema: z.object({}).strict(),
  execute: () => {
    const fc = getForecast(1);
    const rows = fc.items.map((i) => ({
      name: i.name,
      selected: i.model,
      wapePct: Object.fromEntries(Object.entries(i.wape).map(([k, v]) => [k, v === null ? null : r1(v * 100)])),
      m4Eligible: i.m4Eligible,
      rainEffectPct: i.beta ? r1(i.beta.rain * 100) : null,
    }));
    const beats = rows.filter((r) => (r.wapePct[r.selected] ?? 999) <= (r.wapePct.M1 ?? 0)).length;
    return { modelRunId: fc.modelRunId, items: rows, itemsAtOrBelowNaive: beats, itemCount: rows.length, note: 'Illustrative demo data: accuracy demonstrates the pipeline, not real-world accuracy.' };
  },
};

const eventSchema = z
  .object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('YYYY-MM-DD, today or later'),
    description: z.string().min(3).max(200),
    extraCovers: z.number().int().min(1).max(500).optional().describe('Extra guests expected'),
    items: z.array(z.object({ menuItem: z.string().min(2).max(80), qty: z.number().int().min(1).max(500) })).max(14).optional().describe('Expected extra portions per dish'),
  })
  .strict();
type EventArgs = z.infer<typeof eventSchema>;

function resolveEvent(a: EventArgs): { items: Record<string, number>; covers?: number } {
  const today = localDate();
  const delta = daysBetween(today, a.date);
  if (delta < 0 || delta > 30) throw new ToolError('invalid_date', 'Date must be between today and 30 days ahead');
  if (!a.extraCovers && !a.items?.length) throw new ToolError('invalid_event', 'Give extraCovers or items');
  const menu = menuItems();
  const items: Record<string, number> = {};
  for (const it of a.items ?? []) {
    const m = menu.find((x) => x.id === it.menuItem || x.name.toLowerCase() === it.menuItem.toLowerCase()) ?? menu.find((x) => x.name.toLowerCase().includes(it.menuItem.toLowerCase().replace(/s$/, '')));
    if (!m) throw new ToolError('unknown_menu_item', `No menu item matches "${it.menuItem}". Menu: ${menu.map((x) => x.name).join(', ')}`);
    items[m.id] = (items[m.id] ?? 0) + it.qty;
  }
  return { items, covers: a.extraCovers };
}

function ingredientImpact(date: string, extra: { items: Record<string, number>; covers?: number }) {
  const today = localDate();
  const k = daysBetween(today, date);
  const base = ingredientDemand(getForecast(Math.max(7, k + 1)));
  const withEv = ingredientDemand(getForecast(Math.max(7, k + 1), [{ date, extra }]));
  const names = new Map(db().all<{ id: string; name: string; unit: string }>(`SELECT id, name, unit FROM ingredients`).map((r) => [r.id, r]));
  return [...withEv]
    .map(([ing, arr]) => ({ ingredientId: ing, name: names.get(ing)?.name, unit: names.get(ing)?.unit, delta: r1((arr[k] ?? 0) - (base.get(ing)?.[k] ?? 0)) }))
    .filter((x) => x.delta > 0)
    .sort((a, b) => b.delta - a.delta)
    .slice(0, 8);
}

export const addDemandEvent: ToolDef<EventArgs> = {
  name: 'add_demand_event',
  description: 'Record a demand event (e.g. a private party) that the forecast adds on top of the model. Becomes a proposal if policy requires approval.',
  cls: 'act',
  schema: eventSchema,
  prepare: (a) => {
    const ex = resolveEvent(a);
    const parts = [a.extraCovers ? `${a.extraCovers} extra covers` : '', ...Object.entries(ex.items).map(([k, v]) => `${v} × ${menuItems().find((m) => m.id === k)?.name}`)].filter(Boolean);
    return { summary: `Add demand event on ${a.date}: ${a.description} (${parts.join(', ')})` };
  },
  execute: (a, ctx) => {
    const ex = resolveEvent(a);
    const eid = id('dev');
    db().run(`INSERT INTO demand_events (id, date, description, extra_json, status, created_by, created_at) VALUES (?,?,?,?,'active',?,?)`, eid, a.date, a.description, JSON.stringify(ex), ctx.approver?.id ?? `agent:${ctx.run.agentId}`, nowIso());
    audit(ctx.approver ? { type: 'user', id: ctx.approver.id } : ctx.actor, 'demand_event.created', 'demand_event', eid, { after: { ...a, ...ex } });
    publish('forecast.updated', { eventId: eid });
    return { demandEventId: eid, date: a.date, impact: ingredientImpact(a.date, ex) };
  },
};

export const simulateScenario: ToolDef<EventArgs> = {
  name: 'simulate_scenario',
  description: 'What-if: ingredient demand change for a hypothetical event, without saving anything.',
  cls: 'compute',
  schema: eventSchema,
  execute: (a) => {
    const ex = resolveEvent(a);
    const mix = salesMix();
    const dishes = eventExtras(ex, mix);
    const names = new Map(menuItems().map((m) => [m.id, m.name]));
    return {
      date: a.date,
      dishes: [...dishes].filter(([, v]) => v >= 0.5).map(([k, v]) => ({ name: names.get(k), qty: r1(v) })),
      ingredients: ingredientImpact(a.date, ex),
      horizonNote: `Within the next ${daysBetween(localDate(), addDays(a.date, 0)) + 1} days`,
    };
  },
};
