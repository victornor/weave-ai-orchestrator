/**
 * Plan consumption for a subscription account (PLAN §16.3): what replaces the dollar figure when
 * every token in the window was billed to a subscription. Prop-driven — the view model comes from
 * `accountLimits()` in `@agent-conductor/render`, so the web app and `conductor usage` agree.
 */
import type { AccountLimitsView } from '@agent-conductor/render';
import { cx } from '../lib/cx';

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

export function PlanLimits({ accounts, className }: { accounts: AccountLimitsView[]; className?: string }): React.ReactElement | null {
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
              <span className="ac-mono flex-1 text-right text-nano text-text-4">{a.age}</span>
            </div>
            {a.limitsAvailable ? (
              <div className="flex flex-col gap-3">
                {a.windows.map(({ key, ...w }: AccountLimitsView['windows'][number]) => <Window key={key} {...w} />)}
              </div>
            ) : (
              // Never draw a bar at zero for something the runtime did not report.
              <p className="text-micro text-text-3">Limits unavailable{a.note ? <span className="text-text-4"> — {a.note}</span> : null}</p>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
