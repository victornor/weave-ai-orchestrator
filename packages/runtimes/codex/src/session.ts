import type { SessionRef } from '@agent-conductor/runtime-sdk';

/** Codex calls its conversation handle a thread; the id is reported in `thread.started`. */
export interface CodexSessionRef { threadId: string; fork?: boolean }

export function asCodexSession(ref: SessionRef | null | undefined): CodexSessionRef | null {
  if (!ref) return null;
  const r = ref as { threadId?: unknown; sessionId?: unknown; fork?: unknown };
  const id = typeof r.threadId === 'string' ? r.threadId : typeof r.sessionId === 'string' ? r.sessionId : null;
  if (!id) return null;
  return r.fork === true ? { threadId: id, fork: true } : { threadId: id };
}
