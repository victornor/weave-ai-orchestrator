import { useEffect, useState } from 'react';
import type { ConnectionStatus } from './sseStream';
import { acquireGlobalStream, releaseGlobalStream, useStreamQueryClient } from './streams';

const CONNECTING: ConnectionStatus = { state: 'connecting', capturedAt: null, lastFrameAt: null, attempts: 0 };

/**
 * VS-765: the state of the one daemon-wide stream the shell holds on every signed-in page (VS-630).
 * Joins the shared refcounted entry `FanInStreams` already holds, so it opens no second connection.
 * The shell shows this, because a workspace page's own stream state was only surfaced by a few
 * inline notices and a silent stall was invisible everywhere else.
 */
export function useGlobalConnection(): ConnectionStatus {
  const qc = useStreamQueryClient();
  const [status, setStatus] = useState<ConnectionStatus>(CONNECTING);
  useEffect(() => {
    const stream = acquireGlobalStream(qc);
    setStatus(stream.getStatus());
    const off = stream.subscribe(setStatus);
    return () => {
      off();
      releaseGlobalStream();
    };
  }, [qc]);
  return status;
}
