import type { AuthSession } from '../api/types';
import { ago } from '../lib/format';
import { cx } from '../lib/cx';

const KIND_LABEL: Record<string, string> = { web: 'web', cli: 'CLI', presenter: 'presenter' };

/**
 * The current device is marked by an accent edge, not a different row shape.
 * Revoke is undoable for 5 s (the caller wires the undo toast).
 */
export function DeviceRow({ session, current, onRevoke }: { session: AuthSession; current?: boolean; onRevoke?: (id: string) => void }): React.ReactElement {
  return (
    <div className={cx('flex items-center gap-3 border-b border-line-1 px-4 py-3', current && 'border-l-2 border-l-accent')}>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="ac-truncate text-ui text-text-1">{session.name ?? 'Unnamed session'}</span>
          {current ? <span className="ac-mono text-nano text-accent-link">this device</span> : null}
        </div>
        <div className="ac-mono mt-0.5 text-micro text-text-3">
          {KIND_LABEL[session.kind] ?? session.kind} · {session.ip ?? 'unknown ip'} · {ago(session.lastSeenAt)} ago
        </div>
      </div>
      {onRevoke && !current ? (
        <button type="button" onClick={() => onRevoke(session.id)} className="text-micro font-medium text-blocked hover:text-failed">
          Revoke
        </button>
      ) : null}
    </div>
  );
}
