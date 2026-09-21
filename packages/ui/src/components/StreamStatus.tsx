import type { ConnectionStatus } from '../api/sseStream';
import { cx } from '../lib/cx';
import { clock } from '../lib/format';

/**
 * A per-stream connection notice — the run event stream, the job stream — rendered inline next to
 * the streaming output itself, not as a fixed overlay, so it can never cover the composer or the
 * phone bottom bar. Silent for `connecting`/`connected`, the same threshold `ConnectionBanner`
 * uses, so a stream's own brief opening handshake never flickers a notice.
 */
export function StreamStatusNotice({
  status,
  onRetry,
  className,
}: {
  status: ConnectionStatus;
  onRetry: () => void;
  className?: string;
}): React.ReactElement | null {
  if (status.state === 'connected' || status.state === 'connecting' || status.state === 'hidden') return null;
  const offline = status.state === 'offline' || status.state === 'unreachable';
  const stale = status.state === 'stale';
  const label = offline
    ? 'Offline — retrying automatically'
    : stale
      ? `No updates since ${status.lastFrameAt ? clock(new Date(status.lastFrameAt).toISOString()) : 'the last sync'}`
      : 'Reconnecting…';
  return (
    <div
      role="status"
      className={cx(
        'flex items-center gap-2 rounded-r6 px-2.5 py-1.5 text-micro',
        offline ? 'bg-blocked/10 text-blocked' : 'bg-working/10 text-working',
        className,
      )}
    >
      <span className="size-1.5 flex-none rounded-pill bg-current motion-safe:animate-[ac-pulse_1.6s_ease-in-out_infinite]" />
      <span>{label}</span>
      <button type="button" onClick={onRetry} className="ml-auto text-micro font-medium underline underline-offset-2 hover:no-underline">
        Retry now
      </button>
    </div>
  );
}
