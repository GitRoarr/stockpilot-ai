import { db } from '../db/sqlite.js';
import { backtestItem, forecastItem, ingredientSigmaH, type ItemBacktest } from '../engines/forecast/backtest.js';
import { MODEL_LABEL, mean, type ModelId } from '../engines/forecast/models.js';
import { addDays, id, json, localDate, nowIso } from '../lib/util.js';
import { buildFeatures, contextStatus, type ContextDay } from './context.js';

// Forecast service (SRS FR-020 – FR-029): builds series from the database, runs the backtest and forecasts.
export const HISTORY_DAYS = 180;

export type MenuItem = { id: string; name: string; price: number };
export type ModelRun = { id: string; createdAt: string; historyEnd: string; backtests: ItemBacktest[]; durationMs: number };

export function historyWindow(today = localDate()): { start: string; end: string; dates: string[] } {
  const end = addDays(today, -1);
  const start = addDays(today, -HISTORY_DAYS);
  const dates: string[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) dates.push(d);
  return { start, end, dates };
}

export function menuItems(): MenuItem[] {
  return db().all<MenuItem>(`SELECT id, name, price FROM menu_items WHERE active = 1 ORDER BY name`);
}

function series(itemIds: string[], dates: string[]): Map<string, number[]> {
  const idx = new Map(dates.map((d, i) => [d, i]));
  const out = new Map(itemIds.map((i) => [i, new Array(dates.length).fill(0)]));
  for (const r of db().all<{ date: string; menu_item_id: string; qty: number }>(`SELECT date, menu_item_id, qty FROM sales_records WHERE date BETWEEN ? AND ?`, dates[0], dates[dates.length - 1])) {
    const i = idx.get(r.date);
    const s = out.get(r.menu_item_id);
    if (i !== undefined && s) s[i] = r.qty;
  }
  return out;
}

/** Fits and backtests every menu item (FR-025, FR-028). Stored as a model run; reused for the day. */
export function fitModels(): ModelRun {
  const t0 = Date.now();
  const today = localDate();
  const { dates, end } = historyWindow(today);
  const items = menuItems();
  const y = series(items.map((i) => i.id), dates);
  const future = Array.from({ length: 14 }, (_, k) => addDays(today, k));
  const { features } = buildFeatures([...dates, ...future]);
  const backtests = items.map((it) => backtestItem({ itemId: it.id, y: y.get(it.id)!, feats: features }));
  const run: ModelRun = { id: id('fmr'), createdAt: nowIso(), historyEnd: end, backtests, durationMs: Date.now() - t0 };
  db().run(`INSERT INTO forecast_model_runs (id, created_at, summary_json) VALUES (?,?,?)`, run.id, run.createdAt, JSON.stringify(run));
  return run;
}

export function latestModelRun(): ModelRun | undefined {
  const row = db().get<{ summary_json: string }>(`SELECT summary_json FROM forecast_model_runs ORDER BY created_at DESC LIMIT 1`);
  return row ? json<ModelRun>(row.summary_json, undefined as never) : undefined;
}

/** Current model run: refitted if none exists or its history no longer ends yesterday. */
export function currentModelRun(): ModelRun {
  const r = latestModelRun();
  const { end } = historyWindow();
  if (r && r.historyEnd === end && r.backtests.length === menuItems().length) return r;
  return fitModels();
}

export type DemandEvent = { id: string; date: string; description: string; extra: { covers?: number; items?: Record<string, number> }; status: string };

export function activeDemandEvents(from: string, to: string): DemandEvent[] {
  return db()
    .all<{ id: string; date: string; description: string; extra_json: string; status: string }>(`SELECT * FROM demand_events WHERE status = 'active' AND date BETWEEN ? AND ? ORDER BY date`, from, to)
    .map((r) => ({ id: r.id, date: r.date, description: r.description, status: r.status, extra: json(r.extra_json, {}) }));
}

/** Extra dish quantities of a demand event: explicit per-dish quantities, plus covers spread by the recent sales mix. */
export function eventExtras(ev: { covers?: number; items?: Record<string, number> }, mix: Map<string, number>): Map<string, number> {
  const out = new Map<string, number>();
  for (const [k, v] of Object.entries(ev.items ?? {})) out.set(k, (out.get(k) ?? 0) + v);
  if (ev.covers && ev.covers > 0) {
    const explicit = [...out.values()].reduce((a, b) => a + b, 0);
    const remaining = Math.max(0, ev.covers - explicit);
    const total = [...mix.values()].reduce((a, b) => a + b, 0) || 1;
    for (const [k, v] of mix) out.set(k, (out.get(k) ?? 0) + (remaining * v) / total);
  }
  return out;
}

export function salesMix(): Map<string, number> {
  const { dates } = historyWindow();
  const y = series(menuItems().map((i) => i.id), dates.slice(-28));
  return new Map([...y].map(([k, v]) => [k, mean(v)]));
}

export type ItemForecastView = {
  menuItemId: string;
  name: string;
  model: ModelId;
  modelLabel: string;
  wape: Record<ModelId, number | null>;
  baselineWape: number | null;
  m4Eligible: boolean;
  beta: Record<string, number> | null;
  lowHistory: boolean;
  daily: { date: string; value: number; p10: number; p90: number; effect: number; eventExtra: number }[];
  recent: { date: string; qty: number }[];
};

export type ForecastView = {
  modelRunId: string;
  historyEnd: string;
  backtestMs: number;
  items: ItemForecastView[];
  context: { days: ContextDay[]; status: ReturnType<typeof contextStatus> };
  events: DemandEvent[];
};

/** Forecast for `days` days starting today (h = 1 is today, since history ends yesterday). */
export function getForecast(days = 7, extraEvents: { date: string; extra: DemandEvent['extra'] }[] = []): ForecastView {
  const today = localDate();
  const run = currentModelRun();
  const { dates } = historyWindow(today);
  const items = menuItems();
  const y = series(items.map((i) => i.id), dates);
  const future = Array.from({ length: Math.max(days, 14) }, (_, k) => addDays(today, k));
  const { features, days: ctxDays } = buildFeatures([...dates, ...future]);
  const events = activeDemandEvents(today, addDays(today, days));
  const mix = salesMix();
  const extrasByDate = new Map<string, Map<string, number>>();
  for (const ev of [...events, ...extraEvents]) {
    const ex = eventExtras(ev.extra, mix);
    const cur = extrasByDate.get(ev.date) ?? new Map<string, number>();
    for (const [k, v] of ex) cur.set(k, (cur.get(k) ?? 0) + v);
    extrasByDate.set(ev.date, cur);
  }
  const bts = new Map(run.backtests.map((b) => [b.itemId, b]));
  const out: ItemForecastView[] = items.map((it) => {
    const bt = bts.get(it.id)!;
    const f = forecastItem({ itemId: it.id, y: y.get(it.id)!, feats: features }, bt, days);
    return {
      menuItemId: it.id,
      name: it.name,
      model: bt.selected,
      modelLabel: MODEL_LABEL[bt.selected],
      wape: bt.wape,
      baselineWape: bt.wape.M1,
      m4Eligible: bt.m4Eligible,
      beta: bt.beta,
      lowHistory: bt.lowHistory,
      daily: f.daily.map((d) => {
        const date = addDays(today, d.h - 1);
        const extra = extrasByDate.get(date)?.get(it.id) ?? 0;
        return { date, value: d.value + extra, p10: d.p10 + extra, p90: d.p90 + extra, effect: d.effect, eventExtra: extra };
      }),
      recent: dates.slice(-28).map((date, k) => ({ date, qty: y.get(it.id)![dates.length - 28 + k] })),
    };
  });
  return {
    modelRunId: run.id,
    historyEnd: run.historyEnd,
    backtestMs: run.durationMs,
    items: out,
    context: { days: ctxDays.slice(dates.length, dates.length + days), status: contextStatus() },
    events,
  };
}

export function recipeMap(): Map<string, Map<string, number>> {
  const m = new Map<string, Map<string, number>>();
  for (const r of db().all<{ menu_item_id: string; ingredient_id: string; qty: number }>(`SELECT * FROM recipe_lines`)) {
    if (!m.has(r.menu_item_id)) m.set(r.menu_item_id, new Map());
    m.get(r.menu_item_id)!.set(r.ingredient_id, r.qty);
  }
  return m;
}

/** D(i,d): ingredient demand per day from dish forecasts through recipes (FR-021). */
export function ingredientDemand(fc: ForecastView): Map<string, number[]> {
  const recipe = recipeMap();
  const out = new Map<string, number[]>();
  for (const it of fc.items) {
    for (const [ing, q] of recipe.get(it.menuItemId) ?? []) {
      const arr = out.get(ing) ?? new Array(it.daily.length).fill(0);
      it.daily.forEach((d, k) => (arr[k] += d.value * q));
      out.set(ing, arr);
    }
  }
  return out;
}

export function sigmaFor(run: ModelRun, ingredientId: string, H: number): number {
  return ingredientSigmaH(run.backtests, recipeMap(), ingredientId, H);
}
