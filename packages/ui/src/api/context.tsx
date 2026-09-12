import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { WorkspaceEvent } from '@weave-ai/shared';
import { EventStream } from './events';
import type { ConnectionStatus } from './events';
import { setWorkspaceId } from './client';

interface Ctx {
  ws: string;
  connection: ConnectionStatus;
  stream: EventStream | null;
}

const WorkspaceCtx = createContext<Ctx | null>(null);

export function WorkspaceProvider({
  ws,
  remember = true,
  live = true,
  children,
}: {
  ws: string;
  remember?: boolean;
  /** Whether this provider holds its own live `EventStream` (VS-199). A pane that is not the one
   *  the human is looking at passes `false` so global Chats does not open one connection per
   *  listed workspace. */
  live?: boolean;
  children: ReactNode;
}): React.ReactElement {
  const qc = useQueryClient();
  const [connection, setConnection] = useState<ConnectionStatus>({ state: 'connecting', capturedAt: null, lastSeq: 0, attempts: 0 });
  const [stream, setStream] = useState<EventStream | null>(null);

  useEffect(() => {
    if (remember) setWorkspaceId(ws);
    if (!live) {
      setConnection({ state: 'connected', capturedAt: null, lastSeq: 0, attempts: 0 });
      setStream(null);
      return;
    }
    const s = new EventStream(ws, qc);
    const off = s.subscribe(setConnection);
    s.start();
    setStream(s);
    return () => {
      off();
      s.stop();
      setStream(null);
    };
  }, [ws, qc, remember, live]);

  const value = useMemo<Ctx>(() => ({ ws, connection, stream }), [ws, connection, stream]);
  return <WorkspaceCtx.Provider value={value}>{children}</WorkspaceCtx.Provider>;
}

export function useOptionalWorkspace(): Ctx | null {
  return useContext(WorkspaceCtx);
}

export function useWorkspace(): Ctx {
  const c = useContext(WorkspaceCtx);
  if (!c) throw new Error('useWorkspace outside WorkspaceProvider');
  return c;
}

export function useWs(): string {
  return useWorkspace().ws;
}

/** Workspace id for a hook: an explicit override, else the provider, else empty (query disabled). */
export function useHookWs(override?: string): string {
  const ctx = useContext(WorkspaceCtx);
  return override ?? ctx?.ws ?? '';
}

export function useConnection(): ConnectionStatus {
  return useOptionalWorkspace()?.connection ?? { state: 'connected', capturedAt: null, lastSeq: 0, attempts: 0 };
}

/** Subscribe to raw workspace events (live transcripts, arrival toasts). */
export function useWorkspaceEvents(fn: (e: WorkspaceEvent) => void): void {
  const stream = useOptionalWorkspace()?.stream ?? null;
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    if (!stream) return;
    return stream.onEvent((e) => ref.current(e));
  }, [stream]);
}

/** Opens one EventStream per listed workspace while a global page is mounted (VS-168). */
export function FanInStreams({ ids }: { ids: readonly string[] }): null {
  const qc = useQueryClient();
  const key = ids.join('\0');
  useEffect(() => {
    if (!ids.length) return;
    const streams = ids.map((id) => {
      const s = new EventStream(id, qc);
      s.start();
      return s;
    });
    return () => {
      for (const s of streams) s.stop();
    };
  }, [qc, key]);
  return null;
}
