import { config } from '../config.js';
import { db } from '../db/sqlite.js';
import { brevoConfigured, senderEmail, sendBrevo } from '../integrations/brevo.js';
import { enqueue } from '../jobs/queue.js';
import { RetryableError, registerJob } from '../jobs/worker.js';
import { audit, notify, publish, SYSTEM } from '../lib/events.js';
import { conflict, id, notFound, nowIso } from '../lib/util.js';

// Transactional outbox (SRS FR-090, Solution Design §D7.2). Rows are inserted in the caller's transaction; the worker sends.
export type EmailKind = 'po' | 'po_reminder' | 'dispute' | 'briefing' | 'notification';
export type EmailRow = {
  id: string;
  kind: EmailKind;
  to_email: string;
  to_name: string | null;
  subject: string;
  html: string;
  text: string;
  status: 'queued' | 'sent' | 'failed' | 'not_configured';
  provider_message_id: string | null;
  error: string | null;
  related_type: string | null;
  related_id: string | null;
  idempotency_key: string | null;
  created_at: string;
  sent_at: string | null;
};

/** Demo mode: every supplier email goes to SUPPLIER_EMAIL_OVERRIDE (default: the sender address) — SRS SAF-6. */
export function supplierRecipient(dbEmail: string): string {
  if (!config.DEMO_MODE) return dbEmail;
  return config.SUPPLIER_EMAIL_OVERRIDE ?? senderEmail() ?? dbEmail;
}

export function queueEmail(e: {
  kind: EmailKind;
  to: string;
  toName?: string | null;
  subject: string;
  html: string;
  text: string;
  relatedType?: string;
  relatedId?: string;
  idempotencyKey?: string;
}): string {
  if (e.idempotencyKey) {
    const existing = db().get<{ id: string }>(`SELECT id FROM email_messages WHERE idempotency_key = ?`, e.idempotencyKey);
    if (existing) return existing.id;
  }
  // Demo mode emails nobody outside: every message (supplier orders, disputes, standups for the sample users, whose
  // domain is not ours) goes to the demo inbox instead (SRS SAF-6).
  if (config.DEMO_MODE) e = { ...e, to: config.SUPPLIER_EMAIL_OVERRIDE ?? senderEmail() ?? e.to };
  const eid = id('eml');
  db().run(
    `INSERT INTO email_messages (id, kind, to_email, to_name, subject, html, text, status, related_type, related_id, idempotency_key, created_at)
     VALUES (?,?,?,?,?,?,?,'queued',?,?,?,?)`,
    eid,
    e.kind,
    e.to,
    e.toName ?? null,
    e.subject,
    e.html,
    e.text,
    e.relatedType ?? null,
    e.relatedId ?? null,
    e.idempotencyKey ?? null,
    nowIso(),
  );
  enqueue('email.send', { emailId: eid }, { idempotencyKey: `email:${eid}`, maxAttempts: 5 });
  return eid;
}

type Outcome = { status: 'sent' | 'failed' | 'not_configured'; messageId?: string; error?: string };
const hooks = new Map<string, (email: EmailRow, outcome: Outcome) => void>();
/** Services react to delivery outcomes (e.g. PO → sent only after Brevo 201). */
export function onEmailOutcome(kind: EmailKind, fn: (email: EmailRow, outcome: Outcome) => void): void {
  hooks.set(kind, fn);
}

function finish(email: EmailRow, outcome: Outcome): void {
  db().tx(() => {
    db().run(
      `UPDATE email_messages SET status = ?, provider_message_id = ?, error = ?, sent_at = ? WHERE id = ?`,
      outcome.status,
      outcome.messageId ?? null,
      outcome.error ?? null,
      outcome.status === 'sent' ? nowIso() : null,
      email.id,
    );
    audit(SYSTEM, `email.${outcome.status}`, 'email', email.id, { meta: { kind: email.kind, to: email.to_email, related: `${email.related_type}:${email.related_id}`, error: outcome.error } });
    hooks.get(email.kind)?.(email, outcome);
  });
  if (outcome.status === 'failed') notify('email_failed', `Email failed: ${email.subject}`, outcome.error, '/activity?tab=outbox');
  publish('email.updated', { id: email.id, status: outcome.status });
}

registerJob('email.send', async ({ emailId }: { emailId: string }, job) => {
  const email = db().get<EmailRow>(`SELECT * FROM email_messages WHERE id = ?`, emailId);
  if (!email || email.status === 'sent') return;
  if (!brevoConfigured()) return finish(email, { status: 'not_configured', error: 'BREVO_API_KEY or BREVO_SENDER_EMAIL not set' });
  const r = await sendBrevo({ to: email.to_email, toName: email.to_name, subject: email.subject, html: email.html, text: email.text });
  if (r.ok) return finish(email, { status: 'sent', messageId: r.messageId });
  // Transient errors are retried; PO and dispute emails are never re-sent after a provider 2xx (handled by status check above).
  if (r.retryable && job.attempts < job.maxAttempts) throw new RetryableError(`Brevo ${r.status}: ${r.message}`);
  finish(email, { status: 'failed', error: `Brevo ${r.status}: ${r.message}` });
});

export function listEmails(limit = 100): Omit<EmailRow, 'html'>[] {
  return db().all(`SELECT id, kind, to_email, to_name, subject, text, status, provider_message_id, error, related_type, related_id, created_at, sent_at FROM email_messages ORDER BY created_at DESC LIMIT ?`, limit);
}

export function getEmail(eid: string): EmailRow {
  const e = db().get<EmailRow>(`SELECT * FROM email_messages WHERE id = ?`, eid);
  if (!e) throw notFound('Email not found');
  return e;
}

/** Resend from the outbox (failed / not_configured only). */
export function resendEmail(eid: string): void {
  const e = getEmail(eid);
  if (e.status === 'sent' || e.status === 'queued') throw conflict(`Email is ${e.status}`);
  db().run(`UPDATE email_messages SET status = 'queued', error = NULL WHERE id = ?`, eid);
  enqueue('email.send', { emailId: eid }, { idempotencyKey: `email:${eid}:resend:${Date.now()}` });
}

export const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export function layout(title: string, body: string): string {
  return `<!doctype html><html><body style="font-family:system-ui,Segoe UI,Arial,sans-serif;background:#f7f6f2;padding:24px;color:#1d2433">
<div style="max-width:640px;margin:auto;background:#fff;border-radius:10px;padding:24px;border:1px solid #e5e2d9">
<p style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#2f6f4f;margin:0">StockPilot AI</p>
<h2 style="margin:6px 0 16px">${esc(title)}</h2>${body}
<p style="font-size:11px;color:#777;margin-top:24px">Sent by StockPilot AI on behalf of the restaurant.</p>
</div></body></html>`;
}

export function table(headers: string[], rows: (string | number)[][]): string {
  const th = headers.map((h) => `<th style="text-align:left;border-bottom:1px solid #ddd;padding:6px 8px;font-size:13px">${esc(h)}</th>`).join('');
  const tr = rows.map((r) => `<tr>${r.map((c) => `<td style="border-bottom:1px solid #eee;padding:6px 8px;font-size:13px">${esc(c)}</td>`).join('')}</tr>`).join('');
  return `<table style="border-collapse:collapse;width:100%;margin:12px 0">${th ? `<tr>${th}</tr>` : ''}${tr}</table>`;
}
