/**
 * A fast streaming-style reveal for text that arrived while the human was watching — a weaver reply
 * landing in the chat, or a dictated transcript landing in the composer.
 *
 * The reveal is short on purpose (VS-425): it exists so text does not pop into existence, not to be
 * watched. Nothing animates when the platform asks for reduced motion, and nothing animates for text
 * that was already on screen when the view opened — a history read back is not a stream.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ThreadMessage } from '@weave-ai/shared';

/** A typical reply is well under a second; this is the whole reveal, not a per-character delay. */
export const REVEAL_MS = 420;

/** How often the reveal advances. Small enough to read as a stream, few enough to stay cheap. */
export const REVEAL_STEP_MS = 16;

/**
 * How many characters of a `length`-character string are visible `elapsedMs` into the reveal.
 * At least one, so the first frame is never an empty box; never more than the whole string.
 */
export function revealedCount(length: number, elapsedMs: number, durationMs = REVEAL_MS): number {
  if (length <= 0) return 0;
  if (durationMs <= 0) return length;
  const p = Math.min(1, Math.max(0, elapsedMs / durationMs));
  return Math.min(length, Math.max(1, Math.round(length * p)));
}

/** True when the platform asks for no animation. Live, so a change mid-session is honoured. */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => prefersReducedMotion());
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = (): void => setReduced(mq.matches);
    onChange();
    // `addEventListener` where the platform has it; the older `addListener` otherwise (and in the
    // minimal `matchMedia` stubs some tests install).
    if (typeof mq.addEventListener === 'function') {
      mq.addEventListener('change', onChange);
      return () => mq.removeEventListener('change', onChange);
    }
    if (typeof mq.addListener === 'function') {
      mq.addListener(onChange);
      return () => mq.removeListener(onChange);
    }
    return;
  }, []);
  return reduced;
}

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false;
}

/**
 * The visible prefix of `full`. `animate` is read once, at mount: the caller decides whether this
 * text is new, and a later render — an unrelated state change, a refetch that returns the same body
 * — must neither restart the reveal nor cut it short. Reduced motion, and an environment with no
 * timer, return the whole string on the first frame.
 */
export function useStreamReveal(full: string, animate: boolean, durationMs = REVEAL_MS): string {
  const reduced = usePrefersReducedMotion();
  const [shouldAnimate] = useState(() => animate && !reduced);
  const [visible, setVisible] = useState(() => (shouldAnimate ? '' : full));

  useEffect(() => {
    if (!shouldAnimate) {
      setVisible(full);
      return;
    }
    if (typeof setInterval !== 'function') {
      setVisible(full);
      return;
    }
    const total = Math.max(1, Math.ceil(durationMs / REVEAL_STEP_MS));
    let step = 0;
    const timer = setInterval(() => {
      step += 1;
      setVisible(full.slice(0, revealedCount(full.length, step * REVEAL_STEP_MS, durationMs)));
      if (step >= total) clearInterval(timer);
    }, REVEAL_STEP_MS);
    return () => clearInterval(timer);
  }, [shouldAnimate, full, durationMs]);

  return shouldAnimate ? visible : full;
}

/**
 * The ids of outbound (weaver) messages that genuinely arrived after this thread opened, so only
 * those reveal. What was on screen at load is the baseline and never animates; a page paged in from
 * history is *older* than the baseline's newest timestamp and is excluded even though its id is new;
 * an id seen on an earlier render is exhausted.
 */
export function useNewOutboundMessageIds(
  messages: readonly ThreadMessage[] | undefined,
  threadId: string | null,
): ReadonlySet<string> {
  const known = useRef<Set<string>>(new Set());
  /** The thread the baseline below belongs to, and its newest timestamp at the moment it opened. */
  const baseline = useRef<{ thread: string | null; newest: string } | null>(null);

  useEffect(() => {
    if (!messages) return;
    if (!baseline.current || baseline.current.thread !== threadId) {
      // First content for this thread: everything loaded so far is history, never revealed.
      baseline.current = { thread: threadId, newest: messages.reduce((max, m) => (m.createdAt > max ? m.createdAt : max), '') };
      known.current = new Set(messages.map((m) => m.id));
      return;
    }
    for (const m of messages) known.current.add(m.id);
  }, [messages, threadId]);

  // Computed during render, before the effect above has marked the newest message seen — that is
  // what makes the arriving message animate on the render it first appears and not a render later.
  return useMemo(() => {
    const ids = new Set<string>();
    const open = baseline.current;
    if (!open || open.thread !== threadId) return ids;
    for (const m of messages ?? []) {
      if (m.direction === 'outbound' && !known.current.has(m.id) && m.createdAt > open.newest) ids.add(m.id);
    }
    return ids;
    // `threadId` is read here as well as in the effect so a thread switch never leaks the old set.
  }, [messages, threadId]);
}
