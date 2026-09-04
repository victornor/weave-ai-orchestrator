/** Small hooks shared by the terminal apps: loading, workspace events, terminal size. */
import { useEffect, useRef, useState } from 'react';
import { useInput, useStdout } from 'ink';
import type { TuiClient, TuiSseMessage } from './client.js';

/** Runs `load` on mount, on demand, and on an interval; never sets state after unmount. */
export function useLoader<T>(load: () => Promise<T>, deps: unknown[] = [], intervalMs = 0): {
  data: T | null;
  error: string | null;
  loading: boolean;
  reload: () => void;
} {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    loadRef.current()
      .then((value) => { if (!cancelled) { setData(value); setError(null); } })
      .catch((cause: unknown) => { if (!cancelled) setError((cause as Error)?.message ?? String(cause)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [nonce, ...deps]);

  useEffect(() => {
    if (intervalMs <= 0) return;
    const timer = setInterval(() => setNonce((n) => n + 1), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);

  return { data, error, loading, reload: () => setNonce((n) => n + 1) };
}

export type Connection = 'connecting' | 'connected' | 'reconnecting';

/** Subscribe for the lifetime of the component, exposing the connection state for the status bar. */
export function useStream(
  client: TuiClient,
  path: string | null,
  onMessage: (message: TuiSseMessage) => void,
  options: { after?: string | number | null } = {},
): Connection {
  const [connection, setConnection] = useState<Connection>('connecting');
  const handler = useRef(onMessage);
  handler.current = onMessage;
  const after = options.after ?? null;

  useEffect(() => {
    if (!path) return;
    let subscription: { close(): void } | null = null;
    try {
      subscription = client.stream(path, {
        after,
        onMessage: (message) => handler.current(message),
        onOpen: () => setConnection('connected'),
        onError: () => setConnection('reconnecting'),
      });
    } catch {
      setConnection('reconnecting');
    }
    return () => subscription?.close();
  }, [client, path]);

  return connection;
}

export function useTerminalSize(): { columns: number; rows: number } {
  const { stdout } = useStdout();
  const [size, setSize] = useState({ columns: stdout?.columns ?? 80, rows: stdout?.rows ?? 24 });
  useEffect(() => {
    if (!stdout) return;
    const onResize = () => setSize({ columns: stdout.columns ?? 80, rows: stdout.rows ?? 24 });
    stdout.on('resize', onResize);
    return () => { stdout.off('resize', onResize); };
  }, [stdout]);
  return size;
}

/**
 * `useInput` that is inert when stdin cannot go into raw mode (piped output, a surface that
 * spawned us without a tty). Ink throws in that case; a viewer must degrade to read-only instead.
 */
export function useKeys(handler: Parameters<typeof useInput>[0], options: { isActive?: boolean } = {}): void {
  const active = (options.isActive ?? true) && process.stdin.isTTY === true;
  useInput(handler, { isActive: active });
}
