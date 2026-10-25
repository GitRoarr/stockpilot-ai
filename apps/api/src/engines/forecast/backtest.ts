import {
  type Features,
  type ModelId,
  contextEffect,
  holtWintersFit,
  holtWintersForecast,
  m4Fit,
  quantile,
  seasonalNaive,
  std,
  weekdayMean,
} from './models.js';

export const HORIZON = 7;
export const BACKTEST_DAYS = 28;

export type ItemForecastInput = {
  itemId: string;
  y: number[]; // history, oldest first, ending yesterday
  feats: Features[]; // aligned with y, plus `future` features appended for forecast days
};

export type ItemBacktest = {
  itemId: string;
  wape: Record<ModelId, number | null>;
  selected: ModelId;
  m4Eligible: boolean;
  beta: Record<string, number> | null;
  /** errors[h-1][originIndex] = actual − forecast of the selected model */
  errors: number[][];
  lowHistory: boolean;
};

function makeForecasters(): Record<ModelId, (y: number[], feats: Features[]) => (h: number) => number> {
  return {
    M1: (y) => (h) => seasonalNaive(y, h),
    M2: (y) => (h) => weekdayMean(y, h),
    M3: (y) => {
      const s = holtWintersFit(y);
      return (h) => holtWintersForecast(s, y.length, h);
    },
    M4: (y, feats) => {
      const fit = m4Fit(y, feats);
      return (h) => holtWintersForecast(fit.hw, y.length, h) * (1 + (fit.usable ? contextEffect(fit.beta, feats[y.length + h - 1]) : 0));
    },
  };
}

const clamp0 = (v: number) => Math.max(0, v);

/**
 * Rolling-origin backtest (FR-025): each of the last 28 days is an origin; the model is refitted on data before it
 * and forecasts horizons 1–7 where actuals exist. WAPE = Σ|y−ŷ| / Σy.
 */
export function backtestItem(input: ItemForecastInput): ItemBacktest {
  const { y, feats } = input;
  const n = y.length;
  const models = makeForecasters();
  const lowHistory = n < 35;
  const ids: ModelId[] = ['M1', 'M2', 'M3', 'M4'];
  const errs: Record<ModelId, number[][]> = { M1: [], M2: [], M3: [], M4: [] };
  for (const m of ids) errs[m] = Array.from({ length: HORIZON }, () => []);
  const firstOrigin = Math.max(21, n - BACKTEST_DAYS);
  const m4Check = m4Fit(y, feats);

  for (let o = firstOrigin; o < n; o++) {
    const train = y.slice(0, o);
    const fs = Object.fromEntries(ids.map((m) => [m, models[m](train, feats)])) as Record<ModelId, (h: number) => number>;
    for (let h = 1; h <= HORIZON && o + h - 1 < n; h++) {
      const actual = y[o + h - 1];
      for (const m of ids) {
        errs[m][h - 1].push(actual - clamp0(fs[m](h)));
      }
    }
  }
  // WAPE over every (origin, horizon) pair.
  const wape = {} as Record<ModelId, number | null>;
  for (const m of ids) {
    let num = 0;
    let den = 0;
    for (let h = 1; h <= HORIZON; h++) {
      errs[m][h - 1].forEach((e, k) => {
        num += Math.abs(e);
        den += y[firstOrigin + k + h - 1];
      });
    }
    wape[m] = den > 0 ? num / den : null;
  }
  const m4Eligible = m4Check.usable && wape.M4 !== null && wape.M3 !== null && wape.M4 < wape.M3;
  let selected: ModelId = 'M1';
  for (const m of ['M2', 'M3', 'M4'] as ModelId[]) {
    if (m === 'M4' && !m4Eligible) continue;
    if (wape[m] !== null && (wape[selected] === null || wape[m]! < wape[selected]!)) selected = m;
  }
  return {
    itemId: input.itemId,
    wape,
    selected,
    m4Eligible,
    beta: m4Check.usable ? m4Check.beta : null,
    errors: errs[selected],
    lowHistory,
  };
}

export type ItemForecast = {
  itemId: string;
  model: ModelId;
  daily: { h: number; value: number; p10: number; p90: number; effect: number }[];
};

/** Produces h = 1..days forecasts from the full history with the selected model. */
export function forecastItem(input: ItemForecastInput, bt: ItemBacktest, days: number): ItemForecast {
  const { y, feats } = input;
  const n = y.length;
  let f: (h: number) => { v: number; effect: number };
  if (bt.selected === 'M3' || bt.selected === 'M4') {
    const fit = m4Fit(y, feats);
    f = (h) => {
      const base = holtWintersForecast(fit.hw, n, h);
      const effect = bt.selected === 'M4' && fit.usable ? contextEffect(fit.beta, feats[n + h - 1]) : 0;
      return { v: base * (1 + effect), effect };
    };
  } else if (bt.selected === 'M2') f = (h) => ({ v: weekdayMean(y, h), effect: 0 });
  else f = (h) => ({ v: seasonalNaive(y, h), effect: 0 });
  const daily = [];
  for (let h = 1; h <= days; h++) {
    const { v, effect } = f(h);
    const e = bt.errors[Math.min(h, HORIZON) - 1] ?? [];
    daily.push({ h, value: clamp0(v), p10: clamp0(v + quantile(e, 0.1)), p90: clamp0(v + quantile(e, 0.9)), effect });
  }
  return { itemId: input.itemId, model: bt.selected, daily };
}

/**
 * Ingredient-level horizon error (FR-026): map item errors through recipes per (h, origin), then
 * σ_H = sqrt(Σ_h σ_h²) over the first H horizons (independence assumption, Solution Design §D2.1).
 */
export function ingredientSigmaH(
  backtests: ItemBacktest[],
  recipe: Map<string, Map<string, number>>, // itemId -> ingredientId -> qty
  ingredientId: string,
  H: number,
): number {
  let total = 0;
  for (let h = 1; h <= Math.min(H, HORIZON); h++) {
    const len = Math.max(0, ...backtests.map((b) => b.errors[h - 1]?.length ?? 0));
    const agg = new Array(len).fill(0);
    for (const b of backtests) {
      const q = recipe.get(b.itemId)?.get(ingredientId);
      if (!q) continue;
      (b.errors[h - 1] ?? []).forEach((e, k) => (agg[k] += e * q));
    }
    total += std(agg) ** 2;
  }
  if (H > HORIZON) total *= H / HORIZON;
  return Math.sqrt(total);
}

