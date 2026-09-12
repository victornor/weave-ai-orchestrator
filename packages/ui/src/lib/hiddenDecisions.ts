/**
 * Which open decisions this device has hidden from the weave chat's pinned area (VS-72).
 *
 * Hiding is a view preference, not an answer: the decision stays open, stays in Needs you, and the
 * daemon is never told. So it lives in `localStorage` rather than in the workspace — one phone can
 * clear the pinned area of a decision it wants to take later while the laptop still shows it — and
 * every access is guarded the way `lib/wsExpansion.ts` guards its own, because a browser that
 * refuses storage must still render the chat.
 *
 * A hidden decision comes back on its own when what it is asking changes under the human. The
 * stored fingerprint is what makes that possible: it records the decision as it read when it was
 * hidden, so an edited decision no longer matches its own entry and pins again. Supersession needs
 * no trigger — a superseded decision is not open, and its replacement is a different id that was
 * never hidden.
 */
import type { Decision } from '@weave-ai/shared';
import { useCallback, useEffect, useState } from 'react';

const PREFIX = 'conductor.decisions.hidden';

/** Hidden entries are dropped after this long, so the store cannot grow without bound. */
const KEEP_MS = 30 * 24 * 3600e3;

/** A decision this close to expiring pins again: a deadline is a material change to the ask. */
export const EXPIRY_WINDOW_MS = 3600e3;

/** What was hidden, and the decision as it read at the time. */
export interface HiddenEntry {
  fingerprint: string;
  /** ISO, for pruning only. */
  at: string;
}

export type HiddenMap = Record<string, HiddenEntry>;

const EMPTY: HiddenMap = {};

export function hiddenKey(ws: string): string {
  return `${PREFIX}.${ws}`;
}

/**
 * The decision as the human read it when they hid it. Everything the card shows and everything the
 * answer would commit to; `status` is deliberately absent, because a decision that stopped being
 * open leaves the pinned area regardless of what this says.
 */
export function decisionFingerprint(d: Decision): string {
  return JSON.stringify([
    d.title,
    d.context,
    d.recommendation,
    d.allowFreeText,
    d.expiresAt,
    d.options.map((o) => [o.key, o.label, o.description ?? '', o.recommended === true]),
  ]);
}

function prune(map: HiddenMap, now: number): HiddenMap {
  const kept: HiddenMap = {};
  for (const [id, entry] of Object.entries(map)) {
    const at = Date.parse(entry.at);
    if (Number.isNaN(at) || now - at < KEEP_MS) kept[id] = entry;
  }
  return kept;
}

export function readHidden(ws: string): HiddenMap {
  let raw: string | null;
  try {
    raw = localStorage.getItem(hiddenKey(ws));
  } catch {
    return EMPTY;
  }
  if (!raw) return EMPTY;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return EMPTY;
    const map: HiddenMap = {};
    for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
      const e = value as Partial<HiddenEntry>;
      if (typeof e?.fingerprint === 'string' && typeof e.at === 'string') map[id] = { fingerprint: e.fingerprint, at: e.at };
    }
    return map;
  } catch {
    // A half-written entry: nothing is hidden, which is the safe way to be wrong about this.
    return EMPTY;
  }
}

export function writeHidden(ws: string, map: HiddenMap): void {
  try {
    const kept = prune(map, Date.now());
    if (Object.keys(kept).length === 0) localStorage.removeItem(hiddenKey(ws));
    else localStorage.setItem(hiddenKey(ws), JSON.stringify(kept));
  } catch {
    /* private mode: this sitting keeps its hidden set in memory, the device just does not remember it */
  }
}

/**
 * Whether this decision is hidden from the chat right now.
 *
 * An entry only hides the decision it was taken against: an edited decision does not match its own
 * fingerprint any more, and one about to expire is shown whatever the entry says. Both routes ask
 * this same question, so the chat and Needs you can never disagree about what is hidden.
 */
export function isHiddenFromChat(d: Decision, hidden: HiddenMap, now: number = Date.now()): boolean {
  const entry = hidden[d.id];
  if (!entry || entry.fingerprint !== decisionFingerprint(d)) return false;
  if (d.expiresAt !== null && Date.parse(d.expiresAt) - now <= EXPIRY_WINDOW_MS) return false;
  return true;
}

// One store per tab, so the chat and Needs you see the same hidden set without a reload between them.
const listeners = new Set<() => void>();
let cache: { ws: string; map: HiddenMap } | null = null;

function load(ws: string): HiddenMap {
  if (cache?.ws !== ws) cache = { ws, map: readHidden(ws) };
  return cache.map;
}

function store(ws: string, map: HiddenMap): void {
  cache = { ws, map };
  writeHidden(ws, map);
  for (const fn of listeners) fn();
}

export interface HiddenHandle {
  hidden: HiddenMap;
  /** Hide this decision as it currently reads. */
  hide: (d: Decision) => void;
  /** Show one again — Needs you's per-decision restore. */
  show: (id: string) => void;
  /**
   * Show several again. The pinned area's "N hidden" restores every one of them at once, and so
   * does a follow-up comment landing on the ticket a hidden decision hangs off.
   */
  showMany: (ids: readonly string[]) => void;
}

/** The hidden set for one workspace. Switching workspace reads that workspace's own. */
export function useHiddenDecisions(ws: string): HiddenHandle {
  const [map, setMap] = useState<HiddenMap>(() => load(ws));

  // Re-read on a workspace change, and follow every other holder of this hook in the same tab.
  useEffect(() => {
    const sync = (): void => setMap(load(ws));
    sync();
    listeners.add(sync);
    return () => { listeners.delete(sync); };
  }, [ws]);

  const hide = useCallback((d: Decision) => store(ws, { ...load(ws), [d.id]: { fingerprint: decisionFingerprint(d), at: new Date().toISOString() } }), [ws]);

  const drop = useCallback(
    (ids: readonly string[]) => {
      const current = load(ws);
      if (!ids.some((id) => id in current)) return;
      const next = { ...current };
      for (const id of ids) delete next[id];
      store(ws, next);
    },
    [ws],
  );

  const show = useCallback((id: string) => drop([id]), [drop]);
  const showMany = useCallback((ids: readonly string[]) => drop(ids), [drop]);

  return { hidden: map, hide, show, showMany };
}

/** Reset between tests; the store is module state and would otherwise leak across them. */
export function clearHiddenCache(): void {
  cache = null;
}
