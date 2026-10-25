import { config } from '../config.js';
import { fetchImpl } from './http.js';

// Brevo transactional email (Solution Design §D5.1). Called only by the outbox worker.
export type BrevoResult =
  | { ok: true; messageId: string }
  | { ok: false; status: number; message: string; retryable: boolean }
  | { ok: false; status: 0; message: 'not_configured'; retryable: false };

export function brevoConfigured(): boolean {
  return Boolean(config.BREVO_API_KEY && config.EMAIL_FROM);
}

export async function sendBrevo(msg: { to: string; toName?: string | null; subject: string; html: string; text: string }): Promise<BrevoResult> {
  if (!brevoConfigured()) return { ok: false, status: 0, message: 'not_configured', retryable: false };
  try {
    const res = await fetchImpl('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': config.BREVO_API_KEY!, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        sender: { email: config.EMAIL_FROM, name: config.EMAIL_FROM_NAME },
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

/** Key check for `npm run smoke` and "Test connection" (GET /v3/account). */
export async function checkBrevo(): Promise<string> {
  if (!config.BREVO_API_KEY) return 'no_key';
  const res = await fetchImpl('https://api.brevo.com/v3/account', { headers: { 'api-key': config.BREVO_API_KEY, accept: 'application/json' }, signal: AbortSignal.timeout(10000) });
  return res.ok ? 'ok' : `HTTP ${res.status}`;
}
