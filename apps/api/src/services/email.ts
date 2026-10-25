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

// Transactional email layout: table-based and inline-styled so it renders the same in Gmail, Outlook and Apple Mail.
const BRAND = '#0f6e56';
export function layout(title: string, body: string, opts: { preheader?: string; restaurant?: string } = {}): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${esc(title)}</title></head>
<body style="margin:0;padding:0;background:#f6f5f1;color:#1c201e;font-family:Inter,-apple-system,'Segoe UI',Roboto,Arial,sans-serif;-webkit-font-smoothing:antialiased">
${opts.preheader ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(opts.preheader)}</div>` : ''}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f5f1;padding:28px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px">
<tr><td style="padding:0 4px 14px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
    <td style="font-size:15px;font-weight:700;color:#1c201e"><img src="${esc(config.APP_BASE_URL)}/logo-email.png" width="28" height="28" alt="" style="vertical-align:-8px;margin-right:8px;border:0">StockPilot AI</td>
    ${opts.restaurant ? `<td align="right" style="font-size:12px;color:#646a66">${esc(opts.restaurant)}</td>` : ''}
  </tr></table>
</td></tr>
<tr><td style="background:#ffffff;border:1px solid #e7e4dd;border-radius:10px;padding:28px">
  <h1 style="margin:0 0 18px;font-size:20px;line-height:1.3;font-weight:650;color:#1c201e">${esc(title)}</h1>
  <div style="font-size:14px;line-height:1.6;color:#2b302d">${body}</div>
</td></tr>
<tr><td style="padding:16px 4px 0;font-size:11px;line-height:1.6;color:#80867f">Sent by StockPilot AI on behalf of ${esc(opts.restaurant ?? 'the restaurant')}. To respond, please use the button above.</td></tr>
</table></td></tr></table></body></html>`;
}

/** Email button (bulletproof: a padded link inside a table cell). */
export function button(href: string, label: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:20px 0 8px"><tr><td style="border-radius:6px;background:${BRAND}"><a href="${esc(href)}" style="display:inline-block;padding:11px 20px;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:6px">${esc(label)}</a></td></tr></table>`;
}

/** Key facts as a two-column summary box. */
export function summary(rows: [string, string][]): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:4px 0 18px;background:#f6f5f1;border-radius:8px">${rows
    .map(([k, v]) => `<tr><td style="padding:8px 14px;font-size:13px;color:#646a66;width:40%">${esc(k)}</td><td style="padding:8px 14px;font-size:13px;font-weight:600;color:#1c201e;text-align:right">${v}</td></tr>`)
    .join('')}</table>`;
}

/** Data table; columns listed in `right` are right-aligned (amounts and quantities). */
export function table(headers: string[], rows: (string | number)[][], right: number[] = []): string {
  const al = (i: number) => (right.includes(i) ? 'right' : 'left');
  const th = headers.map((h, i) => `<th style="text-align:${al(i)};border-bottom:1px solid #e7e4dd;padding:8px 10px;font-size:12px;font-weight:600;color:#646a66;background:#faf9f6">${esc(h)}</th>`).join('');
  const tr = rows.map((r) => `<tr>${r.map((c, i) => `<td style="text-align:${al(i)};border-bottom:1px solid #f0eee8;padding:9px 10px;font-size:13px;color:#1c201e">${esc(c)}</td>`).join('')}</tr>`).join('');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:8px 0 12px;border:1px solid #e7e4dd;border-radius:8px">${th ? `<tr>${th}</tr>` : ''}${tr}</table>`;
}
