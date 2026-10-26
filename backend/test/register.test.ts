import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { setConfig } from '../src/config.js';
import { db } from '../src/db/sqlite.js';
import { api, setup } from './helpers.js';

// Self-service sign-up (demo mode): new accounts are always Staff and are signed in straight away.
let app: FastifyInstance;
beforeAll(async () => {
  app = await setup();
});
afterAll(async () => {
  await app.close();
});

const register = (payload: unknown) => app.inject({ method: 'POST', url: '/api/auth/register', payload: payload as never, headers: { 'x-stockpilot': '1' } });
const cookieOf = (r: Awaited<ReturnType<typeof register>>) => String([r.headers['set-cookie']].flat()[0]).split(';')[0];

describe('POST /auth/register', () => {
  it('creates a Staff account, signs it in, and the password works for later sign-ins', async () => {
    const r = await register({ name: 'Maya Chen', email: 'Maya@Example.com', password: 'kitchen-2026' });
    expect(r.statusCode).toBe(200);
    expect(r.json().user).toMatchObject({ name: 'Maya Chen', email: 'maya@example.com', role: 'staff' });
    const me = await api(app, { cookie: cookieOf(r), role: 'staff' }).get('/me');
    expect(me.body.user).toMatchObject({ email: 'maya@example.com', role: 'staff' });

    const again = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'maya@example.com', password: 'kitchen-2026' }, headers: { 'x-stockpilot': '1' } });
    expect(again.statusCode).toBe(200);
    expect(db().get<{ n: number }>(`SELECT COUNT(*) AS n FROM audit_events WHERE action = 'auth.register'`)!.n).toBe(1);
  });

  it('never grants more than Staff: a role in the request is ignored and manager actions are refused', async () => {
    const r = await register({ name: 'Eve', email: 'eve@example.com', password: 'password-123', role: 'owner' });
    expect(r.json().user.role).toBe('staff');
    const run = await api(app, { cookie: cookieOf(r), role: 'staff' }).post('/agent-runs', { kind: 'morning' });
    expect(run.status).toBe(403);
  });

  it('rejects a taken email (case-insensitive), a short password and an invalid email', async () => {
    expect((await register({ name: 'Sara again', email: 'SARA@harborvine.com', password: 'whatever-123' })).statusCode).toBe(409);
    expect((await register({ name: 'Short', email: 'short@example.com', password: 'abc' })).statusCode).toBe(400);
    expect((await register({ name: 'Bad', email: 'not-an-email', password: 'long-enough-1' })).statusCode).toBe(400);
  });

  it('is disabled outside demo mode', async () => {
    setConfig({ DEMO_MODE: false });
    try {
      const r = await register({ name: 'Late', email: 'late@example.com', password: 'long-enough-1' });
      expect(r.statusCode).toBe(403);
      expect(r.json().error.code).toBe('SIGNUP_DISABLED');
    } finally {
      setConfig({ DEMO_MODE: true });
    }
  });
});

describe('PATCH /me/preferences', () => {
  it('turns the morning standup email off and on for the signed-in user (FR-093)', async () => {
    const r = await register({ name: 'Pat Chef', email: 'pat@example.com', password: 'long-enough-1' });
    const me = api(app, { cookie: cookieOf(r), role: 'staff' });
    expect((await me.get('/me')).body.preferences).toEqual({ briefingEmail: true });
    expect((await me.patch('/me/preferences', { briefingEmail: false })).status).toBe(200);
    expect((await me.get('/me')).body.preferences).toEqual({ briefingEmail: false });
    expect(db().get<{ briefing_opt_in: number }>(`SELECT briefing_opt_in FROM users WHERE email = 'pat@example.com'`)!.briefing_opt_in).toBe(0);
    expect((await me.patch('/me/preferences', { briefingEmail: 'yes' })).status).toBe(400);
  });
});
