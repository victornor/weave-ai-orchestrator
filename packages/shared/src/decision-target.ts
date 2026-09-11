import type { Decision } from './types.js';

/**
 * The document reference a decision's `target` carries (VS-224): which document the human is being
 * asked to judge, and the revision being decided. Plan and action approvals write exactly this
 * shape (tickets/service.ts raise paths); the next kind that points at a document reuses it.
 */
export interface DecisionDocumentTarget {
  documentId: string;
  revision?: number;
}

/**
 * Parse the untyped `target` record off a decision. `null` unless `documentId` is a non-empty
 * string and, when present, `revision` is a number — the card renders only what parses, never
 * what a cast promises.
 */
export function documentTarget(d: Pick<Decision, 'target'>): DecisionDocumentTarget | null {
  const t = d.target;
  if (!t || typeof t !== 'object') return null;
  const id = (t as Record<string, unknown>)['documentId'];
  if (typeof id !== 'string' || id.trim() === '') return null;
  const rev = (t as Record<string, unknown>)['revision'];
  if (rev === undefined) return { documentId: id };
  if (typeof rev !== 'number' || !Number.isFinite(rev)) return null;
  return { documentId: id, revision: rev };
}
