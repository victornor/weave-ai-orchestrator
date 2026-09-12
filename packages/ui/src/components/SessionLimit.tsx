/**
 * The conductor's live plan meter in the chat header (PLAN §16.3): how much of the current session
 * window the subscription behind the conductor has spent, and how long until it resets. Prop-driven
 * — the view model comes from `runtimeLimitStrip()` in `@weave-ai/render`, the same snapshot
 * the usage page reads, so the two can never disagree.
 *
 * The strip is deliberately absent rather than empty on a metered account: an API key has no window
 * to be a fraction of, and a bar at zero would be a lie about a plan that does not exist.
 */
import { useEffect, useMemo, useState } from 'react';
import type { RuntimeAccount } from '@weave-ai/shared';
import { accountLimits, runtimeLimitStrip } from '@weave-ai/render';
import { PlanLimits, type PlanSync } from './PlanLimits';
import { Sheet } from './Sheet';
import { cx } from '../lib/cx';

/**
 * How often the countdown is recomputed. The snapshot itself only moves on the daemon's 5-minute
 * probe; this is the local tick between refreshes, at half the minute the countdown is written in.
 */
export const COUNTDOWN_TICK_MS = 30_000;

/** A clock that advances on its own, so a countdown rendered from it does not freeze. */
function useNow(everyMs: number): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), everyMs);
    return () => clearInterval(t);
  }, [everyMs]);
  return now;
}

/** Amber past 80 %, red past 95 % — the same thresholds the plan-limit bars use. */
const TONE: Record<'ok' | 'warn' | 'over', string> = {
  ok: 'bg-accent-link',
  warn: 'bg-stalled',
  over: 'bg-failed',
};

export function SessionLimit({
  accounts,
  runtimeId,
  sync,
  className,
}: {
  accounts: RuntimeAccount[] | null | undefined;
  runtimeId: string | null | undefined;
  /** Handed straight to the block in the sheet, so the header offers the same sync the usage page does (VS-84). */
  sync?: PlanSync;
  className?: string;
}): React.ReactElement | null {
  const [open, setOpen] = useState(false);
  const now = useNow(COUNTDOWN_TICK_MS);
  const view = useMemo(() => runtimeLimitStrip(accounts, runtimeId, now), [accounts, runtimeId, now]);
  const account = useMemo(() => (accounts ?? []).find((a) => a.runtimeId === runtimeId) ?? null, [accounts, runtimeId]);

  if (!view) return null;

  // Hover carries what the strip has no room for: which runtime this is, its plan, and when the
  // snapshot was taken — a number three hours old should look three hours old.
  const title = `${view.runtimeId} · ${view.plan} · captured ${view.age} (${new Date(view.capturedAt).toLocaleString()})`;
  const label = view.meter
    ? `${view.meter.label} ${view.meter.percent}%${view.meter.resetsIn ? `, resets in ${view.meter.resetsIn}` : ''}`
    : `${view.reason}`;

  return (
    <>
      <button
        type="button"
        data-testid="session-limit"
        onClick={() => setOpen(true)}
        title={title}
        aria-label={`Weaver plan limits — ${label}`}
        className={cx(
          'flex min-w-0 flex-none items-center gap-1.5 rounded-r4 px-1.5 py-1 whitespace-nowrap hover:bg-bg-2',
          className,
        )}
      >
        {view.meter ? (
          <>
            <span className="hidden text-micro text-text-soft sm:inline">{view.meter.label}</span>
            <span className="ac-mono text-micro text-text-1">{view.meter.percent}%</span>
            <span className="hidden h-1.5 w-14 overflow-hidden rounded-pill bg-bg-2 sm:block" aria-hidden>
              <span className={cx('block h-full rounded-pill opacity-75', TONE[view.meter.tone])} style={{ width: `${view.meter.percent}%` }} />
            </span>
            {view.meter.resetsIn ? <span className="ac-mono text-nano text-text-4">· {view.meter.resetsIn}</span> : null}
          </>
        ) : (
          // One quiet reason, never a zero: a probe that could not describe the account says so.
          <span className="text-micro text-text-3">{view.reason}</span>
        )}
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Weaver plan limits">
        {/* The block carries the age, the sync control and the daemon's own cadence — the same
            block the usage page renders, so the two surfaces cannot drift apart. */}
        {account ? <PlanLimits accounts={accountLimits([account], now)} sync={sync} /> : null}
      </Sheet>
    </>
  );
}
