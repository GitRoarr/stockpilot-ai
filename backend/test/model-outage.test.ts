import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { db } from '../src/db/sqlite.js';
import { drainJobs } from '../src/jobs/worker.js';
import { aiAvailable, llmChat, nextQuotaReset, pausedModels, resetBreaker, setBreakerEnabled, setLlmClient } from '../src/agents/llm/gateway.js';
import { config, setConfig } from '../src/config.js';
import type { LlmClient } from '../src/agents/llm/types.js';
import { startMorningRun } from '../src/agents/triggers.js';
import { api, CHEF, login, setup, type Session } from './helpers.js';

// A Gemini outage mid-workflow (FR-061, FR-062): every model call times out after a long wait. The workflow must still
// finish on the rule-based pipeline inside the same run, and repeated failures pause the model (circuit breaker).
let realNow = Date.now.bind(Date);
let offset = 0;
let calls = 0;
// Same shape as a real Gemini client timeout: an error carrying HTTP status 408.
const timeout = () => Object.assign(new Error('simulated 30 s timeout'), { status: 408 });
const slowTimeout: LlmClient = {
  style: 'recorded',
  chat: async () => {
    calls++;
    offset += 120_000; // longer than any agent's time budget
    throw timeout();
  },
  structured: async () => {
    calls++;
    offset += 120_000;
    throw timeout();
  },
};

let app: FastifyInstance;
let chef: Session;
beforeAll(async () => {
  app = await setup({ llm: slowTimeout });
  chef = await login(app, CHEF);
  realNow = Date.now.bind(Date);
  vi.spyOn(Date, 'now').mockImplementation(() => realNow() + offset);
});
afterAll(async () => {
  vi.restoreAllMocks();
  await app.close();
});
afterEach(() => setBreakerEnabled(false));

describe('model outage during a workflow', () => {
  it('the morning plan finishes in the same run on the rule-based pipeline, with orders drafted', async () => {
    const runId = startMorningRun({ trigger: 'manual', user: { id: 'usr_daniel', role: 'chef' } });
    await drainJobs();
    const run = db().get<{ status: string; mode: string; fallback_reason: string }>(`SELECT status, mode, fallback_reason FROM agent_runs WHERE id = ?`, runId)!;
    expect(run).toEqual({ status: 'completed', mode: 'deterministic', fallback_reason: 'timeout' });
    expect(db().get<{ n: number }>(`SELECT COUNT(*) AS n FROM agent_runs WHERE trigger = 'fallback'`)!.n).toBe(0);
    expect(db().get<{ n: number }>(`SELECT COUNT(*) AS n FROM purchase_orders WHERE status = 'pending_approval'`)!.n).toBeGreaterThan(0);
    // The standup is labelled with the real reason, not "no_api_key".
    const brief = (await api(app, chef).get('/dashboard')).body.briefing;
    expect(brief).toMatchObject({ mode: 'rule_based', reason: 'timeout' });
  });

  it('an event-triggered run (an @mention) also completes instead of stopping with "budget exhausted"', async () => {
    expect((await api(app, chef).post('/team/messages', { body: '@Buyer find a cheaper supplier for chicken thigh' })).status).toBe(200);
    await drainJobs();
    const run = db().get<{ status: string; mode: string; steps_used: number }>(`SELECT status, mode, steps_used FROM agent_runs WHERE agent_id = 'buyer' AND trigger = 'mention' ORDER BY started_at DESC LIMIT 1`)!;
    expect(run.status).toBe('completed');
    expect(run.mode).toBe('deterministic');
    expect(run.steps_used).toBeGreaterThan(0);
  });
});

describe('circuit breaker', () => {
  it('opens after 3 failed requests, skips the model during the cool-down, and resets on success', async () => {
    setBreakerEnabled(true);
    calls = 0;
    for (let i = 0; i < 3; i++) await expect(llmChat('test', { system: 's', history: [], tools: [] })).rejects.toMatchObject({ reason: 'timeout' });
    const before = calls;
    await expect(llmChat('test', { system: 's', history: [], tools: [] })).rejects.toMatchObject({ reason: 'model_cooldown' });
    expect(calls).toBe(before); // the model was not called while paused
    expect(aiAvailable()).toEqual({ ok: false, reason: 'model_cooldown' });

    offset += 6 * 60_000; // after the cool-down the model is tried again
    expect(aiAvailable().ok).toBe(true);
    resetBreaker();
    setLlmClient({ style: 'recorded', chat: async () => ({ text: 'ok', calls: [] }), structured: async () => ({ data: {} }) } as unknown as LlmClient);
    await expect(llmChat('test', { system: 's', history: [], tools: [] })).resolves.toMatchObject({ response: { text: 'ok' } });
  });
});

describe('model fallback', () => {
  const req = { system: 's', history: [], tools: [] };
  const scripted = (fail: (model: string) => Error | null, log: string[]) =>
    ({
      style: 'recorded',
      chat: async (r: { model: string }) => {
        log.push(r.model);
        const e = fail(r.model);
        if (e) throw e;
        return { text: `ok from ${r.model}`, calls: [] };
      },
      structured: async () => ({ data: {} }),
    }) as unknown as LlmClient;
  const saved = { primary: config.GEMINI_MODEL, fallback: config.GEMINI_FALLBACK_MODEL };
  afterEach(() => setConfig({ GEMINI_MODEL: saved.primary, GEMINI_FALLBACK_MODEL: saved.fallback }));

  it('a used-up daily quota pauses that model until the quota resets, so later calls go straight to the fallback', async () => {
    setConfig({ GEMINI_MODEL: 'model-a', GEMINI_FALLBACK_MODEL: 'model-b' });
    const log: string[] = [];
    const daily = () => Object.assign(new Error('Rate limit exceeded for model model-a (limit: 500 requests per day on Free Tier)'), { status: 429 });
    setLlmClient(scripted((m) => (m === 'model-a' ? daily() : null), log));
    await expect(llmChat('test', req)).resolves.toMatchObject({ model: 'model-b' });
    expect(log).toEqual(['model-a', 'model-b']); // no retries on a daily quota
    expect(Object.keys(pausedModels())).toEqual(['model-a']);
    await expect(llmChat('test', req)).resolves.toMatchObject({ model: 'model-b' });
    expect(log).toEqual(['model-a', 'model-b', 'model-b']); // model-a skipped while paused
  });

  it('when both models are out of daily quota, the call fails at once as rate limited', async () => {
    setConfig({ GEMINI_MODEL: 'model-a', GEMINI_FALLBACK_MODEL: 'model-b' });
    const log: string[] = [];
    setLlmClient(scripted((m) => Object.assign(new Error(`limit: 500 requests per day for ${m}`), { status: 429 }), log));
    await expect(llmChat('test', req)).rejects.toMatchObject({ reason: 'rate_limited' });
    await expect(llmChat('test', req)).rejects.toMatchObject({ reason: 'rate_limited' });
    expect(log).toEqual(['model-a', 'model-b']); // the second call did not wait for two more refusals
  });

  it('a timeout on the first model moves to the fallback model without retrying', async () => {
    setConfig({ GEMINI_MODEL: 'model-a', GEMINI_FALLBACK_MODEL: 'model-b' });
    const log: string[] = [];
    setLlmClient(scripted((m) => (m === 'model-a' ? timeout() : null), log));
    await expect(llmChat('test', req)).resolves.toMatchObject({ model: 'model-b' });
    expect(log).toEqual(['model-a', 'model-b']);
  });

  it('the daily quota resets at the next midnight in Los Angeles', () => {
    const at = Date.UTC(2026, 9, 25, 20, 0, 0); // 13:00 PDT
    expect(new Date(nextQuotaReset(at)).toISOString()).toBe('2026-10-26T07:00:00.000Z');
  });
});
