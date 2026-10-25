import { GoogleGenAI } from '@google/genai';
import { config } from '../../config.js';
import { withTimeout, type ChatRequest, type ChatResponse, type LlmClient, type StructuredRequest, type StructuredResponse, type Turn } from './types.js';

// Gemini Interactions API adapter (default; Solution Design §D3.1). store:false — history is resent from our checkpoint,
// including thought steps (signatures) returned by the model.
type Step = Record<string, any>;

export function toInteractionSteps(history: Turn[]): Step[] {
  const steps: Step[] = [];
  for (const t of history) {
    if (t.role === 'user') steps.push({ type: 'user_input', content: [{ type: 'text', text: t.text }] });
    else if (t.role === 'model') {
      if (t.provider === 'interactions' && Array.isArray(t.raw)) steps.push(...(t.raw as Step[]));
      else {
        if (t.text) steps.push({ type: 'model_output', content: [{ type: 'text', text: t.text }] });
        for (const c of t.calls) steps.push({ type: 'function_call', id: c.id, name: c.name, arguments: c.args });
      }
    } else {
      for (const r of t.results) steps.push({ type: 'function_result', call_id: r.callId, name: r.name, result: JSON.stringify(r.result) });
    }
  }
  return steps;
}

export function fromInteractionSteps(steps: Step[] | undefined, outputText?: string): Pick<ChatResponse, 'text' | 'calls' | 'raw'> {
  const out = (steps ?? []).filter((s) => ['thought', 'function_call', 'model_output'].includes(s.type));
  const calls = out.filter((s) => s.type === 'function_call').map((s) => ({ id: String(s.id), name: String(s.name), args: (s.arguments ?? {}) as Record<string, unknown> }));
  const text =
    outputText ??
    out
      .filter((s) => s.type === 'model_output')
      .flatMap((s) => (s.content ?? []).filter((c: any) => c.type === 'text').map((c: any) => c.text))
      .join('\n');
  return { text: text || undefined, calls, raw: out };
}

/** Agent steps are short tool choices that don't need deep reasoning (GEMINI_THINKING_LEVEL, default `low`). */
const thinking = () => (config.GEMINI_THINKING_LEVEL === 'default' ? {} : { thinking_level: config.GEMINI_THINKING_LEVEL });

export class InteractionsClient implements LlmClient {
  readonly style = 'interactions' as const;
  private ai: GoogleGenAI;
  constructor(apiKey: string) {
    this.ai = new GoogleGenAI({ apiKey });
  }

  async chat(req: ChatRequest): Promise<ChatResponse> {
    const r: any = await withTimeout(
      (this.ai.interactions as any).create({
        model: req.model,
        input: toInteractionSteps(req.history),
        system_instruction: req.system,
        tools: req.tools.map((t) => ({ type: 'function', name: t.name, description: t.description, parameters: t.parameters })),
        generation_config: { temperature: 0.2, ...thinking() },
        store: false,
      }),
      req.timeoutMs,
    );
    return { ...fromInteractionSteps(r.steps, r.steps?.some((s: Step) => s.type === 'function_call') ? undefined : r.output_text), usage: { tokensIn: r.usage?.total_input_tokens, tokensOut: r.usage?.total_output_tokens } };
  }

  async structured(req: StructuredRequest): Promise<StructuredResponse> {
    const content: Step[] = [{ type: 'text', text: req.prompt }, ...(req.images ?? []).map((i) => ({ type: 'image', mime_type: i.mimeType, data: i.data }))];
    const r: any = await withTimeout(
      (this.ai.interactions as any).create({
        model: req.model,
        input: [{ type: 'user_input', content }],
        system_instruction: req.system,
        response_format: { type: 'text', mime_type: 'application/json', schema: req.schema },
        generation_config: { temperature: 0.1, ...thinking() },
        store: false,
      }),
      req.timeoutMs,
    );
    const text = r.output_text ?? fromInteractionSteps(r.steps).text ?? '';
    return { text, usage: { tokensIn: r.usage?.total_input_tokens, tokensOut: r.usage?.total_output_tokens } };
  }

  async ping(model: string): Promise<string> {
    const m: any = await withTimeout(this.ai.models.get({ model }), 10000);
    return String(m?.name ?? model);
  }
}
