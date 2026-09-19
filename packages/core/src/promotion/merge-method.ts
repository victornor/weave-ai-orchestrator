import { MERGE_METHODS, type MergeMethod } from '@weave-ai/shared';
import type { RepoMergeSettings } from '@weave-ai/plugin-sdk';

/** The order a repository's allowed methods are preferred when the configured one is not permitted. */
const PREFERENCE: readonly MergeMethod[] = ['squash', 'merge', 'rebase'];

export interface MergeMethodChoice {
  method: MergeMethod;
  /** True when the configured method was not allowed and another permitted one was chosen. */
  fellBack: boolean;
}

/**
 * VS-584: the method a promotion merges with. The project's configured method is used when the
 * repository allows it. When the repository reports a narrower set, the first allowed method in
 * squash → merge → rebase order is used. A `null` settings value means the forge cannot say, so the
 * configured method is used and any refusal surfaces at merge time. A `null` return means the
 * repository allows no method at all: the promotion must be held, never forced.
 */
export function resolveMergeMethod(configured: string | null | undefined, settings: RepoMergeSettings | null): MergeMethodChoice | null {
  const preferred = (MERGE_METHODS as readonly string[]).includes(configured ?? '') ? (configured as MergeMethod) : 'squash';
  if (!settings) return { method: preferred, fellBack: false };
  const allowed = (m: MergeMethod): boolean => (m === 'merge' ? settings.merge : m === 'squash' ? settings.squash : settings.rebase);
  if (allowed(preferred)) return { method: preferred, fellBack: false };
  const fallback = PREFERENCE.find(allowed);
  return fallback ? { method: fallback, fellBack: true } : null;
}
