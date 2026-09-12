/**
 * Plan consumption for a subscription account (PLAN §16.3): what replaces the dollar figure when
 * every token in the window was billed to a subscription. Prop-driven — the view model comes from
 * `accountLimits()` in `@weave-ai/render`, so the web app and `weave usage` agree.
 *
 * Both surfaces that show plan limits render this block: the usage page, and the sheet behind the
 * weave chat's header meter. The on-demand sync (VS-84) therefore lives here once, driven by
 * whatever `sync` its caller hands down, and is simply absent when a caller hands down none.
 */
import type { AccountLimitsView } from '@weave-ai/render';
import { cx } from '../lib/cx';

/**
 * How the daemon refreshes the snapshots on its own — the supervisor's `ACCOUNTS_EVERY_MS`. Stated
 * so that a human reading the age can tell whether syncing by hand would say anything new. A
 * literal rather than an import: this component is rendered by route tests that mock the hooks
 * module wholesale, and a cadence that renders as `NaN` in those would be worse than a constant.
 */
const AUTO_SYNC_NOTE = 'The daemon syncs these on its own every 5 minutes.';

/** What a caller needs to give this block for it to offer a sync (VS-84). */
export interface PlanSync {
  /** The runtime a sync is in flight for; its control spins and refuses a second request. */
  pendingRuntimeId: string | null;
  /** Per runtime, what the last attempt came back with: a failed probe, or how long to wait. */
  messages: Record<string, string>;
  onSync: (runtimeId: string) => void;
}

/** Amber past 80 %, red past 95 % — the same thresholds the knowledge budget meter uses. */
function tone(percent: number): string {
  if (percent >= 95) return 'bg-failed';
  if (percent >= 80) return 'bg-stalled';
  return 'bg-accent-link';
}

function Window({ label, percent, resetsIn }: Omit<AccountLimitsView['windows'][number], 'key'>): React.ReactElement {
  return (
    <div>
      <div className="mb-1.5 flex items-baseline gap-2">
        <span className="ac-mono flex-1 text-micro text-text-soft">{label}</span>
        <span className="ac-mono text-micro text-text-1">{percent}%</span>
        {resetsIn ? <span className="ac-mono w-24 text-right text-nano text-text-4">{resetsIn}</span> : null}
      </div>
      <div className="h-1.5 overflow-hidden rounded-pill bg-bg-2">
        <div className={cx('h-full rounded-pill opacity-75', tone(percent))} style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

function SyncButton({ runtimeId, sync }: { runtimeId: string; sync: PlanSync }): React.ReactElement {
  const pending = sync.pendingRuntimeId === runtimeId;
  return (
    <button
      type="button"
      data-testid={`sync-${runtimeId}`}
      disabled={pending}
      aria-busy={pending}
      onClick={() => sync.onSync(runtimeId)}
      className="inline-flex items-center gap-1.5 rounded-r4 px-1.5 py-0.5 text-nano text-accent-link hover:bg-bg-2 disabled:pointer-events-none disabled:opacity-45"
    >
      {pending ? <span className="size-2.5 animate-spin rounded-pill border border-current border-t-transparent" aria-hidden /> : null}
      {pending ? 'Syncing…' : 'Sync now'}
    </button>
  );
}

export function PlanLimits({ accounts, mixedNote, sync, className }: { accounts: AccountLimitsView[]; mixedNote?: string | null; sync?: PlanSync; className?: string }): React.ReactElement | null {
  if (accounts.length === 0) return null;
  return (
    <section className={cx('ac-card p-4', className)}>
      <div className="mb-3.5 text-meta font-medium text-text-soft">Plan limits</div>
      <div className="flex flex-col gap-4">
        {accounts.map((a) => (
          <div key={a.runtimeId} data-testid={`plan-${a.runtimeId}`}>
            <div className="mb-2.5 flex items-baseline gap-2">
              <span className="ac-mono text-meta text-text-1">{a.runtimeId}</span>
              <span className="text-micro text-text-3">{a.plan}</span>
              {/* The age belongs beside the numbers, and says what it is: a number four minutes old
                  should read as four minutes old before anyone decides to sync it. */}
              <span className="ac-mono flex-1 text-right text-nano text-text-4">synced {a.age}</span>
              {sync ? <SyncButton runtimeId={a.runtimeId} sync={sync} /> : null}
            </div>
            {a.limitsAvailable ? (
              <div className="flex flex-col gap-3">
                {a.windows.map(({ key, ...w }: AccountLimitsView['windows'][number]) => <Window key={key} {...w} />)}
              </div>
            ) : (
              // Never draw a bar at zero for something the runtime did not report. A probe that
              // could not describe the account at all says so, rather than reading as a plan
              // that happens to have no windows.
              <p className="text-micro text-text-3">
                {a.probeFailed ? 'Account probe failed' : 'Limits unavailable'}
                {a.note ? <span className="text-text-4"> — {a.note}</span> : null}
              </p>
            )}
            {/* A sync that failed, or one refused as too recent, says so next to the runtime it was
                asked for — the numbers above it must never stand as if they had just come back. */}
            {sync?.messages[a.runtimeId] ? (
              <p data-testid={`sync-note-${a.runtimeId}`} className="mt-1.5 text-nano text-text-4">{sync.messages[a.runtimeId]}</p>
            ) : null}
          </div>
        ))}
      </div>
      {sync ? <p className="mt-3.5 border-t border-line-1 pt-2.5 text-nano text-text-4">{AUTO_SYNC_NOTE}</p> : null}
      {mixedNote ? <p className="mt-3.5 border-t border-line-1 pt-2.5 text-nano text-text-4">{mixedNote}</p> : null}
    </section>
  );
}
