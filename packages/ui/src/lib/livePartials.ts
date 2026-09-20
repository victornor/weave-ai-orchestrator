/**
 * The partial output a live run is still generating (VS-595), kept as a pure map so the ordering and
 * de-duplication rules are testable without a stream. A `run.delta` frame part carries the text and
 * the `offset` it starts at: it extends what is held when the offset matches, is dropped when it
 * repeats what is already there, and reports a gap when text is missing — the caller re-reads
 * `GET /runs/:id/live` once rather than showing text with a hole in it.
 */
import type { RunDeltaPart, RunEvent, RunLiveSnapshot } from '@weave-ai/shared';

export interface PartialText { partId: string; kind: RunDeltaPart['kind']; text: string }
export type PartialMap = ReadonlyMap<string, PartialText>;

export function applyDelta(current: PartialMap, parts: readonly RunDeltaPart[]): { map: PartialMap; gap: boolean } {
  const next = new Map(current);
  let gap = false;
  for (const p of parts) {
    const held = next.get(p.partId);
    const have = held?.text.length ?? 0;
    if (p.offset > have) { gap = true; continue; }
    if (p.offset + p.text.length <= have) continue;
    next.set(p.partId, { partId: p.partId, kind: p.kind, text: (held?.text ?? '') + p.text.slice(have - p.offset) });
  }
  return { map: next, gap };
}

/** Seed from `GET /runs/:id/live`: the snapshot wins over anything held for the same part. */
export function fromSnapshot(snapshot: RunLiveSnapshot): PartialMap {
  return new Map(snapshot.partials.map((p) => [p.partId, { partId: p.partId, kind: p.kind, text: p.text }]));
}

/** The completed event for a part supersedes its partial: it must render once. */
export function dropSuperseded(map: PartialMap, events: readonly RunEvent[]): PartialText[] {
  if (map.size === 0) return [];
  const done = new Set<string>();
  for (const e of events) {
    const id = e.payload['partId'];
    if (typeof id === 'string') done.add(id);
  }
  return [...map.values()].filter((p) => !done.has(p.partId));
}
