import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../db/sqlite.js';
import { verifyPassword } from '../auth/password.js';
import { checkLoginRate, clearLoginAttempts, createSession, destroySession, readSessionToken, recordFailedLogin, requireUser, setSessionCookie, SESSION_COOKIE, userForToken } from '../auth/sessions.js';
import { audit } from '../lib/events.js';
import { AppError } from '../lib/util.js';
import { getSettings } from '../lib/settings.js';

const PUBLIC = [/^\/api\/health$/, /^\/api\/auth\/login$/, /^\/api\/portal\//];

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

  app.post('/auth/logout', async (req, reply) => {
    destroySession(readSessionToken(req));
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get('/me', async (req) => {
    const u = requireUser(req);
    const s = getSettings();
    return { user: u, restaurant: s.restaurantName, onboardingComplete: s.onboardingComplete, illustrativeData: s.demoData };
  });
}
