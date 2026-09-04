import type { Db } from '@agent-conductor/db';

const depth = new WeakMap<object, number>();

/**
 * Nest-safe transaction. Core services call each other (tickets → decisions → wake), and node:sqlite
 * has no nested BEGIN, so only the outermost call opens the real transaction.
 * Never `await` inside `fn`: do the async work first, then commit synchronously.
 */
export function tx<T>(db: Db, fn: () => T): T {
  const d = depth.get(db) ?? 0;
  if (d > 0) return fn();
  depth.set(db, 1);
  try {
    return db.transaction(fn);
  } finally {
    depth.set(db, 0);
  }
}
