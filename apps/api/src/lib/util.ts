import { randomBytes, createHash } from 'node:crypto';
import { config } from '../config.js';
import { db } from '../db/sqlite.js';

export function id(prefix: string): string {
  return `${prefix}_${randomBytes(8).toString('hex')}`;
}

export function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
export const round1 = (n: number) => Math.round((n + Number.EPSILON) * 10) / 10;
export const usd = (n: number) => `$${round2(n).toFixed(2)}`;

// ── Clock ─────────────────────────────────────────────────────────────
// The demo can move time forward ("time travel") to show deadlines and the 06:00 run.
let offsetMs: number | undefined;

export function clockOffsetMs(): number {
  if (offsetMs === undefined) {
    try {
      const row = db().get<{ value: string }>(`SELECT value FROM settings WHERE key = 'demo_clock_offset_ms'`);
      offsetMs = row ? Number(row.value) : 0;
    } catch {
      offsetMs = 0;
    }
  }
  return offsetMs;
}

export function setClockOffsetMs(ms: number): void {
  offsetMs = ms;
  db().run(`INSERT INTO settings(key, value) VALUES ('demo_clock_offset_ms', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, String(ms));
}

export function resetClockCache(): void {
  offsetMs = undefined;
}

export function now(): Date {
  return new Date(Date.now() + clockOffsetMs());
}

export function nowIso(): string {
  return now().toISOString();
}

/** YYYY-MM-DD of an instant in the restaurant's timezone. */
export function localDate(d: Date = now(), tz = config.TZ): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

/** HH:MM in the restaurant timezone. */
export function localTime(d: Date = now(), tz = config.TZ): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
}

export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function weekday(date: string): number {
  return new Date(`${date}T12:00:00Z`).getUTCDay();
}

export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86400000);
}

export function json<T = any>(s: string | null | undefined, fallback: T): T {
  if (s === null || s === undefined || s === '') return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}

export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (m: string, d?: unknown) => new AppError(400, 'VALIDATION_ERROR', m, d);
export const forbidden = (m: string, code = 'FORBIDDEN') => new AppError(403, code, m);
export const notFound = (m = 'Not found') => new AppError(404, 'NOT_FOUND', m);
export const conflict = (m: string) => new AppError(409, 'CONFLICT', m);
export const gone = (m: string) => new AppError(410, 'GONE', m);
export const unprocessable = (m: string, d?: unknown) => new AppError(422, 'UNPROCESSABLE', m, d);
