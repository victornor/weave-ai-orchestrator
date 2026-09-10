/**
 * Recovering a tab that was open across a daemon upgrade (VS-210). Its already-loaded JS still
 * references the previous build's hashed chunk names, so a route it has not visited yet fails to
 * lazy-load once the daemon has moved on — not a real bug, just a stale reference a fresh
 * `index.html` fixes. `sessionStorage`, not a plain in-memory flag, so the guard survives the reload
 * it is there to gate; a short window rather than a one-shot-forever flag so a later, independent
 * upgrade later in the same tab's life still gets its own attempt.
 */

const KEY = 'conductor.chunkReload.at';
const WINDOW_MS = 15_000;

/** The known wordings browsers use for a dynamic `import()` that failed to fetch its module. */
const CHUNK_ERROR = /failed to fetch dynamically imported module|error loading dynamically imported module|importing a module script failed/i;

export function isDynamicImportError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return CHUNK_ERROR.test(message);
}

/** `false` only when a reload was already marked within the window — i.e. this looks like a loop. */
export function shouldReloadForChunkError(now: number = Date.now()): boolean {
  let last: string | null;
  try {
    last = sessionStorage.getItem(KEY);
  } catch {
    return true; // private mode: no guard possible, so err toward the one-time reload
  }
  if (!last) return true;
  const at = Number(last);
  return !Number.isFinite(at) || now - at > WINDOW_MS;
}

export function markChunkReload(now: number = Date.now()): void {
  try {
    sessionStorage.setItem(KEY, String(now));
  } catch {
    /* private mode: nothing to guard with; the caller still reloads once this call */
  }
}
