import type { ApiError } from '@stockpilot/shared';

export class ApiFailure extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

/** Set while a data reset runs: the reset ends all sessions, and the page signs out on its own when it finishes. */
export const authRedirect = { paused: false };

/** Typed fetch wrapper. Sends the custom header that state-changing routes require (NFR-SEC-3). */
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const isForm = init.body instanceof FormData;
  const res = await fetch(`/api${path}`, {
    ...init,
    credentials: 'include',
    headers: { ...(isForm ? {} : { 'content-type': 'application/json' }), 'x-stockpilot': '1', ...(init.headers ?? {}) },
  });
  const body = res.status === 204 ? undefined : await res.json().catch(() => undefined);
  if (!res.ok) {
    const err = (body as ApiError | undefined)?.error;
    if (res.status === 401 && !path.startsWith('/auth') && !path.startsWith('/me') && !authRedirect.paused) window.dispatchEvent(new Event('sp:unauthenticated'));
    throw new ApiFailure(res.status, err?.code ?? 'ERROR', err?.message ?? `Request failed (${res.status})`, err?.details);
  }
  return body as T;
}

export const post = <T>(path: string, body: unknown = {}) => api<T>(path, { method: 'POST', body: JSON.stringify(body) });
export const patch = <T>(path: string, body: unknown) => api<T>(path, { method: 'PATCH', body: JSON.stringify(body) });
export const put = <T>(path: string, body: unknown) => api<T>(path, { method: 'PUT', body: JSON.stringify(body) });
export const upload = <T>(path: string, form: FormData) => api<T>(path, { method: 'POST', body: form });
