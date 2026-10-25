import { randomBytes } from 'node:crypto';
import { config } from '../config.js';
import { db } from '../db/sqlite.js';
import { gone, notFound, now, nowIso, sha256 } from '../lib/util.js';

// Signed portal links (NFR-SEC-4, Solution Design §D4.1): 32 random bytes, SHA-256 stored, one document, 7-day expiry, revocable.
export type Scope = 'po' | 'dispute';

export function createPortalToken(scope: Scope, refId: string, days = 7): { token: string; url: string; expiresAt: string } {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(now().getTime() + days * 86400000).toISOString();
  db().run(`INSERT INTO portal_tokens (token_hash, scope, ref_id, expires_at, created_at) VALUES (?,?,?,?,?)`, sha256(token), scope, refId, expiresAt, nowIso());
  return { token, url: `${config.APP_BASE_URL.replace(/\/$/, '')}/s/${token}`, expiresAt };
}

export function revokePortalTokens(scope: Scope, refId: string): void {
  db().run(`UPDATE portal_tokens SET revoked_at = ? WHERE scope = ? AND ref_id = ? AND revoked_at IS NULL`, nowIso(), scope, refId);
}

/** 404 for unknown tokens or a document outside the token's scope, 410 for expired or revoked tokens (AC-072). */
export function resolvePortalToken(token: string, expectRef?: { scope?: Scope; refId?: string }): { scope: Scope; refId: string } {
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) throw notFound('Link not found');
  const r = db().get<{ scope: Scope; ref_id: string; expires_at: string; revoked_at: string | null }>(`SELECT * FROM portal_tokens WHERE token_hash = ?`, sha256(token));
  if (!r) throw notFound('Link not found');
  if (r.revoked_at) throw gone('This link has been revoked. Please contact the restaurant for a new one.');
  if (r.expires_at < nowIso()) throw gone('This link has expired. Please contact the restaurant for a new one.');
  if (expectRef?.scope && expectRef.scope !== r.scope) throw notFound('Link not found');
  if (expectRef?.refId && expectRef.refId !== r.ref_id) throw notFound('Document not found');
  return { scope: r.scope, refId: r.ref_id };
}
