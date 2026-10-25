import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { setConfig } from '../src/config.js';
import { openDb, setDb } from '../src/db/sqlite.js';
import { buildServer } from '../src/server.js';

let app: FastifyInstance;

beforeAll(async () => {
  setConfig({ NODE_ENV: 'test', DATABASE_PATH: ':memory:', GEMINI_API_KEY: undefined, BREVO_API_KEY: undefined });
  setDb(openDb(':memory:'));
  app = await buildServer();
});

afterAll(async () => {
  await app.close();
});

describe('GET /api/health', () => {
  it('reports ok and no-key integrations', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe('ok');
    expect(body.integrations.gemini).toBe('no_key');
    expect(body.integrations.email).toBe('no_key');
  });

  it('returns the error envelope for unknown routes', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/does-not-exist' });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('UNAUTHENTICATED');
  });
});

describe('schema', () => {
  it('creates every core table', () => {
    const db = openDb(':memory:');
    const names = db.all<{ name: string }>(`SELECT name FROM sqlite_master WHERE type='table'`).map((r) => r.name);
    for (const t of ['agents', 'agent_runs', 'agent_actions', 'tasks', 'questions', 'working_agreements', 'supplier_offers', 'purchase_orders', 'invoices', 'disputes', 'ledger_entries', 'jobs', 'email_messages', 'audit_events']) {
      expect(names).toContain(t);
    }
  });

  it('rejects a verified ledger entry of an estimate type', () => {
    const db = openDb(':memory:');
    expect(() =>
      db.run(`INSERT INTO ledger_entries (id,type,amount,verified,source_type,source_id,method,created_at) VALUES ('l1','waste_avoided_estimate',5,1,'x','y','m','t')`),
    ).toThrow();
  });
});
