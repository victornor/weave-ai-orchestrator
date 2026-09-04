import type { SessionRef } from '@openconductor/runtime-sdk';

/** Claude Code sessions are addressed by a UUID the caller may choose up front. */
export interface ClaudeSessionRef { sessionId: string; fork?: boolean }

export function asClaudeSession(ref: SessionRef | null | undefined): ClaudeSessionRef | null {
  if (!ref) return null;
  const id = (ref as { sessionId?: unknown }).sessionId;
  if (typeof id !== 'string' || id.length === 0) return null;
  const fork = (ref as { fork?: unknown }).fork === true;
  return fork ? { sessionId: id, fork: true } : { sessionId: id };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isUuid(s: string): boolean { return UUID_RE.test(s); }
