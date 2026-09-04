import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { WorkspaceEvent } from '@agent-conductor/shared';
import { EventStream } from './events';
import type { ConnectionStatus } from './events';
import { setWorkspaceId } from './client';

interface Ctx {
  ws: string;
  connection: ConnectionStatus;
  stream: EventStream | null;
}

const WorkspaceCtx = createContext<Ctx | null>(null);

export function WorkspaceProvider({ ws, children }: { ws: string; children: ReactNode }): React.ReactElement {
  const qc = useQueryClient();
  const [connection, setConnection] = useState<ConnectionStatus>({ state: 'connecting', capturedAt: null, lastSeq: 0, attempts: 0 });
  const [stream, setStream] = useState<EventStream | null>(null);

  useEffect(() => {
    setWorkspaceId(ws);
    const s = new EventStream(ws, qc);
    const off = s.subscribe(setConnection);
    s.start();
    setStream(s);
    return () => {
      off();
      s.stop();
      setStream(null);
    };
  }, [ws, qc]);

  const value = useMemo<Ctx>(() => ({ ws, connection, stream }), [ws, connection, stream]);
  return <WorkspaceCtx.Provider value={value}>{children}</WorkspaceCtx.Provider>;
}

export function useWorkspace(): Ctx {
  const c = useContext(WorkspaceCtx);
  if (!c) throw new Error('useWorkspace outside WorkspaceProvider');
  return c;
}

export function useWs(): string {
  return useWorkspace().ws;
}

export function useConnection(): ConnectionStatus {
  return useWorkspace().connection;
}

/** Subscribe to raw workspace events (live transcripts, arrival toasts). */
export function useWorkspaceEvents(fn: (e: WorkspaceEvent) => void): void {
  const { stream } = useWorkspace();
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    if (!stream) return;
    return stream.onEvent((e) => ref.current(e));
  }, [stream]);
}
