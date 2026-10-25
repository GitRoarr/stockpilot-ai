import type { ChatRequest, ChatResponse, LlmClient, StructuredRequest, StructuredResponse } from './types.js';

// Replays recorded model responses (tests and `npm run eval`, SRS NFR-QA-1). Each entry is consumed once, in order,
// optionally filtered by model so primary/fallback behaviour can be scripted (AC-062).
export type RecordedCall = { name: string; args: Record<string, unknown>; forEach?: string };
export type Recording =
  | { kind: 'chat'; model?: string; agent?: string; text?: string; calls?: RecordedCall[] }
  | { kind: 'structured'; model?: string; json: unknown }
  | { kind: 'error'; model?: string; status: number; message?: string };

export class RecordedClient implements LlmClient {
  readonly style = 'recorded' as const;
  readonly requests: { type: 'chat' | 'structured'; model: string; req: ChatRequest | StructuredRequest }[] = [];
  private n = 0;
  constructor(private script: Recording[]) {}

  private take(model: string, kind: 'chat' | 'structured', system = ''): Recording {
    const i = this.script.findIndex((r) => (!r.model || r.model === model) && (r.kind === kind || r.kind === 'error') && (!('agent' in r) || !r.agent || system.startsWith(`You are ${r.agent},`)));
    if (i < 0) throw Object.assign(new Error(`recording exhausted (${kind})`), { status: 500 });
    return this.script.splice(i, 1)[0];
  }

  async chat(req: ChatRequest): Promise<ChatResponse> {
    this.requests.push({ type: 'chat', model: req.model, req });
    const r = this.take(req.model, 'chat', req.system);
    if (r.kind === 'error') throw Object.assign(new Error(r.message ?? `HTTP ${r.status}`), { status: r.status });
    if (r.kind !== 'chat') throw new Error('unexpected recording');
    const calls = (r.calls ?? []).flatMap((c) => expand(c, req.history)).map((c) => ({ id: `rec_${++this.n}`, name: c.name, args: c.args }));
    return { text: r.text, calls, raw: { recorded: true } };
  }

  async structured(req: StructuredRequest): Promise<StructuredResponse> {
    this.requests.push({ type: 'structured', model: req.model, req });
    const r = this.take(req.model, 'structured');
    if (r.kind === 'error') throw Object.assign(new Error(r.message ?? `HTTP ${r.status}`), { status: r.status });
    if (r.kind !== 'structured') throw new Error('unexpected recording');
    return { text: JSON.stringify(r.json) };
  }

  remaining(): number {
    return this.script.length;
  }
}

/**
 * Recordings refer to IDs produced at run time with "{{tool.path}}" (latest result of that tool), and can fan out over a
 * result array with forEach ("{{item.field}}"), e.g. one send_purchase_order per drafted PO.
 */
function latest(history: ChatRequest['history'], tool: string): unknown {
  for (let i = history.length - 1; i >= 0; i--) {
    const t = history[i];
    if (t.role === 'tool') for (const r of t.results) if (r.name === tool) return r.result;
  }
  return undefined;
}

function pick(obj: unknown, path: string[]): unknown {
  return path.reduce<any>((o, k) => (o == null ? undefined : o[k]), obj);
}

function fill(v: unknown, history: ChatRequest['history'], item?: unknown): unknown {
  if (typeof v === 'string') {
    const d = v.match(/^\{\{today([+-]\d+)\}\}$/);
    if (d) return new Date(Date.now() + Number(d[1]) * 86400000).toISOString().slice(0, 10);
    const m = v.match(/^\{\{([\w.-]+)\}\}$/);
    if (!m) return v;
    const [head, ...rest] = m[1].split('.');
    if (head === 'item') return pick(item, rest);
    if (head === 'input') {
      const first = history.find((t) => t.role === 'user');
      return pick(first && first.role === 'user' ? JSON.parse(first.text).inputs : undefined, rest);
    }
    return pick(latest(history, head), rest);
  }
  if (Array.isArray(v)) return v.map((x) => fill(x, history, item));
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fill(x, history, item)]));
  return v;
}

function expand(c: RecordedCall, history: ChatRequest['history']): { name: string; args: Record<string, unknown> }[] {
  if (!c.forEach) return [{ name: c.name, args: fill(c.args, history) as Record<string, unknown> }];
  const [head, ...rest] = c.forEach.split('.');
  const items = pick(latest(history, head), rest);
  return (Array.isArray(items) ? items : []).map((item) => ({ name: c.name, args: fill(c.args, history, item) as Record<string, unknown> }));
}
