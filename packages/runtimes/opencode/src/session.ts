import type { SessionRef } from '@agent-conductor/runtime-sdk';

/** OpenCode session ids look like `ses_...` and are only reported by the CLI (never chosen). */
export interface OpenCodeSessionRef { sessionId: string; fork?: boolean }

export function asOpenCodeSession(ref: SessionRef | null | undefined): OpenCodeSessionRef | null {
  if (!ref) return null;
  const r = ref as { sessionId?: unknown; fork?: unknown };
  if (typeof r.sessionId !== 'string' || r.sessionId.length === 0) return null;
  return r.fork === true ? { sessionId: r.sessionId, fork: true } : { sessionId: r.sessionId };
}
