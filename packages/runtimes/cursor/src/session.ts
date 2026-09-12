import type { SessionRef } from '@weave-ai/runtime-sdk';

/** Cursor print-mode sessions are ids the CLI reports in `session_id`. */
export interface CursorSessionRef { sessionId: string }

export function asCursorSession(ref: SessionRef | null | undefined): CursorSessionRef | null {
  if (!ref) return null;
  const id = (ref as { sessionId?: unknown }).sessionId;
  return typeof id === 'string' && id.length > 0 ? { sessionId: id } : null;
}
