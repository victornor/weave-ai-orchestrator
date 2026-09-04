import type { ConnectionState } from '../api/events';
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
  queuedCount,
  className,
}: {
  state: ConnectionState;
  capturedAt: string | null;
  queuedCount?: number;
  className?: string;
}): React.ReactElement | null {
  if (state === 'connected' || state === 'connecting') return null;
  const offline = state === 'offline' || state === 'unreachable';
  return (
    <div
      role="status"
      className={cx(
        'flex h-banner items-center gap-2 px-4 text-micro',
        offline ? 'bg-blocked/10 text-blocked' : 'bg-working/10 text-working',
        className,
      )}
    >
      <span className="size-1.5 rounded-pill bg-current motion-safe:animate-[oc-pulse_1.6s_ease-in-out_infinite]" />
      <span>
        {offline
          ? `Offline — showing the state from ${capturedAt ? clock(capturedAt) : 'the last sync'}`
          : 'Reconnecting…'}
      </span>
      {queuedCount ? <span className="oc-mono ml-auto">{queuedCount} queued</span> : null}
    </div>
  );
}

/** `NET_DAEMON_UNREACHABLE`, full-screen, at load only. */
export function UnreachableScreen({ host, lastSeen, onRetry, onChangeServer }: { host?: string; lastSeen?: string | null; onRetry: () => void; onChangeServer?: () => void }): React.ReactElement {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-bg-0 p-6 text-center">
      <div className="oc-mono flex items-center gap-2 text-micro text-failed">
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
