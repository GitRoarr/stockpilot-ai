import { EventEmitter } from 'node:events';
import { db } from '../db/sqlite.js';
import { id, nowIso } from './util.js';

/** In-process bus feeding the SSE stream (FR-092) and event-driven agent triggers (FR-058). */
export const bus = new EventEmitter();
bus.setMaxListeners(100);

export type LiveEvent = { type: string; data: Record<string, unknown> };

export function publish(type: string, data: Record<string, unknown> = {}): void {
  bus.emit('live', { type, data } satisfies LiveEvent);
}

export type Actor = { type: 'user' | 'agent' | 'system' | 'supplier'; id?: string | null };
export const SYSTEM: Actor = { type: 'system', id: null };

export function audit(
  actor: Actor,
  action: string,
  entityType?: string | null,
  entityId?: string | null,
  extra: { before?: unknown; after?: unknown; meta?: unknown } = {},
): void {
  db().run(
    `INSERT INTO audit_events (id, at, actor_type, actor_id, action, entity_type, entity_id, before_json, after_json, meta_json)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    id('aud'),
    nowIso(),
    actor.type,
    actor.id ?? null,
    action,
    entityType ?? null,
    entityId ?? null,
    extra.before === undefined ? null : JSON.stringify(extra.before),
    extra.after === undefined ? null : JSON.stringify(extra.after),
    extra.meta === undefined ? null : JSON.stringify(extra.meta),
  );
}

export function notify(kind: string, title: string, body?: string, link?: string, userId: string | null = null): void {
  const nid = id('ntf');
  db().run(
    `INSERT INTO notifications (id, user_id, kind, title, body, link, created_at) VALUES (?,?,?,?,?,?,?)`,
    nid,
    userId,
    kind,
    title,
    body ?? null,
    link ?? null,
    nowIso(),
  );
  publish('notification', { id: nid, kind, title, body, link });
}
