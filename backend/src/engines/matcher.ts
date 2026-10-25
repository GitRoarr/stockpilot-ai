// Invoice line matcher (Solution Design §D2.5, SRS FR-084). Deterministic and idempotent.

const UNIT_TOKENS = new Set(['lb', 'lbs', 'oz', 'each', 'ea', 'cs', 'case', 'cases', 'pk', 'pack', 'packs', 'kg', 'g', 'gal', 'qt', 'ct', 'count', 'x', 'per', 'bag', 'box']);

export function normalizeDescription(s: string): string {
  return tokens(s).sort().join(' ');
}

export function tokens(s: string): string[] {
  const words = s
    .toLowerCase()
    .replace(/["'#]/g, ' ')
    .replace(/[^a-z0-9/.\s-]/g, ' ')
    .split(/[\s,\-]+/)
    .filter(Boolean)
    // Pack sizes and quantities ("6oz", "10lb", "3/8", "40") carry no identity.
    .map((w) => w.replace(/^\d+([./]\d+)?(lb|lbs|oz|kg|g|ct|ea|gal|qt)?$/, ''))
    .filter((w) => w && !UNIT_TOKENS.has(w));
  return [...new Set(words)];
}

export function jaccard(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  const A = new Set(a);
  const B = new Set(b);
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / (A.size + B.size - inter);
}

export type MatchInvoiceLine = { index: number; description: string; sku?: string | null };
export type MatchPoLine = { id: string; sku: string; description: string; offerId: string };
export type MatchResult = { index: number; poLineId: string | null; method: 'sku' | 'alias' | 'similarity' | 'none'; score: number };

export const SIMILARITY_THRESHOLD = 0.6;

/**
 * 1. exact supplier SKU → 2. stored supplier alias (confirmed mapping) → 3. token-set Jaccard ≥ 0.6 with a unique best
 * candidate → otherwise unmatched (the AP Clerk may suggest a mapping for the user to confirm; else `not_ordered`).
 * Each PO line is matched at most once.
 */
export function matchLines(inv: MatchInvoiceLine[], po: MatchPoLine[], aliases: Map<string, string> = new Map()): MatchResult[] {
  const used = new Set<string>();
  const out: MatchResult[] = inv.map((l) => ({ index: l.index, poLineId: null, method: 'none', score: 0 }));
  const sku = (s?: string | null) => (s ?? '').trim().toUpperCase();

  inv.forEach((l, k) => {
    if (!sku(l.sku)) return;
    const p = po.find((x) => !used.has(x.id) && sku(x.sku) === sku(l.sku));
    if (p) {
      used.add(p.id);
      out[k] = { index: l.index, poLineId: p.id, method: 'sku', score: 1 };
    }
  });
  inv.forEach((l, k) => {
    if (out[k].poLineId) return;
    const offerId = aliases.get(normalizeDescription(l.description));
    const p = offerId ? po.find((x) => !used.has(x.id) && x.offerId === offerId) : undefined;
    if (p) {
      used.add(p.id);
      out[k] = { index: l.index, poLineId: p.id, method: 'alias', score: 1 };
    }
  });
  inv.forEach((l, k) => {
    if (out[k].poLineId) return;
    const t = tokens(l.description);
    const scored = po
      .filter((x) => !used.has(x.id))
      .map((x) => ({ x, s: jaccard(t, tokens(x.description)) }))
      .sort((a, b) => b.s - a.s);
    const best = scored[0];
    if (!best || best.s < SIMILARITY_THRESHOLD) return;
    if (scored[1] && Math.abs(scored[1].s - best.s) < 1e-9) return; // not unique
    used.add(best.x.id);
    out[k] = { index: l.index, poLineId: best.x.id, method: 'similarity', score: Math.round(best.s * 100) / 100 };
  });
  return out;
}
