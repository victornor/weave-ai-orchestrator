/**
 * How many Live-floor run tails may stream live at once (VS-227).
 *
 * Every tail now rides the one shared workspace stream (VS-417), so this no longer bounds
 * connections; it bounds how many tails a floor applies live frames to, the rest falling back to
 * the persisted read until a slot frees.
 */
export const MAX_LIVE_RUN_TAILS = 2;

/** First `MAX_LIVE_RUN_TAILS` ids in floor order — the rest wait until a slot frees. */
export function liveRunTailSlots(streamingAgentIds: readonly string[]): Set<string> {
  return new Set(streamingAgentIds.slice(0, MAX_LIVE_RUN_TAILS));
}
