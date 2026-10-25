import { config } from '../config.js';
import { fetchImpl } from './http.js';

// Brevo transactional email (Solution Design §D5.1). Called only by the outbox worker.
export type BrevoResult =
  | { ok: true; messageId: string }
  | { ok: false; status: number; message: string; retryable: boolean }
  | { ok: false; status: 0; message: 'not_configured'; retryable: false };

/** The verified sender: BREVO_SENDER_* first, then the earlier EMAIL_FROM / EMAIL_FROM_NAME. */
export const senderEmail = (): string | undefined => config.BREVO_SENDER_EMAIL ?? config.EMAIL_FROM;
export const senderName = (): string => config.BREVO_SENDER_NAME ?? config.EMAIL_FROM_NAME;

export function brevoConfigured(): boolean {
  return Boolean(config.BREVO_API_KEY && senderEmail());
}

export async function sendBrevo(msg: { to: string; toName?: string | null; subject: string; html: string; text: string }): Promise<BrevoResult> {
  if (!brevoConfigured()) return { ok: false, status: 0, message: 'not_configured', retryable: false };
  try {
    const res = await fetchImpl('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': config.BREVO_API_KEY!, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        sender: { email: senderEmail(), name: senderName() },
        to: [{ email: msg.to, ...(msg.toName ? { name: msg.toName } : {}) }],
        subject: msg.subject,
        htmlContent: msg.html,
        textContent: msg.text,
      }),
      signal: AbortSignal.timeout(10000),
    });
    const body = (await res.json().catch(() => ({}))) as { messageId?: string; message?: string; code?: string };
    if (res.status === 201 || res.status === 200) return { ok: true, messageId: body.messageId ?? 'unknown' };
    return { ok: false, status: res.status, message: body.message ?? body.code ?? `HTTP ${res.status}`, retryable: res.status === 429 || res.status >= 500 };
  } catch (e) {
    return { ok: false, status: 599, message: (e as Error).message, retryable: true };
  }
}

/**
 * Key check for `npm run smoke` and "Test connection". Uses a read-only transactional-email endpoint, so keys limited
 * to transactional email (no account permission) are reported correctly; nothing is sent.
 */
export async function checkBrevo(): Promise<string> {
  if (!config.BREVO_API_KEY) return 'no_key';
  try {
    const res = await fetchImpl('https://api.brevo.com/v3/smtp/statistics/aggregatedReport?days=1', { headers: { 'api-key': config.BREVO_API_KEY, accept: 'application/json' }, signal: AbortSignal.timeout(10000) });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { message?: string };
      return `HTTP ${res.status}${body.message ? `: ${body.message}` : ''}`;
    }
    return senderEmail() ? 'ok' : 'ok (key valid; set BREVO_SENDER_EMAIL to send)';
  } catch (e) {
    return `error: ${(e as Error).message}`;
  }
}
