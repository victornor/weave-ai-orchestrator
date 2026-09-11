/**
 * How many Live-floor run tails may hold an EventSource at once (VS-227).
 *
 * The public daemon listener is HTTP/1.1: about six connections per origin. FanInStreams can take
 * one slot per workspace, so two run tails leave a REST slot for chats and sends.
 */
export const MAX_LIVE_RUN_TAILS = 2;

/** First `MAX_LIVE_RUN_TAILS` ids in floor order — the rest wait until a slot frees. */
export function liveRunTailSlots(streamingAgentIds: readonly string[]): Set<string> {
  return new Set(streamingAgentIds.slice(0, MAX_LIVE_RUN_TAILS));
}
