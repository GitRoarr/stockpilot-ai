// Forecast models M1–M4 (Solution Design §D2.1). Series are contiguous daily values (index 0 = oldest).

export type ModelId = 'M1' | 'M2' | 'M3' | 'M4';
export const MODEL_LABEL: Record<ModelId, string> = {
  M1: 'Seasonal naive',
  M2: 'Weekday mean (4 weeks)',
  M3: 'Holt-Winters (weekly)',
  M4: 'Holt-Winters + weather/holiday',
};

/** Context features per day: rain day, temperature anomaly (per 10 °F), holiday, holiday eve. */
export type Features = { rain: number; temp: number; holiday: number; eve: number; known: boolean };
export const FEATURE_KEYS = ['rain', 'temp', 'holiday', 'eve'] as const;
export const EFFECT_CAP = 0.3;

const P = 7;

/** M1: same weekday last week (k weeks back for longer horizons). */
export function seasonalNaive(y: number[], h: number): number {
  const k = Math.ceil(h / P);
  return y[y.length + h - 1 - P * k] ?? 0;
}

/** M2: mean of the same weekday over the last 4 weeks; falls back to 28-day mean. */
export function weekdayMean(y: number[], h: number): number {
  const target = y.length + h - 1;
  const vals: number[] = [];
  for (let k = 1; k <= 8 && vals.length < 4; k++) {
    const i = target - P * k;
    if (i >= 0 && i < y.length) vals.push(y[i]);
  }
  if (vals.length >= 2) return mean(vals);
  return mean(y.slice(-28));
}

export type HwState = { alpha: number; gamma: number; level: number; season: number[]; fitted: number[]; sse: number };

/** ETS(A,N,A) with weekly seasonality; fitted[t] is the one-step-ahead forecast for y[t] (NaN for warm-up). */
export function holtWintersRun(y: number[], alpha: number, gamma: number): HwState {
  const n = y.length;
  const first = y.slice(0, P);
  let level = mean(first);
  const season = first.map((v) => v - level);
  const fitted: number[] = new Array(n).fill(NaN);
  let sse = 0;
  for (let t = P; t < n; t++) {
    const s = season[t % P];
    const f = level + s;
    fitted[t] = f;
    const e = y[t] - f;
    sse += e * e;
    const newLevel = alpha * (y[t] - s) + (1 - alpha) * level;
    season[t % P] = gamma * (y[t] - newLevel) + (1 - gamma) * s;
    level = newLevel;
  }
  return { alpha, gamma, level, season, fitted, sse };
}

const GRID = [0.05, 0.1, 0.2, 0.3, 0.4, 0.5];

export function holtWintersFit(y: number[]): HwState {
  let best: HwState | undefined;
  for (const a of GRID)
    for (const g of GRID) {
      const s = holtWintersRun(y, a, g);
      if (!best || s.sse < best.sse) best = s;
    }
  return best!;
}

export function holtWintersForecast(state: HwState, n: number, h: number): number {
  return state.level + state.season[(n + h - 1) % P];
}

/** Ridge regression (λ) without intercept. Returns coefficients for the feature columns. */
export function ridge(X: number[][], r: number[], lambda = 1): number[] {
  const k = X[0]?.length ?? 0;
  const A = Array.from({ length: k }, (_, i) => Array.from({ length: k }, (_, j) => (i === j ? lambda : 0)));
  const b = new Array(k).fill(0);
  for (let t = 0; t < X.length; t++) {
    for (let i = 0; i < k; i++) {
      b[i] += X[t][i] * r[t];
      for (let j = 0; j < k; j++) A[i][j] += X[t][i] * X[t][j];
    }
  }
  return solve(A, b);
}

function solve(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    if (Math.abs(M[c][c]) < 1e-12) continue;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let j = c; j <= n; j++) M[r][j] -= f * M[c][j];
    }
  }
  return M.map((row, i) => (Math.abs(row[i]) < 1e-12 ? 0 : row[n] / row[i]));
}

export type M4Fit = { hw: HwState; beta: Record<(typeof FEATURE_KEYS)[number], number>; usable: boolean };

/**
 * M4: Holt-Winters plus a multiplicative context effect fitted on relative one-step residuals:
 *   r_t = (y_t − ŷ_t) / ŷ_t ≈ β·x_t,   forecast = ŷ · (1 + clamp(β·x, ±30%)).
 */
export function m4Fit(y: number[], feats: Features[], hw = holtWintersFit(y)): M4Fit {
  const X: number[][] = [];
  const r: number[] = [];
  let unknown = 0;
  for (let t = P; t < y.length; t++) {
    const f = feats[t];
    if (!f || !f.known) {
      unknown++;
      continue;
    }
    const yhat = hw.fitted[t];
    if (!(yhat > 0.5)) continue;
    X.push(FEATURE_KEYS.map((k) => f[k]));
    r.push((y[t] - yhat) / yhat);
  }
  const usable = X.length >= 28 && unknown <= 0.1 * (y.length - P);
  const coef = usable ? ridge(X, r, 1) : [0, 0, 0, 0];
  const beta = Object.fromEntries(FEATURE_KEYS.map((k, i) => [k, coef[i]])) as M4Fit['beta'];
  return { hw, beta, usable };
}

export function contextEffect(beta: M4Fit['beta'], f: Features | undefined): number {
  if (!f || !f.known) return 0;
  const e = FEATURE_KEYS.reduce((s, k) => s + beta[k] * f[k], 0);
  return Math.max(-EFFECT_CAP, Math.min(EFFECT_CAP, e));
}

export function mean(a: number[]): number {
  return a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0;
}

export function std(a: number[]): number {
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / (a.length - 1));
}

export function quantile(a: number[], q: number): number {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}
