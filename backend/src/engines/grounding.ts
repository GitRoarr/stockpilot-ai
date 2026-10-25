// Numeric grounding check (Solution Design §D3.8, SRS FR-056, AC-056): every number in AI-written text must match a
// fact value (±1% or display rounding) or be part of a date/time.

const DATE_PATTERNS = [
  /\b\d{4}-\d{2}-\d{2}(T[\d:.]+Z?)?\b/g, // ISO dates
  /\b\d{1,2}:\d{2}(\s?[ap]\.?m\.?)?\b/gi, // times
  /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(st|nd|rd|th)?(,?\s+\d{4})?\b/gi,
  /\b\d{1,2}(st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\b/gi,
  /\b\d{1,2}\/\d{1,2}(\/\d{2,4})?\b/g,
];

/** Identifiers like PO-1042, INV-GG-20817, GG-44120 or M3 are references, not quantities. */
const ID_PATTERN = /\b[A-Z]{1,5}(-[A-Z0-9]+)*-\d+[A-Z0-9-]*\b|\bM[1-4]\b/g;

export function extractNumbers(text: string): number[] {
  let t = text;
  for (const p of DATE_PATTERNS) t = t.replace(p, ' ');
  t = t.replace(ID_PATTERN, ' ');
  const out: number[] = [];
  for (const m of t.matchAll(/-?\$?\d{1,3}(?:,\d{3})+(?:\.\d+)?|-?\$?\d+(?:\.\d+)?/g)) {
    const v = Number(m[0].replace(/[$,]/g, ''));
    if (Number.isFinite(v)) out.push(Math.abs(v));
  }
  return out;
}

/** Recursively collects every finite number in a facts object. */
export function factNumbers(facts: unknown, acc: number[] = []): number[] {
  if (typeof facts === 'number' && Number.isFinite(facts)) acc.push(Math.abs(facts));
  else if (typeof facts === 'string') {
    // Numbers inside fact strings (e.g. an explanation produced by code) are facts too.
    for (const n of extractNumbers(facts)) acc.push(n);
  } else if (Array.isArray(facts)) facts.forEach((f) => factNumbers(f, acc));
  else if (facts && typeof facts === 'object') Object.values(facts).forEach((f) => factNumbers(f, acc));
  return acc;
}

export function isGrounded(n: number, facts: number[]): boolean {
  return facts.some((f) => {
    if (Math.abs(n - f) <= Math.max(0.01 * Math.abs(f), 0.005)) return true;
    // Display rounding: 34.27 shown as 34.3 or 34; percentages shown from ratios (0.048 → 4.8%).
    return [Math.round(f), Math.round(f * 10) / 10, Math.round(f * 100) / 100, Math.round(f * 1000) / 10].some((r) => Math.abs(r - n) < 1e-9);
  });
}

export function checkGrounding(text: string, facts: unknown): { ok: boolean; ungrounded: number[] } {
  const known = factNumbers(facts);
  const ungrounded = extractNumbers(text).filter((n) => !isGrounded(n, known));
  return { ok: ungrounded.length === 0, ungrounded: [...new Set(ungrounded)] };
}
