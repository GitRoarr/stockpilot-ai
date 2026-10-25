import { db } from '../db/sqlite.js';
import { id, json, now, nowIso } from '../lib/util.js';

// Durable job queue in SQLite (Solution Design §D7.2): leases, retries with exponential backoff + jitter, idempotency keys.
export type Job = { id: string; type: string; payload: any; attempts: number; maxAttempts: number; idempotencyKey: string | null };

type Wake = () => void;
let wake: Wake = () => {};
export function onEnqueue(fn: Wake): void {
  wake = fn;
}

export function enqueue(type: string, payload: unknown, opts: { runAt?: string; idempotencyKey?: string; maxAttempts?: number } = {}): string | null {
  const jid = id('job');
  const r = db().run(
    `INSERT INTO jobs (id, type, payload_json, run_at, max_attempts, status, idempotency_key, created_at) VALUES (?,?,?,?,?,'queued',?,?)
     ON CONFLICT(idempotency_key) DO NOTHING`,
    jid,
    type,
    JSON.stringify(payload ?? {}),
    opts.runAt ?? nowIso(),
    opts.maxAttempts ?? 5,
    opts.idempotencyKey ?? null,
    nowIso(),
  );
  if (r.changes) queueMicrotask(wake);
  return r.changes ? jid : null;
}

const LEASE_MS = 120_000;

export function claimJobs(limit: number): Job[] {
  return db().tx(() => {
    const t = nowIso();
    // Expired leases (crashed worker) are re-queued.
    db().run(`UPDATE jobs SET status = 'queued', locked_until = NULL WHERE status = 'running' AND locked_until < ?`, t);
    const rows = db().all<any>(`SELECT * FROM jobs WHERE status = 'queued' AND run_at <= ? ORDER BY run_at LIMIT ?`, t, limit);
    const lease = new Date(now().getTime() + LEASE_MS).toISOString();
    for (const r of rows) db().run(`UPDATE jobs SET status = 'running', attempts = attempts + 1, locked_until = ? WHERE id = ?`, lease, r.id);
    return rows.map((r) => ({ id: r.id, type: r.type, payload: json(r.payload_json, {}), attempts: r.attempts + 1, maxAttempts: r.max_attempts, idempotencyKey: r.idempotency_key }));
  });
}

export function completeJob(jobId: string): void {
  db().run(`UPDATE jobs SET status = 'done', locked_until = NULL, finished_at = ? WHERE id = ?`, nowIso(), jobId);
}

export function failJob(job: Job, error: string, retryable = true): void {
  if (retryable && job.attempts < job.maxAttempts) {
    const delay = 2000 * 2 ** (job.attempts - 1) + Math.floor(Math.random() * 500);
    db().run(`UPDATE jobs SET status = 'queued', locked_until = NULL, last_error = ?, run_at = ? WHERE id = ?`, error.slice(0, 1000), new Date(now().getTime() + delay).toISOString(), job.id);
  } else {
    db().run(`UPDATE jobs SET status = 'failed', locked_until = NULL, last_error = ?, finished_at = ? WHERE id = ?`, error.slice(0, 1000), nowIso(), job.id);
  }
}

export function queueDepth(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of db().all<{ status: string; n: number }>(`SELECT status, COUNT(*) AS n FROM jobs GROUP BY status`)) out[r.status] = r.n;
  return out;
}
