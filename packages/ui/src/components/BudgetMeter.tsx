import { ago } from '../lib/format';
import { cx } from '../lib/cx';

/**
 * `web · project KB · 7.2k / 12k tok · curated 2d ago · next in 5d`.
 * Turns amber at "curation due" — the meter is the primary control here,
 * not decoration.
 */
export function BudgetMeter({
  label,
  used,
  budget,
  lastCuratedAt,
  curationPending,
  nextInDays,
  onCurate,
  className,
}: {
  label: string;
  used: number;
  budget: number;
  lastCuratedAt?: string | null;
  curationPending?: boolean;
  nextInDays?: number | null;
  onCurate?: () => void;
  className?: string;
}): React.ReactElement {
  const ratio = budget > 0 ? Math.min(1, used / budget) : 0;
  const due = Boolean(curationPending) || ratio >= 0.9;
  const fmt = (n: number): string => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
  return (
    <div className={cx('oc-card p-3', className)}>
      <div className="mb-2 flex items-baseline gap-2">
        <span className="text-meta font-medium text-text-soft">{label}</span>
        <div className="flex-1" />
        <span className="oc-mono text-micro text-text-2">
          {fmt(used)} / {fmt(budget)} tok
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-pill bg-bg-3" role="meter" aria-valuenow={used} aria-valuemin={0} aria-valuemax={budget} aria-label={`${label} budget`}>
        <div className={cx('h-full transition-[width] duration-(--dur-panel) ease-oc', due ? 'bg-working' : 'bg-accent')} style={{ width: `${Math.round(ratio * 100)}%` }} />
      </div>
      <div className="mt-2 flex items-center gap-2">
        <span className={cx('oc-mono text-nano', due ? 'text-working' : 'text-text-4')}>
          {due ? 'curation due' : `curated ${ago(lastCuratedAt)} ago`}
          {!due && nextInDays != null ? ` · next in ${nextInDays}d` : ''}
        </span>
        <div className="flex-1" />
        {onCurate ? (
          <button type="button" onClick={onCurate} className="text-micro font-medium text-accent-link">
            Curate now
          </button>
        ) : null}
      </div>
    </div>
  );
}
