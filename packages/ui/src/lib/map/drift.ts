/**
 * Per-node drift: a small, bounded, deterministic wobble around each node's radial tree
 * position, advanced from a `requestAnimationFrame` timestamp — no physics simulation runs
 * continuously. See design.md §2 (VS-192).
 */

/** Graph-unit amplitude per depth, before any sibling-gap cap. Index 0 is never drawn. */
const BASE_AMPLITUDE = [0, 6, 10, 14, 16, 16];
/** Radians per millisecond: a full wobble period of roughly 25s at freqScale 1. */
const BASE_FREQ = 0.00025;
/** Fraction of the smallest sibling gap a node's amplitude may use, so drift can never meet a neighbour. */
const GAP_FRACTION = 0.2;

function hashOf(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** A stable phase and frequency jitter derived from the node id, so drift needs no stored state. */
export function driftPhase(id: string): { phase: number; freqScale: number } {
  const h = hashOf(id);
  return {
    phase: (h / 4294967296) * Math.PI * 2,
    freqScale: 0.85 + ((h >>> 8) % 1000) / 1000 * 0.3,
  };
}

/** The amplitude a node at `depth` may drift by, capped by the sibling gap when one is known. */
export function amplitudeFor(depth: number, minSiblingGap?: number): number {
  const base = BASE_AMPLITUDE[Math.min(depth, BASE_AMPLITUDE.length - 1)] ?? 0;
  if (minSiblingGap === undefined) return base;
  return Math.min(base, minSiblingGap * GAP_FRACTION);
}

/**
 * The drift offset for a node at time `t` (ms, typically a `requestAnimationFrame` timestamp).
 * `dx`/`dy` are each bounded to `amplitude / sqrt(2)`, so the combined magnitude never exceeds
 * `amplitude` — the guarantee `amplitudeFor`'s cap depends on to keep siblings from colliding.
 */
export function driftOffset(id: string, depth: number, t: number, minSiblingGap?: number): { dx: number; dy: number } {
  const amplitude = amplitudeFor(depth, minSiblingGap);
  if (amplitude <= 0) return { dx: 0, dy: 0 };
  const { phase, freqScale } = driftPhase(id);
  const per = (amplitude * Math.SQRT1_2);
  const ax = t * BASE_FREQ * freqScale + phase;
  const ay = t * BASE_FREQ * freqScale * 0.87 + phase * 1.3;
  return { dx: per * Math.sin(ax), dy: per * Math.sin(ay) };
}
