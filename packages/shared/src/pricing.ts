/** Per-million-token USD prices by model id prefix. Versioned; overridable via workspace.yaml pricingOverrides. Estimated only. */
export const PRICING_VERSION = '2026-09';
export interface Price { inputPerMTok: number; outputPerMTok: number; cachedInputPerMTok?: number }
const TABLE: Array<[RegExp, Price]> = [
  [/claude-fable-5/, { inputPerMTok: 15, outputPerMTok: 75, cachedInputPerMTok: 1.5 }],
  [/claude-opus-5/, { inputPerMTok: 5, outputPerMTok: 25, cachedInputPerMTok: 0.5 }],
  [/claude-sonnet-5|claude-sonnet-4/, { inputPerMTok: 3, outputPerMTok: 15, cachedInputPerMTok: 0.3 }],
  [/claude-haiku/, { inputPerMTok: 1, outputPerMTok: 5, cachedInputPerMTok: 0.1 }],
  [/gpt-5/, { inputPerMTok: 1.25, outputPerMTok: 10, cachedInputPerMTok: 0.125 }],
  [/gemini-2\.5-pro|gemini-3/, { inputPerMTok: 1.25, outputPerMTok: 10 }],
  [/gemini.*flash/, { inputPerMTok: 0.3, outputPerMTok: 2.5 }],
];
export function lookupPrice(model: string | null | undefined, overrides: Record<string, Price> = {}): Price | null {
  if (!model) return null;
  if (overrides[model]) return overrides[model]!;
  for (const [re, p] of TABLE) if (re.test(model)) return p;
  return null;
}
export function estimateCostCents(model: string | null | undefined, usage: { inputTokens: number; outputTokens: number; cachedInputTokens?: number }, overrides?: Record<string, Price>): number | null {
  const p = lookupPrice(model, overrides);
  if (!p) return null;
  const cached = usage.cachedInputTokens ?? 0;
  const usd = ((usage.inputTokens - cached) * p.inputPerMTok + cached * (p.cachedInputPerMTok ?? p.inputPerMTok) + usage.outputTokens * p.outputPerMTok) / 1e6;
  return Math.round(usd * 100);
}
