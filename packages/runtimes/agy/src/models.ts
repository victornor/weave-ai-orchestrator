/**
 * The models agy 1.5.14 lists (`agy models`, 23 ids), as families plus the efforts each offers
 * (VS-995, design §4). Captain (2026-11-22): every model the Antigravity subscription offers is
 * selectable, Claude and GPT-OSS included. Static: `agy models` needs a login and the network.
 *
 * Effort is folded into the id the adapter sends (`gemini-4-neon` + `high` -> `gemini-4-neon-high`)
 * and `--effort` is never passed, so a model id and a conflicting effort flag never both reach agy.
 */
import type { RuntimeModel } from '@weave-ai/runtime-sdk';

/** Every agy model is billed to the Antigravity subscription, whoever made it (design §8). */
export const AGY_PROVIDER = 'antigravity';

/** agy's effort universe, low to high; a family offers a subset. */
export const EFFORT_ORDER = ['low', 'medium', 'high', 'xhigh', 'max'] as const;

export interface AgyFamily { id: string; label: string; efforts: string[]; tier: string }

export const FAMILIES: readonly AgyFamily[] = [
  { id: 'gemini-4-neon', label: 'Gemini 4 Neon', efforts: ['low', 'medium', 'high', 'xhigh'], tier: 'frontier' },
  { id: 'gemini-4-argon', label: 'Gemini 4 Argon', efforts: ['low', 'medium', 'high'], tier: 'frontier' },
  { id: 'gemini-4-hydrogen', label: 'Gemini 4 Hydrogen', efforts: ['low', 'medium', 'high', 'xhigh'], tier: 'frontier' },
  { id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash', efforts: ['low', 'medium', 'high'], tier: 'fast' },
  { id: 'gemini-pro-orchestrator-neon', label: 'Orchestrator (Neon)', efforts: [], tier: 'frontier' },
  { id: 'gemini-pro-orchestrator-g1-pro', label: 'Orchestrator (Argon)', efforts: [], tier: 'frontier' },
  // "(Antigravity)" keeps these apart from the claude runtime's own Opus/Sonnet in any picker.
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5 (Antigravity)', efforts: ['low', 'medium', 'high'], tier: 'frontier' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5 (Antigravity)', efforts: ['low', 'medium', 'high'], tier: 'balanced' },
  { id: 'gpt-oss-120b', label: 'GPT-OSS 120B', efforts: ['medium'], tier: 'balanced' },
];

export const MODELS: readonly RuntimeModel[] = FAMILIES.map((f) => ({
  id: f.id, label: f.label, provider: AGY_PROVIDER, source: 'static' as const, tier: f.tier, efforts: [...f.efforts],
}));

/** Every exact id agy accepts for the listed families. */
export function variantIds(): string[] {
  return FAMILIES.flatMap((f) => (f.efforts.length === 0 ? [f.id] : f.efforts.map((e) => `${f.id}-${e}`)));
}

function rank(effort: string): number { return (EFFORT_ORDER as readonly string[]).indexOf(effort); }

/** The effort a family runs at for a requested one (design §4). */
export function chooseEffort(family: AgyFamily, requested: string | null | undefined): string | null {
  const offered = family.efforts;
  if (offered.length === 0) return null;
  if (!requested) return offered.includes('medium') ? 'medium' : offered[0]!;
  if (offered.includes(requested)) return requested;
  const r = rank(requested);
  const below = offered.filter((e) => rank(e) >= 0 && r >= 0 && rank(e) <= r);
  return below.length > 0 ? below[below.length - 1]! : offered[0]!;
}

/**
 * The exact `--model` value for a model and effort. A family id gets its effort appended; a full
 * variant id, an effortless id or an id this list does not know passes through unchanged (agy
 * resolves it or fails the run with its own error), and any separate effort is then ignored.
 */
export function composeModelId(model: string, effort: string | null | undefined): string {
  const family = FAMILIES.find((f) => f.id === model);
  if (!family) return model;
  const chosen = chooseEffort(family, effort);
  return chosen ? `${family.id}-${chosen}` : family.id;
}
