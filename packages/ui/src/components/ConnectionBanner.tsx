import { useEffect, useState } from 'react';
import type { ConnectionState } from '../api/events';
import { getReconnectLog, subscribeReconnectLog, type ReconnectEntry } from '../api/sseStream';
import { Button } from './Button';
import { clock } from '../lib/format';
import { cx } from '../lib/cx';

/**
 * connected  — nothing is shown, the status is the absence of a banner
 * reconnecting — a 24px banner under the header; lists stay interactive
 * offline    — read-only last state with the capture time; writes queue
 * unreachable — full screen, at load only
 */
export function ConnectionBanner({
  state,
  capturedAt,
  lastFrameAt,
  queuedCount,
  className,
}: {
  state: ConnectionState;
  capturedAt: string | null;
  /** VS-641: epoch ms of the last frame or heartbeat, for the `stale` notice's age. */
  lastFrameAt?: number | null;
  queuedCount?: number;
  className?: string;
}): React.ReactElement | null {
  const [showDetails, setShowDetails] = useState(false);
  if (state === 'connected' || state === 'connecting' || state === 'hidden') return null;
  const offline = state === 'offline' || state === 'unreachable';
  const stale = state === 'stale';
  return (
    <div className={cx(offline ? 'bg-blocked/10 text-blocked' : 'bg-working/10 text-working', className)}>
      <div role="status" className="flex h-banner items-center gap-2 px-4 text-micro">
        <span className="size-1.5 rounded-pill bg-current motion-safe:animate-[ac-pulse_1.6s_ease-in-out_infinite]" />
        <span>
          {offline
            ? `Offline — showing the state from ${capturedAt ? clock(capturedAt) : 'the last sync'}`
            : stale
              ? `No updates since ${lastFrameAt ? clock(new Date(lastFrameAt).toISOString()) : 'the last sync'}`
              : 'Reconnecting…'}
        </span>
        <span className="ml-auto flex items-center gap-3">
          {queuedCount ? <span className="ac-mono">{queuedCount} queued</span> : null}
          <button type="button" aria-expanded={showDetails} onClick={() => setShowDetails((v) => !v)} className="underline underline-offset-2 hover:no-underline">
            {showDetails ? 'Hide details' : 'Details'}
          </button>
        </span>
      </div>
      {showDetails ? <ReconnectDetails /> : null}
    </div>
  );
}

const CAUSE_TEXT: Record<ReconnectEntry['cause'], string> = {
  error: 'connection error',
  'connect-timeout': 'no answer to a new connection',
  silence: 'nothing received (stream went silent)',
  wake: 'device woke from sleep',
  online: 'network came back',
  retry: 'retried by hand',
};

/** The last reopens of any live stream and why (VS-765): what to read out when a drop recurs. */
function ReconnectDetails(): React.ReactElement {
  const [, bump] = useState(0);
  useEffect(() => subscribeReconnectLog(() => bump((n) => n + 1)), []);
  const entries = getReconnectLog().slice(-8).reverse();
  return (
    <ul aria-label="Recent reconnects" className="ac-mono space-y-0.5 px-4 pb-2 text-nano">
      {entries.length === 0 ? <li>No reconnects recorded in this tab yet.</li> : null}
      {entries.map((e, i) => (
        <li key={`${e.at}-${i}`}>
          {clock(e.at)} · {e.stream} · {CAUSE_TEXT[e.cause]}
          {e.lastFrameAgeMs !== null ? ` · last frame ${Math.round(e.lastFrameAgeMs / 1000)}s earlier` : ''}
          {e.online === false ? ' · device offline' : ''}
          {e.probe ? ` · daemon check: ${e.probe}` : ''}
        </li>
      ))}
    </ul>
  );
}

/** `NET_DAEMON_UNREACHABLE`, full-screen, at load only. */
export function UnreachableScreen({ host, lastSeen, onRetry, onChangeServer }: { host?: string; lastSeen?: string | null; onRetry: () => void; onChangeServer?: () => void }): React.ReactElement {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-bg-0 p-6 text-center">
      <div className="ac-mono flex items-center gap-2 text-micro text-failed">
        <span className="size-2 bg-failed" style={{ clipPath: 'polygon(0 0,100% 0,50% 100%)' }} aria-hidden />
        NET_DAEMON_UNREACHABLE{lastSeen ? ` · last seen ${lastSeen}` : ''}
      </div>
      <h1 className="text-title font-semibold tracking-title text-text-strong">Cannot reach the daemon.</h1>
      <p className="max-w-sm text-meta leading-relaxed text-text-2">
        {host ?? 'The server'} did not respond. Check that the daemon is running, then retry.
      </p>
      <div className="flex gap-2">
        <Button variant="primary" onClick={onRetry}>
          Retry
        </Button>
        {onChangeServer ? <Button onClick={onChangeServer}>Change server</Button> : null}
      </div>
    </div>
  );
}
