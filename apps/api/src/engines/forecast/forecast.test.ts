import { describe, expect, it } from 'vitest';
import { type Features, holtWintersFit, holtWintersForecast, m4Fit, seasonalNaive, weekdayMean } from './models.js';
import { backtestItem, forecastItem } from './backtest.js';

const WEEK = [20, 18, 19, 22, 30, 41, 32]; // a stable weekly pattern

function series(weeks: number, noise = 0): number[] {
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 2;
  return Array.from({ length: weeks * 7 }, (_, t) => Math.max(0, WEEK[t % 7] + noise * rnd()));
}

const noFeats = (n: number): Features[] => Array.from({ length: n }, () => ({ rain: 0, temp: 0, holiday: 0, eve: 0, known: true }));

describe('baseline models', () => {
  it('M1 repeats the same weekday', () => {
    const y = series(4);
    expect(seasonalNaive(y, 1)).toBe(WEEK[0]);
    expect(seasonalNaive(y, 8)).toBe(WEEK[0]);
  });

  it('M2 averages the same weekday over 4 weeks', () => {
    const y = series(5);
    y[y.length - 7] = 40; // last Sunday spike → mean of (20,20,20,40)
    expect(weekdayMean(y, 1)).toBe(25);
  });

  it('M3 learns a pure weekly pattern', () => {
    const y = series(12);
    const s = holtWintersFit(y);
    for (let h = 1; h <= 7; h++) expect(holtWintersForecast(s, y.length, h)).toBeCloseTo(WEEK[(y.length + h - 1) % 7], 1);
  });
});

describe('M4 context regression (AC-023)', () => {
  it('recovers a planted −10% rain effect', () => {
    const y = series(26, 1.0);
    const feats = noFeats(y.length);
    let seed = 3;
    for (let t = 0; t < y.length; t++) {
      seed = (seed * 48271) % 2147483647;
      if (seed % 4 === 0) {
        feats[t].rain = 1;
        y[t] = y[t] * 0.9;
      }
    }
    const fit = m4Fit(y, feats);
    expect(fit.usable).toBe(true);
    expect(fit.beta.rain).toBeGreaterThan(-0.13);
    expect(fit.beta.rain).toBeLessThan(-0.07);
  });
});

describe('backtest and selection (FR-025)', () => {
  it('scores all four models with WAPE and picks the lowest', () => {
    const y = series(20, 2);
    const feats = noFeats(y.length + 8);
    const bt = backtestItem({ itemId: 'm', y, feats });
    for (const m of ['M1', 'M2', 'M3', 'M4'] as const) expect(bt.wape[m]).not.toBeNull();
    const best = Math.min(bt.wape.M1!, bt.wape.M2!, bt.wape.M3!, ...(bt.m4Eligible ? [bt.wape.M4!] : []));
    expect(bt.wape[bt.selected]).toBe(best);
    expect(bt.errors).toHaveLength(7);
  });

  it('produces non-negative forecasts with ordered intervals', () => {
    const y = series(20, 3);
    const feats = noFeats(y.length + 8);
    const bt = backtestItem({ itemId: 'm', y, feats });
    const f = forecastItem({ itemId: 'm', y, feats }, bt, 8);
    expect(f.daily).toHaveLength(8);
    for (const d of f.daily) {
      expect(d.value).toBeGreaterThanOrEqual(0);
      expect(d.p10).toBeLessThanOrEqual(d.p90);
    }
  });
});

describe('AC-020 — backtest WAPE against hand-calculated fixture values', () => {
  // Independent oracle: rolling origins = last 28 days, horizons 1–7 with an actual, WAPE = Σ|y−ŷ| / Σy.
  function oracleWape(y: number[], f: (train: number[], h: number) => number): number {
    let num = 0;
    let den = 0;
    for (let o = Math.max(21, y.length - 28); o < y.length; o++)
      for (let h = 1; h <= 7 && o + h - 1 < y.length; h++) {
        num += Math.abs(y[o + h - 1] - Math.max(0, f(y.slice(0, o), h)));
        den += y[o + h - 1];
      }
    return num / den;
  }

  it('a pure weekly pattern: every model is exact (WAPE 0.0000) and the tie selects M1', () => {
    const y = series(12);
    const bt = backtestItem({ itemId: 'p', y, feats: noFeats(y.length + 8) });
    for (const m of ['M1', 'M2', 'M3', 'M4'] as const) expect(bt.wape[m]).toBeCloseTo(0, 4);
    expect(bt.selected).toBe('M1');
    expect(bt.m4Eligible).toBe(false); // M4 must beat M3, not tie
  });

  it('one demand spike: M1 and M2 equal the hand calculation to 4 decimals', () => {
    const y = series(12);
    y[y.length - 10] += 28; // a private party 10 days ago
    const bt = backtestItem({ itemId: 's', y, feats: noFeats(y.length + 8) });
    // By hand: M1 is wrong by 28 for the 7 (origin, horizon) pairs that forecast the spike day and the 7 that forecast the
    // same weekday one week later: 14 × 28 = 392. Σ actuals over all 175 pairs = 4839. WAPE = 392 / 4839 = 0.0810.
    const m1 = oracleWape(y, (t, h) => t[t.length + h - 1 - 7 * Math.ceil(h / 7)]);
    const m2 = oracleWape(y, (t, h) => {
      const v: number[] = [];
      for (let k = 1; k <= 8 && v.length < 4; k++) {
        const i = t.length + h - 1 - 7 * k;
        if (i >= 0 && i < t.length) v.push(t[i]);
      }
      return v.reduce((a, b) => a + b, 0) / v.length;
    });
    expect(bt.wape.M1).toBeCloseTo(m1, 4);
    expect(bt.wape.M2).toBeCloseTo(m2, 4);
    expect(bt.wape.M1).toBeCloseTo(392 / 4839, 4);
    expect(bt.wape.M1).toBeCloseTo(0.081, 4);
    expect(bt.wape[bt.selected]).toBe(Math.min(...(['M1', 'M2', 'M3'] as const).map((m) => bt.wape[m]!), ...(bt.m4Eligible ? [bt.wape.M4!] : [])));
  });
});
