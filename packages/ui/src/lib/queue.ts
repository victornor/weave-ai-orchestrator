/**
 * Offline / mid-turn write queue. Composer messages, ticket comments and
 * decision answers taken while offline are held here and flushed on
 * reconnect; decisions are re-validated by the daemon when they land
 * (designer's call 6).
 */
import { useCallback, useEffect, useState } from 'react';

export interface QueuedWrite {
  id: string;
  kind: 'thread' | 'comment' | 'decision';
  path: string;
  body: unknown;
  label: string;
  queuedAt: string;
}

const KEY = 'oc.queue';

function read(): QueuedWrite[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as QueuedWrite[]) : [];
  } catch {
    return [];
  }
}

function write(items: QueuedWrite[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(items));
  } catch {
    /* private mode */
  }
  listeners.forEach((l) => l(items));
}

const listeners = new Set<(items: QueuedWrite[]) => void>();

export function enqueue(item: Omit<QueuedWrite, 'id' | 'queuedAt'>): QueuedWrite {
  const q: QueuedWrite = { ...item, id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, queuedAt: new Date().toISOString() };
  write([...read(), q]);
  return q;
}

export function queued(): QueuedWrite[] {
  return read();
}

export function remove(id: string): void {
  write(read().filter((q) => q.id !== id));
}

export function clearQueue(): void {
  write([]);
}

/** Send everything in order; stop at the first failure so ordering holds. */
export async function flushQueue(send: (q: QueuedWrite) => Promise<unknown>): Promise<{ sent: number; failed: number }> {
  let sent = 0;
  for (const q of read()) {
    try {
      await send(q);
      remove(q.id);
      sent++;
    } catch {
      return { sent, failed: read().length };
    }
  }
  return { sent, failed: 0 };
}

export function useQueue(): QueuedWrite[] {
  const [items, setItems] = useState<QueuedWrite[]>(read);
  useEffect(() => {
    listeners.add(setItems);
    return () => {
      listeners.delete(setItems);
    };
  }, []);
  return items;
}

export function useQueueCount(kind?: QueuedWrite['kind']): number {
  const items = useQueue();
  return kind ? items.filter((i) => i.kind === kind).length : items.length;
}

export function useFlushOnReconnect(online: boolean, send: (q: QueuedWrite) => Promise<unknown>): void {
  const run = useCallback(() => void flushQueue(send), [send]);
  useEffect(() => {
    if (online && read().length) run();
  }, [online, run]);
}
