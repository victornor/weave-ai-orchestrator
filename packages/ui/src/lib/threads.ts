/**
 * The workspace's default web thread — the one the chat opens.
 *
 * `GET /threads?channel=web` (`useThreads`) returns the workspace's web threads most-recently-active
 * first, and `ThreadSummary` carries no `is_primary` (the daemon's `channel_threads.is_primary` is
 * not on the wire), so the default is the first row. This is the one rule: V1's chat route and the
 * V2 hire modal both use it, so a message posted without an explicit thread lands where the human is
 * looking. A caller with no thread creates one.
 */
import type { ThreadSummary } from '../api/types';

export function defaultThread(threads: readonly ThreadSummary[]): ThreadSummary | null {
  return threads[0] ?? null;
}
