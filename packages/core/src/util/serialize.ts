/**
 * A per-key promise chain: work submitted under the same key runs one piece at a time, in submission
 * order; different keys never wait for each other. Used where two tickets of one project would
 * otherwise mutate the same primary clone at once — the OpenSpec archive (PLAN §12.2) and the
 * delivery landing (PLAN §11.4).
 *
 * In-process only, which is what it needs to be: one daemon owns a workspace's clones.
 */
export interface Serializer {
  <T>(key: string, fn: () => Promise<T>): Promise<T>;
}

export function createSerializer(): Serializer {
  const locks = new Map<string, Promise<unknown>>();
  return <T>(key: string, fn: () => Promise<T>): Promise<T> => {
    const prev = locks.get(key) ?? Promise.resolve();
    // `then(fn, fn)` so a rejected predecessor does not stop everything queued behind it.
    const next = prev.then(fn, fn);
    locks.set(key, next.then(() => undefined, () => undefined));
    return next;
  };
}
