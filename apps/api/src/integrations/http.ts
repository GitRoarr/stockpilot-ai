// fetch with timeout and retries for external APIs (NFR-PERF-3). Tests replace `fetchImpl`.

export let fetchImpl: typeof fetch = (...a) => fetch(...a);
export function setFetch(f: typeof fetch): void {
  fetchImpl = f;
}

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public body?: string,
  ) {
    super(message);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function fetchJson<T>(url: string, opts: { timeoutMs: number; retries?: number; init?: RequestInit } = { timeoutMs: 8000 }): Promise<T> {
  const retries = opts.retries ?? 1;
  let last: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetchImpl(url, { ...opts.init, signal: AbortSignal.timeout(opts.timeoutMs) });
      const text = await res.text();
      if (!res.ok) {
        const err = new HttpError(res.status, `HTTP ${res.status}`, text.slice(0, 500));
        if (res.status < 500 && res.status !== 429 && res.status !== 408) throw err;
        last = err;
      } else {
        return JSON.parse(text) as T;
      }
    } catch (e) {
      if (e instanceof HttpError && e.status < 500 && e.status !== 429 && e.status !== 408) throw e;
      last = e;
    }
    if (attempt < retries) await sleep(300 * 2 ** attempt + Math.random() * 200);
  }
  throw last instanceof Error ? last : new Error(String(last));
}
