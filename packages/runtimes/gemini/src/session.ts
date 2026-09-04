import type { SessionRef } from '@agent-conductor/runtime-sdk';

/** Gemini sessions are UUIDs the caller may choose with `--session-id`. */
export interface GeminiSessionRef { sessionId: string }

export function asGeminiSession(ref: SessionRef | null | undefined): GeminiSessionRef | null {
  if (!ref) return null;
  const id = (ref as { sessionId?: unknown }).sessionId;
  return typeof id === 'string' && id.length > 0 ? { sessionId: id } : null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isUuid(s: string): boolean { return UUID_RE.test(s); }
