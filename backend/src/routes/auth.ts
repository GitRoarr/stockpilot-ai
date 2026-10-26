import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../db/sqlite.js';
import { config } from '../config.js';
import { hashPassword, verifyPassword } from '../auth/password.js';
import { checkLoginRate, clearLoginAttempts, createSession, destroySession, readSessionToken, recordFailedLogin, requireUser, setSessionCookie, SESSION_COOKIE, userForToken } from '../auth/sessions.js';
import { audit } from '../lib/events.js';
import { AppError, id, nowIso } from '../lib/util.js';
import { getSettings } from '../lib/settings.js';

const PUBLIC = [/^\/api\/health$/, /^\/api\/auth\/(login|register)$/, /^\/api\/portal\//];

/** Session + RBAC + CSRF hook (FR-002, NFR-SEC-3). Every /api route except auth, health and portal needs a session. */
export async function authHook(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', async (req) => {
    const url = req.url.split('?')[0];
    if (!url.startsWith('/api/')) return;
    if (PUBLIC.some((p) => p.test(url))) return;
    req.user = userForToken(readSessionToken(req));
    if (!req.user) throw new AppError(401, 'UNAUTHENTICATED', 'Please sign in.');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers['x-stockpilot'] !== '1') throw new AppError(403, 'CSRF', 'Missing x-stockpilot header');
  });
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post('/auth/login', async (req, reply) => {
    const body = z.object({ email: z.string().email().max(120), password: z.string().min(1).max(200) }).parse(req.body);
    const key = `${req.ip}|${body.email.toLowerCase()}`;
    checkLoginRate(key);
    const u = db().get<{ id: string; name: string; email: string; role: string; password_hash: string }>(`SELECT * FROM users WHERE email = ?`, body.email);
    if (!u || !(await verifyPassword(body.password, u.password_hash))) {
      recordFailedLogin(key);
      throw new AppError(401, 'UNAUTHENTICATED', 'Email or password is incorrect.');
    }
    clearLoginAttempts(key);
    const s = createSession(u.id);
    setSessionCookie(reply, s.token, s.expiresAt);
    audit({ type: 'user', id: u.id }, 'auth.login', 'user', u.id);
    return { user: { id: u.id, name: u.name, email: u.email, role: u.role } };
  });

  // Self-service sign-up, demo mode only. New accounts get the Staff role (receiving, stock counts, invoices), so a
  // self-registered user can never approve orders or change the autonomy policy; roles are not chosen at sign-up.
  app.post('/auth/register', async (req, reply) => {
    if (!config.DEMO_MODE) throw new AppError(403, 'SIGNUP_DISABLED', 'New accounts are created by the restaurant Owner.');
    const body = z.object({ name: z.string().trim().min(2).max(80), email: z.string().trim().email().max(120), password: z.string().min(8).max(200) }).parse(req.body);
    const key = `${req.ip}|register`;
    checkLoginRate(key);
    recordFailedLogin(key);
    if (db().get(`SELECT 1 FROM users WHERE email = ?`, body.email)) throw new AppError(409, 'EMAIL_TAKEN', 'An account with this email already exists. Sign in instead.');
    const u = { id: id('usr'), name: body.name, email: body.email.toLowerCase(), role: 'staff' as const };
    db().run(`INSERT INTO users (id, name, email, role, password_hash, created_at) VALUES (?,?,?,?,?,?)`, u.id, u.name, u.email, u.role, await hashPassword(body.password), nowIso());
    const s = createSession(u.id);
    setSessionCookie(reply, s.token, s.expiresAt);
    audit({ type: 'user', id: u.id }, 'auth.register', 'user', u.id, { after: { role: u.role } });
    return { user: u };
  });

  app.post('/auth/logout', async (req, reply) => {
    destroySession(readSessionToken(req));
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get('/me', async (req) => {
    const u = requireUser(req);
    const s = getSettings();
    const optIn = db().get<{ briefing_opt_in: number }>(`SELECT briefing_opt_in FROM users WHERE id = ?`, u.id)?.briefing_opt_in;
    return { user: u, restaurant: s.restaurantName, onboardingComplete: s.onboardingComplete, illustrativeData: s.demoData, preferences: { briefingEmail: optIn === 1 } };
  });

  // Personal preferences. The morning standup email goes only to Chefs and Owners who opted in (FR-093).
  app.patch('/me/preferences', async (req) => {
    const u = requireUser(req);
    const body = z.object({ briefingEmail: z.boolean() }).strict().parse(req.body);
    db().run(`UPDATE users SET briefing_opt_in = ? WHERE id = ?`, body.briefingEmail ? 1 : 0, u.id);
    audit({ type: 'user', id: u.id }, 'user.preferences', 'user', u.id, { after: body });
    return { briefingEmail: body.briefingEmail };
  });
}
