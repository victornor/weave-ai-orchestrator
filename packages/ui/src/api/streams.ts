/**
 * One shared `EventStream` per workspace (VS-417).
 *
 * A workspace's event stream is the single long-lived connection a page holds to the daemon, and
 * the daemon serves plain HTTP/1.1 — about six connections per origin, shared by every tab. Before
 * this, a workspace provider, the global fan-in (`FanInStreams`) and every live run subscription
 * each constructed their own `EventStream`, so V2 Live exhausted the budget with a handful of
 * tiles. Acquire/release hands out the one instance for a workspace id, started on the first
 * acquire and stopped when the last consumer lets go, so any number of consumers stack onto it.
 */
import { useContext } from 'react';
import { QueryClient, QueryClientContext } from '@tanstack/react-query';
import type { QueryClient as QueryClientType } from '@tanstack/react-query';
import { EventStream, GlobalEventStream } from './events';

interface Entry {
  stream: EventStream;
  refs: number;
}

interface GlobalEntry {
  stream: GlobalEventStream;
  refs: number;
}

/** The app's query client where there is one, a throwaway otherwise — a stream still opens outside
 *  a provider (a component test that mocks the read hooks); its invalidations are simply unobserved. */
const fallbackClient = new QueryClient();
const entries = new Map<string, Entry>();
const globalEntry: GlobalEntry = { stream: new GlobalEventStream(fallbackClient), refs: 0 };

export function useStreamQueryClient(): QueryClientType {
  return useContext(QueryClientContext) ?? fallbackClient;
}

/** The shared stream for a workspace, created and started when it has no consumer yet. */
export function acquireWorkspaceStream(ws: string, qc: QueryClientType): EventStream {
  let entry = entries.get(ws);
  if (!entry) {
    entry = { stream: new EventStream(ws, qc), refs: 0 };
    entries.set(ws, entry);
  }
  entry.refs += 1;
  if (entry.refs === 1) entry.stream.start();
  return entry.stream;
}

/** Release one consumer's hold; the stream stops when the last one lets go. */
export function releaseWorkspaceStream(ws: string): void {
  const entry = entries.get(ws);
  if (!entry) return;
  entry.refs -= 1;
  if (entry.refs > 0) return;
  entry.stream.stop();
  entries.delete(ws);
}

/** Test-only: how many workspaces currently hold a stream. */
export function workspaceStreamCount(): number {
  return entries.size;
}

/** Test-only: stop and forget every shared stream, so a test starts from no registry state. */
export function resetWorkspaceStreams(): void {
  for (const entry of entries.values()) entry.stream.stop();
  entries.clear();
}

/** The one daemon-wide stream shared by all global consumers in this document. */
export function acquireGlobalStream(qc: QueryClientType): GlobalEventStream {
  // The first consumer supplies the app's query client; subsequent consumers share the same entry.
  if (globalEntry.refs === 0) {
    // GlobalEventStream's query client is intentionally fixed for the document. The fallback is
    // only observable in tests/components mounted without a QueryClientProvider.
    globalEntry.stream = new GlobalEventStream(qc);
  }
  globalEntry.refs += 1;
  if (globalEntry.refs === 1) globalEntry.stream.start();
  return globalEntry.stream;
}

export function releaseGlobalStream(): void {
  if (globalEntry.refs === 0) return;
  globalEntry.refs -= 1;
  if (globalEntry.refs === 0) globalEntry.stream.stop();
}

/** Test-only global registry reset. */
export function resetGlobalStream(): void {
  globalEntry.stream.stop();
  globalEntry.refs = 0;
}
