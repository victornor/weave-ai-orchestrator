import type { SessionRef } from '@weave-ai/runtime-sdk';

/** An agy conversation, resumed with `--conversation <id>`; the id is the stream's `conversation_id`. */
export interface AgySessionRef { conversationId: string }

export function asAgySession(ref: SessionRef | null | undefined): AgySessionRef | null {
  if (!ref) return null;
  const id = (ref as { conversationId?: unknown }).conversationId;
  return typeof id === 'string' && id.length > 0 ? { conversationId: id } : null;
}
