import { db } from '../db/sqlite.js';
import type { Features } from '../engines/forecast/models.js';
import { fetchArchive, fetchForecast, type WeatherDay } from '../integrations/openMeteo.js';
import { fetchHolidays } from '../integrations/nagerDate.js';
import { getSettings } from '../lib/settings.js';
import { addDays, localDate, now, nowIso } from '../lib/util.js';

// Weather and holiday context (SRS FR-022 – FR-024, FR-029; Solution Design §D2.1, §D5.1).
export type SourceStatus = 'ok' | 'stale' | 'unavailable' | 'disabled' | 'not_checked';
export type ContextStatus = { source: string; status: SourceStatus; message: string | null; lastSuccessAt: string | null; updatedAt: string };

const FORECAST_TTL_MS = 3 * 3600_000;
const STALE_MS = 24 * 3600_000;
export const RAIN_THRESHOLD_IN = 0.2;

function setStatus(source: string, status: SourceStatus, message: string | null, success = false): void {
  db().run(
    `INSERT INTO context_status (source, status, message, last_success_at, updated_at) VALUES (?,?,?,?,?)
     ON CONFLICT(source) DO UPDATE SET status = excluded.status, message = excluded.message,
       last_success_at = COALESCE(excluded.last_success_at, context_status.last_success_at), updated_at = excluded.updated_at`,
    source,
    status,
    message,
    success ? nowIso() : null,
    nowIso(),
  );
}

export function contextStatus(): Record<string, ContextStatus> {
  const rows = db().all<{ source: string; status: SourceStatus; message: string | null; last_success_at: string | null; updated_at: string }>(`SELECT * FROM context_status`);
  const out: Record<string, ContextStatus> = {};
  for (const r of rows) out[r.source] = { source: r.source, status: r.status, message: r.message, lastSuccessAt: r.last_success_at, updatedAt: r.updated_at };
  return out;
}

function upsertWeather(days: WeatherDay[], source: string, overwriteArchive = false): void {
  const at = nowIso();
  db().tx(() => {
    for (const d of days) {
      if (d.tmaxF === null && d.precipIn === null) continue;
      db().run(
        `INSERT INTO weather_days (date, tmax_f, precip_in, weather_code, source, fetched_at) VALUES (?,?,?,?,?,?)
         ON CONFLICT(date) DO UPDATE SET tmax_f = excluded.tmax_f, precip_in = excluded.precip_in,
           weather_code = COALESCE(excluded.weather_code, weather_days.weather_code), source = excluded.source, fetched_at = excluded.fetched_at
         WHERE ${overwriteArchive ? '1' : "weather_days.source <> 'archive'"}`,
        d.date,
        d.tmaxF,
        d.precipIn,
        d.weatherCode,
        source,
        at,
      );
    }
  });
}

/** Refreshes the 7-day forecast (cache ≤ 3 h; stale ≤ 24 h), history gaps (archive) and holidays (per year). */
export async function refreshContext(opts: { force?: boolean; historyStart?: string } = {}): Promise<Record<string, ContextStatus>> {
  const s = getSettings();
  const loc = { latitude: s.latitude, longitude: s.longitude, timezone: s.timezone };
  const today = localDate();
  const st = contextStatus();

  if (!s.weatherEnabled) {
    setStatus('weather_forecast', 'disabled', 'Weather disabled in settings');
  } else {
    const last = st.weather_forecast?.lastSuccessAt;
    const fresh = last && now().getTime() - Date.parse(last) < FORECAST_TTL_MS;
    if (!fresh || opts.force) {
      try {
        upsertWeather(await fetchForecast(loc, 7), 'forecast');
        setStatus('weather_forecast', 'ok', null, true);
      } catch (e) {
        const stale = last && now().getTime() - Date.parse(last) < STALE_MS;
        setStatus(
          'weather_forecast',
          stale ? 'stale' : 'unavailable',
          stale ? `Using cached forecast from ${last} (${(e as Error).message})` : `Weather unavailable — model without weather used (${(e as Error).message})`,
        );
      }
    }
    // History for the M4 fit: fill gaps from the archive (ERA5 lags ~5 days; recent days come from past_days).
    const start = opts.historyStart ?? addDays(today, -180);
    const end = addDays(today, -6);
    const have = new Set(db().all<{ date: string }>(`SELECT date FROM weather_days WHERE date BETWEEN ? AND ?`, start, end).map((r) => r.date));
    const missing: string[] = [];
    for (let d = start; d <= end; d = addDays(d, 1)) if (!have.has(d)) missing.push(d);
    if (missing.length) {
      try {
        upsertWeather(await fetchArchive(loc, missing[0], missing[missing.length - 1]), 'archive', true);
        setStatus('weather_history', 'ok', `${missing.length} days fetched`, true);
      } catch (e) {
        setStatus('weather_history', 'unavailable', `Historical weather unavailable — M4 not eligible for affected items (${(e as Error).message})`);
      }
    } else if (!st.weather_history) setStatus('weather_history', 'ok', 'complete', true);
  }

  if (!s.holidaysEnabled) {
    setStatus('holidays', 'disabled', 'Holidays disabled in settings');
  } else {
    const years = new Set([Number((opts.historyStart ?? addDays(today, -180)).slice(0, 4)), Number(today.slice(0, 4)), Number(addDays(today, 8).slice(0, 4))]);
    const errors: string[] = [];
    for (const y of years) {
      const key = `holidays:${s.country}:${s.subdivision}:${y}`;
      if (!opts.force && db().get(`SELECT 1 FROM settings WHERE key = ?`, key)) continue;
      try {
        const hs = await fetchHolidays(s.country, y, s.subdivision);
        db().tx(() => {
          db().run(`DELETE FROM holidays WHERE date LIKE ?`, `${y}-%`);
          for (const h of hs) db().run(`INSERT OR IGNORE INTO holidays (date, name, scope) VALUES (?,?,?)`, h.date, h.name, h.scope);
          db().run(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`, key, nowIso());
        });
      } catch (e) {
        errors.push(`${y}: ${(e as Error).message}`);
      }
    }
    if (errors.length) setStatus('holidays', db().get(`SELECT 1 FROM holidays LIMIT 1`) ? 'stale' : 'unavailable', `Holidays unavailable — no holiday feature (${errors.join('; ')})`);
    else setStatus('holidays', 'ok', null, true);
  }
  return contextStatus();
}

export type ContextDay = { date: string; tmaxF: number | null; precipIn: number | null; weatherCode: number | null; source: string | null; holiday: string | null; holidayEve: boolean };

/** Features for M4 per date (rain day, temp anomaly per 10 °F vs trailing 28-day mean, holiday, holiday eve). */
export function buildFeatures(dates: string[]): { features: Features[]; days: ContextDay[] } {
  if (!dates.length) return { features: [], days: [] };
  const first = addDays(dates[0], -28);
  const last = dates[dates.length - 1];
  const today = localDate();
  const st = contextStatus();
  const futureUsable = ['ok', 'stale'].includes(st.weather_forecast?.status ?? 'not_checked');
  const w = new Map(
    db()
      .all<{ date: string; tmax_f: number | null; precip_in: number | null; weather_code: number | null; source: string }>(`SELECT * FROM weather_days WHERE date BETWEEN ? AND ?`, first, last)
      .map((r) => [r.date, r]),
  );
  const hol = new Map(db().all<{ date: string; name: string }>(`SELECT date, name FROM holidays WHERE date BETWEEN ? AND ?`, first, addDays(last, 1)).map((r) => [r.date, r.name]));
  const holidaysKnown = ['ok', 'stale'].includes(st.holidays?.status ?? 'not_checked') || hol.size > 0;

  const features: Features[] = [];
  const days: ContextDay[] = [];
  for (const date of dates) {
    let row = w.get(date);
    if (row && date >= today && !futureUsable && row.source === 'forecast') row = undefined;
    const trailing: number[] = [];
    for (let k = 1; k <= 28; k++) {
      const t = w.get(addDays(date, -k))?.tmax_f;
      if (t !== null && t !== undefined) trailing.push(t);
    }
    const base = trailing.length ? trailing.reduce((a, b) => a + b, 0) / trailing.length : null;
    const known = Boolean(row && row.tmax_f !== null && row.precip_in !== null && base !== null);
    const holiday = hol.get(date) ?? null;
    const eve = !holiday && hol.has(addDays(date, 1));
    features.push({
      rain: known && (row!.precip_in ?? 0) >= RAIN_THRESHOLD_IN ? 1 : 0,
      temp: known ? ((row!.tmax_f as number) - (base as number)) / 10 : 0,
      holiday: holidaysKnown && holiday ? 1 : 0,
      eve: holidaysKnown && eve ? 1 : 0,
      known,
    });
    days.push({ date, tmaxF: row?.tmax_f ?? null, precipIn: row?.precip_in ?? null, weatherCode: row?.weather_code ?? null, source: row?.source ?? null, holiday, holidayEve: eve });
  }
  return { features, days };
}
