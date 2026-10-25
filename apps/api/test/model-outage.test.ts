import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { db } from '../src/db/sqlite.js';
import { drainJobs } from '../src/jobs/worker.js';
import { aiAvailable, llmChat, resetBreaker, setBreakerEnabled, setLlmClient } from '../src/agents/llm/gateway.js';
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
