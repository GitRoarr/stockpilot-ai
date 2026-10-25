import type { FastifyInstance } from 'fastify';
import { setConfig } from '../src/config.js';
import { openDb, setDb } from '../src/db/sqlite.js';
import { setBreakerEnabled, setLlmClient } from '../src/agents/llm/gateway.js';
import type { LlmClient } from '../src/agents/llm/types.js';
import { setFetch } from '../src/integrations/http.js';
import { resetClockCache } from '../src/lib/util.js';
import { buildServer } from '../src/server.js';
import { seedDemo } from '../src/db/seed/demo.js';

export type Session = { cookie: string; role: string };

/** Fresh in-memory database, offline (external fetches fail), optional recorded model. */
export async function setup(opts: { llm?: LlmClient | null; seed?: boolean } = {}): Promise<FastifyInstance> {
  setConfig({ NODE_ENV: 'test', DATABASE_PATH: ':memory:', GEMINI_API_KEY: undefined, BREVO_API_KEY: undefined, BREVO_SENDER_EMAIL: undefined, BREVO_SENDER_NAME: undefined, SUPPLIER_EMAIL_OVERRIDE: undefined, EMAIL_FROM: undefined, SESSION_SECRET: 'x'.repeat(40), DEMO_MODE: true });
  setDb(openDb(':memory:'));
  resetClockCache();
  setLlmClient(opts.llm === undefined ? null : opts.llm);
  setBreakerEnabled(false);
  setFetch((async () => {
    throw new Error('network disabled in tests');
  }) as unknown as typeof fetch);
  const app = await buildServer();
  if (opts.seed !== false) await seedDemo({ offline: true });
  return app;
}

export async function login(app: FastifyInstance, email: string): Promise<Session> {
  const r = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password: 'harborvine2026' }, headers: { 'x-stockpilot': '1' } });
  if (r.statusCode !== 200) throw new Error(`login failed ${r.statusCode} ${r.body}`);
  const raw = r.headers['set-cookie'];
  const c = (Array.isArray(raw) ? raw[0] : String(raw)).split(';')[0];
  return { cookie: c, role: r.json().user.role };
}

export function api(app: FastifyInstance, s: Session | null) {
  const call = async (method: 'GET' | 'POST' | 'PATCH' | 'PUT', url: string, payload?: unknown) => {
    const r = await app.inject({ method, url: `/api${url}`, payload: payload as never, headers: { ...(s ? { cookie: s.cookie } : {}), 'x-stockpilot': '1' } });
    return { status: r.statusCode, body: r.body ? safeJson(r.body) : undefined, raw: r };
  };
  return {
    get: (u: string) => call('GET', u),
    post: (u: string, p: unknown = {}) => call('POST', u, p),
    patch: (u: string, p: unknown) => call('PATCH', u, p),
    put: (u: string, p: unknown) => call('PUT', u, p),
  };
}

function safeJson(s: string): any {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

export const OWNER = 'sara@harborvine.com';
export const CHEF = 'daniel@harborvine.com';
export const STAFF = 'leo@harborvine.com';
