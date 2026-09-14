/**
 * FLIP motion for the V2 Work kanban board (VS-426). When a ticket changes status it leaves one
 * column and mounts in another, and every card between the two jumps to close or open the gap.
 * This module measures each card's viewport box before and after a board change and animates the
 * difference with the Web Animations API — transform and opacity only, so the compositor does the
 * work and no column's scroll position moves.
 *
 * It is deliberately small and dependency-free. Motion is reserved for a change to what the board
 * holds while the filters stand still: the caller passes a `suppressKey` covering the filters and
 * the queries that are still resolving, and a board change under a different key is not animated
 * (first paint, a filter/project/finished/search/view switch, a query settling). `--dur-*` in the
 * stylesheet cannot reach the Web Animations API, so `prefers-reduced-motion` is honoured here.
 */
import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';

export interface FlipBox {
  left: number;
  top: number;
  width: number;
  height: number;
  /** The `[data-v2-column]` key the card sits in, so a cross-column move can be told from a reorder. */
  column: string | null;
}

interface Measured extends FlipBox {
  el: HTMLElement;
}

export interface FlipMove {
  key: string;
  /** True when the card changed column, so it must fly rather than transform in place. */
  across: boolean;
}

export interface FlipDiff {
  moved: FlipMove[];
  entered: string[];
  left: string[];
}

const MOVE_MS = 280;
const ENTER_MS = 220;
const EXIT_MS = 180;
const EASE = 'cubic-bezier(0.2, 0.8, 0.3, 1)';
const MOVE_THRESHOLD_PX = 1;

/** The keys whose box changed, appeared or disappeared between two reads. Pure, so it is unit-tested. */
export function diffBoxes(
  prev: ReadonlyMap<string, FlipBox>,
  next: ReadonlyMap<string, FlipBox>,
  threshold = MOVE_THRESHOLD_PX,
): FlipDiff {
  const moved: FlipMove[] = [];
  const entered: string[] = [];
  for (const [key, box] of next) {
    const before = prev.get(key);
    if (!before) {
      entered.push(key);
      continue;
    }
    const across = before.column !== box.column;
    if (
      across ||
      Math.abs(before.left - box.left) > threshold ||
      Math.abs(before.top - box.top) > threshold ||
      Math.abs(before.width - box.width) > threshold ||
      Math.abs(before.height - box.height) > threshold
    ) {
      moved.push({ key, across });
    }
  }
  const left: string[] = [];
  for (const key of prev.keys()) if (!next.has(key)) left.push(key);
  return { moved, entered, left };
}

/** Every card's viewport box in a board container, keyed by ticket identifier. */
export function readBoxes(container: HTMLElement): Map<string, Measured> {
  const boxes = new Map<string, Measured>();
  for (const el of container.querySelectorAll<HTMLElement>('[data-v2-card]')) {
    const key = el.getAttribute('data-v2-card');
    if (!key) continue;
    const rect = el.getBoundingClientRect();
    boxes.set(key, {
      el,
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
      column: el.closest<HTMLElement>('[data-v2-column]')?.getAttribute('data-v2-column') ?? null,
    });
  }
  return boxes;
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

function canAnimate(): boolean {
  return typeof Element !== 'undefined' && typeof Element.prototype.animate === 'function';
}

export interface FlipOptions {
  /** The board's composition and order: changes exactly when a card moves, enters or leaves. */
  boardSignature: string;
  /** Filters and query-resolution state; a board change under a different key is a filter, not a move. */
  suppressKey: string;
}

interface FlipState {
  container: HTMLElement | null;
  boxes: Map<string, Measured>;
  boardSignature: string;
  suppressKey: string;
  ghosts: HTMLElement[];
  hidden: Set<HTMLElement>;
  animations: Animation[];
}

/** Clear a batch's clones and in-flight animations, revealing any card hidden for a cross-column move. */
function resetBatch(state: FlipState): void {
  for (const animation of state.animations) {
    try {
      animation.cancel();
    } catch {
      /* an already-finished animation has nothing to cancel */
    }
  }
  state.animations.length = 0;
  for (const ghost of state.ghosts) ghost.remove();
  state.ghosts.length = 0;
  for (const el of state.hidden) el.style.visibility = '';
  state.hidden.clear();
}

/** A fixed clone of a card at a box, so it can fly or fade outside its column's scroll clipping. */
function makeGhost(el: HTMLElement, box: FlipBox, root: HTMLElement, state: FlipState): HTMLElement {
  const ghost = el.cloneNode(true) as HTMLElement;
  ghost.setAttribute('aria-hidden', 'true');
  // Dropped so a ghost is never measured as a card, nor read as one by a test.
  ghost.removeAttribute('data-v2-card');
  ghost.tabIndex = -1;
  Object.assign(ghost.style, {
    position: 'fixed',
    left: `${box.left}px`,
    top: `${box.top}px`,
    width: `${box.width}px`,
    height: `${box.height}px`,
    margin: '0',
    zIndex: '60',
    pointerEvents: 'none',
    willChange: 'transform, opacity',
  });
  root.appendChild(ghost);
  state.ghosts.push(ghost);
  return ghost;
}

function animateWithin(state: FlipState, to: Measured, from: FlipBox): void {
  const dx = from.left - to.left;
  const dy = from.top - to.top;
  const animation = to.el.animate(
    [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }],
    { duration: MOVE_MS, easing: EASE },
  );
  state.animations.push(animation);
}

function animateAcross(state: FlipState, root: HTMLElement, from: Measured, to: Measured): void {
  const ghost = makeGhost(from.el, from, root, state);
  to.el.style.visibility = 'hidden';
  state.hidden.add(to.el);
  const animation = ghost.animate(
    [
      { transform: 'none' },
      { transform: `translate(${to.left - from.left}px, ${to.top - from.top}px)` },
    ],
    { duration: MOVE_MS, easing: EASE, fill: 'forwards' },
  );
  state.animations.push(animation);
  animation.finished.then(
    () => revealGhost(state, ghost, to.el),
    () => revealGhost(state, ghost, to.el),
  );
}

function dropGhost(state: FlipState, ghost: HTMLElement): void {
  // A newer batch (or unmount) already cleaned this up; do not resurrect a card it is animating.
  if (!ghost.isConnected) return;
  ghost.remove();
  const i = state.ghosts.indexOf(ghost);
  if (i >= 0) state.ghosts.splice(i, 1);
}

function revealGhost(state: FlipState, ghost: HTMLElement, el: HTMLElement): void {
  if (!ghost.isConnected) return;
  dropGhost(state, ghost);
  el.style.visibility = '';
  state.hidden.delete(el);
}

function animateEnter(state: FlipState, el: HTMLElement): void {
  const animation = el.animate(
    [
      { opacity: 0, transform: 'scale(0.97)' },
      { opacity: 1, transform: 'none' },
    ],
    { duration: ENTER_MS, easing: EASE },
  );
  state.animations.push(animation);
}

function animateExit(state: FlipState, root: HTMLElement, from: Measured): void {
  const ghost = makeGhost(from.el, from, root, state);
  const animation = ghost.animate(
    [
      { opacity: 1, transform: 'none' },
      { opacity: 0, transform: 'scale(0.97)' },
    ],
    { duration: EXIT_MS, easing: EASE, fill: 'forwards' },
  );
  state.animations.push(animation);
  animation.finished.then(() => dropGhost(state, ghost), () => undefined);
}

function runBatch(
  container: HTMLElement,
  prev: Map<string, Measured>,
  next: Map<string, Measured>,
  diff: FlipDiff,
  state: FlipState,
): void {
  if (!canAnimate()) return;
  resetBatch(state);
  const root = container.closest<HTMLElement>('.v2-root') ?? container;
  for (const key of diff.entered) {
    const to = next.get(key);
    if (to) animateEnter(state, to.el);
  }
  for (const { key, across } of diff.moved) {
    const from = prev.get(key);
    const to = next.get(key);
    if (!from || !to) continue;
    if (across) animateAcross(state, root, from, to);
    else animateWithin(state, to, from);
  }
  for (const key of diff.left) {
    const from = prev.get(key);
    if (from) animateExit(state, root, from);
  }
}

/**
 * Animate the board container's cards across a composition change. The first sight of a container,
 * an unchanged composition, reduced motion and any board change under a new `suppressKey` all
 * record the new boxes without animating.
 */
export function useFlipList(containerRef: RefObject<HTMLElement | null>, opts: FlipOptions): void {
  const state = useRef<FlipState>({
    container: null,
    boxes: new Map(),
    boardSignature: '',
    suppressKey: '',
    ghosts: [],
    hidden: new Set(),
    animations: [],
  });

  const { boardSignature, suppressKey } = opts;

  useLayoutEffect(() => {
    const current = state.current;
    const container = containerRef.current;
    if (!container) {
      // The board is gone (table view, or before first data): drop the baseline so a remount records
      // fresh boxes instead of animating against stale ones.
      current.container = null;
      current.boxes = new Map();
      return;
    }

    const boxes = readBoxes(container);
    if (current.container !== container) {
      resetBatch(current);
      current.container = container;
      current.boxes = boxes;
      current.boardSignature = boardSignature;
      current.suppressKey = suppressKey;
      return;
    }
    if (boardSignature === current.boardSignature) {
      // No card moved, entered or left; a scroll or a re-render only refreshes the baseline.
      current.boxes = boxes;
      current.suppressKey = suppressKey;
      return;
    }

    const suppressed = suppressKey !== current.suppressKey;
    const prev = current.boxes;
    const diff = diffBoxes(prev, boxes);
    current.boxes = boxes;
    current.boardSignature = boardSignature;
    current.suppressKey = suppressKey;
    if (suppressed || prefersReducedMotion()) return;
    runBatch(container, prev, boxes, diff, current);
  }, [containerRef, boardSignature, suppressKey]);

  useEffect(() => () => resetBatch(state.current), []);
}
