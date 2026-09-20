/**
 * VS-622: pure view-model helpers for the Plan tab's collapsed draft cards. The card list is judged
 * by eye and measured poorly under jsdom, so the decision it rests on — which short text a collapsed
 * card shows — lives here as a pure function with its own tests.
 */
import type { PlanDraft } from '@weave-ai/shared';

/**
 * The short text a collapsed draft card shows: the draft's own `summary` when set, else the first
 * sentence of its description, else empty. Whitespace is collapsed so a multi-line description still
 * yields a one-line summary; a description with no sentence terminator falls back to the whole
 * (trimmed) description, and an empty description to an empty string.
 */
export function draftSummary(draft: Pick<PlanDraft, 'summary' | 'description'>): string {
  const summary = draft.summary?.trim();
  if (summary) return summary;
  const description = draft.description.replace(/\s+/g, ' ').trim();
  if (!description) return '';
  const end = /[.!?](?:\s|$)/.exec(description);
  return end ? description.slice(0, end.index + 1).trim() : description;
}
