import { randomBytes } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Role } from '@stockpilot/shared';
import { config } from '../config.js';
import { db } from '../db/sqlite.js';
import { AppError, forbidden, id, nowIso, sha256 } from '../lib/util.js';

export const SESSION_COOKIE = 'sp_session';
const SESSION_DAYS = 7;

export type SessionUser = { id: string; name: string; email: string; role: Role };

declare module 'fastify' {
  interface FastifyRequest {
    user?: SessionUser;
  }
}

export function createSession(userId: string): { token: string; expiresAt: string } {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86400000).toISOString();
  db().run(`INSERT INTO sessions (id_hash, user_id, expires_at, created_at) VALUES (?,?,?,?)`, sha256(token), userId, expiresAt, nowIso());
  return { token, expiresAt };
}

export function destroySession(token: string | undefined): void {
  if (token) db().run(`DELETE FROM sessions WHERE id_hash = ?`, sha256(token));
}

export function userForToken(token: string | undefined): SessionUser | undefined {
  if (!token) return undefined;
  const row = db().get<SessionUser & { expires_at: string }>(
    `SELECT u.id, u.name, u.email, u.role, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id_hash = ?`,
    sha256(token),
  );
  if (!row || row.expires_at < new Date().toISOString()) return undefined;
  return { id: row.id, name: row.name, email: row.email, role: row.role };
}

export function setSessionCookie(reply: FastifyReply, token: string, expiresAt: string): void {
  reply.setCookie(SESSION_COOKIE, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    // Secure cookies when the app is served over HTTPS (APP_BASE_URL), plain HTTP for local use.
    secure: config.APP_BASE_URL.startsWith('https://'),
    signed: true,
    expires: new Date(expiresAt),
  });
}

export function readSessionToken(req: FastifyRequest): string | undefined {
  const raw = req.cookies[SESSION_COOKIE];
  if (!raw) return undefined;
  const r = req.unsignCookie(raw);
  return r.valid ? (r.value ?? undefined) : undefined;
}

// ── Login rate limit: 5 failed attempts / 15 min / IP+email (NFR-SEC-3) ──
const WINDOW_MS = 15 * 60 * 1000;

export function checkLoginRate(key: string): void {
  const since = new Date(Date.now() - WINDOW_MS).toISOString();
  db().run(`DELETE FROM login_attempts WHERE at < ?`, since);
  const n = db().get<{ n: number }>(`SELECT COUNT(*) AS n FROM login_attempts WHERE key = ? AND at >= ?`, key, since)!.n;
  if (n >= 5) throw new AppError(429, 'RATE_LIMITED', 'Too many login attempts. Try again in 15 minutes.');
}

export function recordFailedLogin(key: string): void {
  db().run(`INSERT INTO login_attempts (key, at) VALUES (?, ?)`, key, new Date().toISOString());
}

export function clearLoginAttempts(key: string): void {
  db().run(`DELETE FROM login_attempts WHERE key = ?`, key);
}

// ── RBAC ──
export function requireUser(req: FastifyRequest): SessionUser {
  if (!req.user) throw new AppError(401, 'UNAUTHENTICATED', 'Please sign in.');
  return req.user;
}

export function requireRole(req: FastifyRequest, ...roles: Role[]): SessionUser {
  const u = requireUser(req);
  if (!roles.includes(u.role)) throw forbidden(`This action requires the ${roles.join(' or ')} role.`);
  return u;
}

export const ROLE_RANK: Record<Role, number> = { staff: 1, chef: 2, owner: 3 };

export const newUserId = () => id('usr');
