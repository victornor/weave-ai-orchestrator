/**
 * Unsent composer text, held while the human is somewhere else in the app.
 *
 * A draft belongs to one conversation in one workspace, so the key carries both: nothing typed in
 * one workspace can surface in another. `sessionStorage`, not `localStorage` — a draft is for this
 * tab and this sitting, so it survives a reload and a walk around the app but does not wait on a
 * shared device for whoever opens the browser next.
 *
 * The store is reactive (VS-450): a write from one component is published to every other component
 * bound to the same key, so the shell-level dictation session can write into a thread's draft while
 * the chat is unmounted and have a mounted composer follow it. The public `draftKey`/`readDraft`/
 * `writeDraft`/`useDraft` shape is unchanged, so V1's composers are untouched.
 */
import { useCallback, useSyncExternalStore } from 'react';

export interface Draft {
  text: string;
  /** The conductor message the draft answers, where the composer offers replies. */
  replyToId?: string | null;
  /** The project chosen beside the input; absent means the human has not touched the picker. */
  projectId?: string | null;
}

export interface DraftHandle {
  draft: Draft;
  /** Merge into the draft and persist it. */
  patch: (p: Partial<Draft>) => void;
  /** Drop the whole draft, meta included: what sending, or clearing the field, leaves behind. */
  clear: () => void;
}

const PREFIX = 'conductor.draft';
const EMPTY: Draft = { text: '' };

/** `<ws>` and `<thread>` name the conversation; a draft never crosses either. */
export function draftKey(ws: string, thread: string): string {
  return `${PREFIX}.${ws}.${thread}`;
}

/** Nothing worth keeping: the entry is removed rather than stored empty. */
function isEmpty(d: Draft): boolean {
  return !d.text && !d.replyToId && d.projectId === undefined;
}

function parse(raw: string | null): Draft {
  if (!raw) return EMPTY;
  try {
    const parsed = JSON.parse(raw) as Partial<Draft>;
    return { ...parsed, text: typeof parsed.text === 'string' ? parsed.text : '' };
  } catch {
    // Private mode, a disabled store, or a half-written entry: a lost draft is not worth an error.
    return EMPTY;
  }
}

function readRaw(key: string | null): string | null {
  if (!key) return null;
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

/**
 * The last raw value read for a key and the draft parsed from it. `getSnapshot` must return the
 * same reference while the underlying entry has not changed, or `useSyncExternalStore` re-renders
 * forever; caching by the raw string gives that.
 */
const cache = new Map<string, { raw: string | null; draft: Draft }>();
const listeners = new Map<string, Set<() => void>>();

function snapshot(key: string | null): Draft {
  if (!key) return EMPTY;
  const raw = readRaw(key);
  const held = cache.get(key);
  if (held && held.raw === raw) return held.draft;
  const draft = parse(raw);
  cache.set(key, { raw, draft });
  return draft;
}

function emit(key: string): void {
  for (const fn of listeners.get(key) ?? []) fn();
}

function subscribe(key: string | null, fn: () => void): () => void {
  if (!key) return () => undefined;
  let set = listeners.get(key);
  if (!set) {
    set = new Set();
    listeners.set(key, set);
  }
  set.add(fn);
  return () => {
    set.delete(fn);
    if (!set.size) listeners.delete(key);
  };
}

/**
 * Replace the whole draft at `key` and publish it. An empty draft removes the entry. The
 * dictation session writes its transcript here while the chat may be unmounted (VS-450).
 */
export function setDraft(key: string | null, draft: Draft): void {
  if (!key) return;
  try {
    if (isEmpty(draft)) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, JSON.stringify(draft));
  } catch {
    /* private mode: the draft holds for this session only */
  }
  cache.delete(key);
  emit(key);
}

/** Merge into the draft and publish it to every listener. */
export function patchDraft(key: string | null, p: Partial<Draft>): void {
  if (!key) return;
  setDraft(key, { ...snapshot(key), ...p });
}

/** Drop the whole draft, meta included. */
export function clearDraft(key: string | null): void {
  setDraft(key, EMPTY);
}

export function readDraft(key: string | null): Draft {
  return parse(readRaw(key));
}

export function writeDraft(key: string | null, draft: Draft): void {
  setDraft(key, draft);
}

/**
 * A one-shot prompt another screen hands the chat (VS-478), so an empty roadmap's "ask the weaver
 * about roadmaps" button opens chat with the question already typed. Stored under a reserved thread
 * segment in the same per-workspace store, so a seed can never be read in another workspace and the
 * chat can consume it once its thread id exists (which is after the first render).
 */
const SEED_THREAD = '__seed__';

export function seedDraft(ws: string, text: string): void {
  writeDraft(draftKey(ws, SEED_THREAD), { text });
}

/** The seeded prompt, consumed: read and cleared in one call, so it is shown at most once. */
export function takeSeededDraft(ws: string): string | null {
  const key = draftKey(ws, SEED_THREAD);
  const text = readDraft(key).text;
  if (!text) return null;
  clearDraft(key);
  return text;
}

/**
 * The draft for one conversation, kept in sync with every other reader and writer of the same key.
 * `key` may be null while the thread is still loading; the snapshot is re-read when it changes, so
 * switching thread or workspace never carries the previous one over.
 */
export function useDraft(key: string | null): DraftHandle {
  const sub = useCallback((fn: () => void) => subscribe(key, fn), [key]);
  const get = useCallback(() => snapshot(key), [key]);
  const draft = useSyncExternalStore(sub, get, get);
  const patch = useCallback((p: Partial<Draft>) => patchDraft(key, p), [key]);
  const clear = useCallback(() => clearDraft(key), [key]);
  return { draft, patch, clear };
}