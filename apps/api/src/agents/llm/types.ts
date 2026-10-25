// Provider-neutral conversation format. The checkpoint (agent_runs.history_json) stores these turns; with the
// Interactions API in `store: false` mode the checkpoint is the only conversation state (Solution Design §D3.5).

export type Call = { id: string; name: string; args: Record<string, unknown> };

export type Turn =
  | { role: 'user'; text: string }
  | { role: 'model'; text?: string; calls: Call[]; raw?: unknown; provider?: string; mode?: 'ai' | 'deterministic' }
  | { role: 'tool'; results: { callId: string; name: string; result: unknown }[] };

export type ToolDecl = { name: string; description: string; parameters: Record<string, unknown> };

export type Usage = { tokensIn?: number; tokensOut?: number };

export type ChatRequest = { model: string; system: string; history: Turn[]; tools: ToolDecl[]; timeoutMs: number };
export type ChatResponse = { text?: string; calls: Call[]; raw: unknown; usage?: Usage };

export type StructuredRequest = {
  model: string;
  system: string;
  prompt: string;
  schema: Record<string, unknown>;
  images?: { mimeType: string; data: string }[];
  timeoutMs: number;
};
export type StructuredResponse = { text: string; usage?: Usage };

export interface LlmClient {
  readonly style: 'interactions' | 'generate_content' | 'recorded';
  chat(req: ChatRequest): Promise<ChatResponse>;
  structured(req: StructuredRequest): Promise<StructuredResponse>;
}

export type FallbackReason = 'no_api_key' | 'model_unavailable' | 'rate_limited' | 'timeout' | 'validation_failed' | 'budget_exhausted' | 'model_error';

export class LlmUnavailable extends Error {
  constructor(
    public reason: FallbackReason,
    message: string,
  ) {
    super(message);
  }
}

/** Errors from either SDK carry an HTTP status on `status` (or `code`). */
export function statusOf(e: unknown): number | undefined {
  const s = (e as { status?: unknown; code?: unknown })?.status ?? (e as { code?: unknown })?.code;
  return typeof s === 'number' ? s : undefined;
}

export function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(Object.assign(new Error(`timeout after ${ms} ms`), { status: 408 })), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}
