import type { CodexUsage } from './usage.js';
import type { SessionRef } from '@weave-ai/runtime-sdk';

/** Codex calls its conversation handle a thread; the id is reported in `thread.started`. */
export interface CodexSessionRef { threadId: string; fork?: boolean; usage?: CodexUsage }

export function asCodexSession(ref: SessionRef | null | undefined): CodexSessionRef | null {
  if (!ref) return null;
  const r = ref as { threadId?: unknown; sessionId?: unknown; fork?: unknown; usage?: unknown };
  const id = typeof r.threadId === 'string' ? r.threadId : typeof r.sessionId === 'string' ? r.sessionId : null;
  if (!id) return null;
  const u = r.usage as Partial<CodexUsage> | undefined;
  const usage = u && [u.inputTokens, u.outputTokens, u.cachedInputTokens].every(v => typeof v === 'number' && Number.isFinite(v) && v >= 0) ? u as CodexUsage : undefined;
  return { threadId: id, ...(r.fork === true ? { fork: true } : {}), ...(usage ? { usage } : {}) };
}
