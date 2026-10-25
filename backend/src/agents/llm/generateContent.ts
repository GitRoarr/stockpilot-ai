import { GoogleGenAI } from '@google/genai';
import { withTimeout, type ChatRequest, type ChatResponse, type LlmClient, type StructuredRequest, type StructuredResponse, type Turn } from './types.js';

// Gemini generateContent adapter ("legacy, fully supported"; GEMINI_API_STYLE=generate_content).
export function toContents(history: Turn[]): any[] {
  return history.map((t) => {
    if (t.role === 'user') return { role: 'user', parts: [{ text: t.text }] };
    if (t.role === 'model') {
      if (t.provider === 'generate_content' && t.raw && typeof t.raw === 'object') return t.raw;
      return { role: 'model', parts: [...(t.text ? [{ text: t.text }] : []), ...t.calls.map((c) => ({ functionCall: { id: c.id, name: c.name, args: c.args } }))] };
    }
    return { role: 'user', parts: t.results.map((r) => ({ functionResponse: { id: r.callId, name: r.name, response: { result: r.result } } })) };
  });
}

export class GenerateContentClient implements LlmClient {
  readonly style = 'generate_content' as const;
  private ai: GoogleGenAI;
  constructor(apiKey: string) {
    this.ai = new GoogleGenAI({ apiKey });
  }

  async chat(req: ChatRequest): Promise<ChatResponse> {
    const r: any = await withTimeout(
      this.ai.models.generateContent({
        model: req.model,
        contents: toContents(req.history),
        config: {
          systemInstruction: req.system,
          temperature: 0.2,
          tools: [{ functionDeclarations: req.tools.map((t) => ({ name: t.name, description: t.description, parametersJsonSchema: t.parameters })) }],
        },
      }),
      req.timeoutMs,
    );
    const content = r.candidates?.[0]?.content;
    const calls = (r.functionCalls ?? []).map((c: any, i: number) => ({ id: String(c.id ?? `call_${i}`), name: String(c.name), args: c.args ?? {} }));
    const text = calls.length ? undefined : (r.text ?? undefined);
    return { text, calls, raw: content, usage: { tokensIn: r.usageMetadata?.promptTokenCount, tokensOut: r.usageMetadata?.candidatesTokenCount } };
  }

  async structured(req: StructuredRequest): Promise<StructuredResponse> {
    const parts: any[] = [{ text: req.prompt }, ...(req.images ?? []).map((i) => ({ inlineData: { mimeType: i.mimeType, data: i.data } }))];
    const r: any = await withTimeout(
      this.ai.models.generateContent({
        model: req.model,
        contents: [{ role: 'user', parts }],
        config: { systemInstruction: req.system, temperature: 0.1, responseMimeType: 'application/json', responseJsonSchema: req.schema },
      }),
      req.timeoutMs,
    );
    return { text: r.text ?? '', usage: { tokensIn: r.usageMetadata?.promptTokenCount, tokensOut: r.usageMetadata?.candidatesTokenCount } };
  }
}
