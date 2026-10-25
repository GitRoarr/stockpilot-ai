import { config } from '../../config.js';
import { db } from '../../db/sqlite.js';
import { id, nowIso } from '../../lib/util.js';
import { GenerateContentClient } from './generateContent.js';
import { InteractionsClient } from './interactions.js';
import { LlmUnavailable, statusOf, type ChatRequest, type ChatResponse, type LlmClient, type StructuredRequest, type StructuredResponse } from './types.js';

// Model resolution, rate limiting and daily budget (SRS FR-062, Solution Design §D5.3 – §D5.4).
let override: LlmClient | null | undefined;
let cached: { key: string; client: LlmClient } | undefined;

/** Tests and evals inject a recorded client; `null` forces "no key" behaviour. */
export function setLlmClient(c: LlmClient | null | undefined): void {
  override = c;
}

export function llmClient(): LlmClient | null {
  if (override !== undefined) return override;
  if (!config.GEMINI_API_KEY) return null;
  const key = `${config.GEMINI_API_STYLE}:${config.GEMINI_API_KEY}`;
  if (!cached || cached.key !== key) {
    cached = { key, client: config.GEMINI_API_STYLE === 'generate_content' ? new GenerateContentClient(config.GEMINI_API_KEY) : new InteractionsClient(config.GEMINI_API_KEY) };
  }
  return cached.client;
}

export function aiAvailable(): { ok: boolean; reason?: 'no_api_key' | 'budget_exhausted' | 'model_cooldown' } {
  if (!llmClient()) return { ok: false, reason: 'no_api_key' };
  if (callsToday() >= config.GEMINI_DAILY_BUDGET) return { ok: false, reason: 'budget_exhausted' };
  if (breakerOpen()) return { ok: false, reason: 'model_cooldown' };
  return { ok: true };
}

// Circuit breaker: after repeated failed model requests (timeouts, rate limits, errors) skip the model for a cool-down,
// so new work starts on the rule-based pipeline at once instead of each run waiting out its own timeouts.
// Tests and evals switch it off (setBreakerEnabled) so scripted failures in one scenario cannot affect the next.
const BREAKER_FAILURES = 3;
const BREAKER_COOLDOWN_MS = 5 * 60_000;
let breakerEnabled = true;
let failStreak = 0;
let openUntil = 0;
const breakerOpen = () => breakerEnabled && Date.now() < openUntil;
export function resetBreaker(): void {
  failStreak = 0;
  openUntil = 0;
}
export function setBreakerEnabled(on: boolean): void {
  breakerEnabled = on;
  resetBreaker();
}
export function breakerState(): { failStreak: number; openUntil: number } {
  return { failStreak, openUntil };
}

export function callsToday(): number {
  return db().get<{ n: number }>(`SELECT COUNT(*) AS n FROM model_calls WHERE substr(at, 1, 10) = ? AND outcome <> 'skipped'`, nowIso().slice(0, 10))?.n ?? 0;
}

// Token bucket per minute; callers wait (inside jobs) instead of failing.
const recent: number[] = [];
async function acquireSlot(): Promise<void> {
  for (let i = 0; i < 70; i++) {
    const t = Date.now();
    while (recent.length && t - recent[0] > 60_000) recent.shift();
    if (recent.length < config.GEMINI_MAX_RPM) {
      recent.push(t);
      return;
    }
    if (override) break; // recorded clients are not rate limited
    await new Promise((r) => setTimeout(r, 1000));
  }
  if (!override) throw new LlmUnavailable('rate_limited', 'Client-side rate limit (GEMINI_MAX_RPM) — waited 70 s');
}

function record(model: string | null, purpose: string, outcome: string, latencyMs: number, usage?: { tokensIn?: number; tokensOut?: number }): void {
  db().run(
    `INSERT INTO model_calls (id, at, model, purpose, outcome, latency_ms, tokens_in, tokens_out) VALUES (?,?,?,?,?,?,?,?)`,
    id('mc'),
    nowIso(),
    model,
    purpose,
    outcome,
    latencyMs,
    usage?.tokensIn ?? null,
    usage?.tokensOut ?? null,
  );
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function withModels<T extends { usage?: { tokensIn?: number; tokensOut?: number } }>(purpose: string, call: (client: LlmClient, model: string) => Promise<T>): Promise<{ result: T; model: string }> {
  const client = llmClient();
  if (!client) throw new LlmUnavailable('no_api_key', 'GEMINI_API_KEY is not set');
  if (callsToday() >= config.GEMINI_DAILY_BUDGET) {
    record(null, purpose, 'skipped', 0);
    throw new LlmUnavailable('budget_exhausted', `Daily AI budget of ${config.GEMINI_DAILY_BUDGET} calls reached`);
  }
  if (breakerOpen()) {
    record(null, purpose, 'skipped', 0);
    throw new LlmUnavailable('model_cooldown', `Model paused after ${BREAKER_FAILURES} failed requests; retrying after a short cool-down`);
  }
  const models = [config.GEMINI_MODEL, config.GEMINI_FALLBACK_MODEL];
  let lastErr: unknown;
  for (let m = 0; m < models.length; m++) {
    const model = models[m];
    // Primary: retries for 429/408/5xx with backoff; fallback model: one attempt (FR-062).
    const attempts = m === 0 ? 3 : 1;
    for (let a = 0; a < attempts; a++) {
      await acquireSlot();
      const t0 = Date.now();
      try {
        const result = await call(client, model);
        record(model, purpose, 'ok', Date.now() - t0, result.usage);
        failStreak = 0;
        return { result, model };
      } catch (e) {
        lastErr = e;
        const st = statusOf(e);
        record(model, purpose, `error_${st ?? 'unknown'}`, Date.now() - t0);
        const retryable = st === 429 || st === 408 || (st !== undefined && st >= 500);
        if (!retryable) break;
        if (a < attempts - 1 && !override) await sleep(500 * 2 ** a + Math.random() * 300);
      }
    }
    if (![404, 403, 429].includes(statusOf(lastErr) ?? 0)) break;
  }
  const st = statusOf(lastErr);
  const reason = st === 429 ? 'rate_limited' : st === 408 ? 'timeout' : st === 404 || st === 403 ? 'model_unavailable' : 'model_error';
  if (breakerEnabled && ++failStreak >= BREAKER_FAILURES) openUntil = Date.now() + BREAKER_COOLDOWN_MS;
  throw new LlmUnavailable(reason, (lastErr as Error)?.message ?? 'model call failed');
}

export async function llmChat(purpose: string, req: Omit<ChatRequest, 'model' | 'timeoutMs'>): Promise<{ response: ChatResponse; model: string }> {
  const { result, model } = await withModels(purpose, (c, model) => c.chat({ ...req, model, timeoutMs: 30_000 }));
  return { response: result, model };
}

export async function llmStructured(purpose: string, req: Omit<StructuredRequest, 'model' | 'timeoutMs'>, vision = false): Promise<{ response: StructuredResponse; model: string }> {
  const { result, model } = await withModels(purpose, (c, model) => c.structured({ ...req, model, timeoutMs: vision ? 45_000 : 30_000 }));
  return { response: result, model };
}

export function modelCallStats() {
  const rows = db().all<{ outcome: string; n: number }>(`SELECT outcome, COUNT(*) AS n FROM model_calls WHERE substr(at,1,10) = ? GROUP BY outcome`, nowIso().slice(0, 10));
  return { today: Object.fromEntries(rows.map((r) => [r.outcome, r.n])), budget: config.GEMINI_DAILY_BUDGET, used: callsToday(), maxRpm: config.GEMINI_MAX_RPM };
}
