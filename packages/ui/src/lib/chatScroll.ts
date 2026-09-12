/**
 * Where each workspace's weave chat was left, so switching workspace and coming back does not
 * throw away the reading position.
 *
 * Module scope, not storage: this is worth keeping while the tab is open and worth forgetting when
 * it is closed. Only a position away from the newest message is worth restoring — a chat left at
 * the bottom should simply open at the bottom and keep following, which `useStickToBottom` already
 * does, so nothing is recorded for it.
 */

const positions = new Map<string, number>();

/** The offset to restore for this workspace, or null when it was last left at the newest message. */
export function readChatScroll(ws: string): number | null {
  return positions.get(ws) ?? null;
}

export function writeChatScroll(ws: string, scrollTop: number, atBottom: boolean): void {
  if (atBottom) positions.delete(ws);
  else positions.set(ws, scrollTop);
}

export function clearChatScroll(ws: string): void {
  positions.delete(ws);
}
