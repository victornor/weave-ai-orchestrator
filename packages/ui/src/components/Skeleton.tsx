import { cx } from '../lib/cx';

export function Skeleton({ className }: { className?: string }): React.ReactElement {
  return <div className={cx('oc-skeleton', className)} aria-hidden />;
}

/** Skeletons keep the row rhythm of the loaded state so nothing shifts. */
export function SkeletonRows({ rows = 5, className }: { rows?: number; className?: string }): React.ReactElement {
  const widths = ['w-2/3', 'w-1/2', 'w-3/5', 'w-4/6', 'w-1/3'];
  return (
    <div className={cx('flex flex-col', className)} role="status" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-2 border-b border-line-1 px-4 py-3">
          <Skeleton className="size-2.5 rounded-r4" />
          <Skeleton className={cx('h-2', widths[i % widths.length])} />
          <div className="flex-1" />
          <Skeleton className="h-2 w-8" />
        </div>
      ))}
    </div>
  );
}

export function SkeletonCards({ count = 2, className }: { count?: number; className?: string }): React.ReactElement {
  return (
    <div className={cx('flex flex-col gap-3', className)} role="status" aria-label="Loading">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="oc-card overflow-hidden">
          <div className="flex items-center gap-2 border-b border-line-1 px-3.5 py-2.5">
            <Skeleton className="size-2.5" />
            <Skeleton className="h-2 w-20" />
            <div className="flex-1" />
            <Skeleton className="h-2 w-16" />
          </div>
          <div className="flex flex-col gap-2.5 p-3.5">
            <Skeleton className="h-3 w-3/5" />
            <Skeleton className="h-2 w-4/5" />
            <div className="flex gap-2 pt-1">
              <Skeleton className="h-thumb flex-1 rounded-r6" />
              <Skeleton className="h-thumb flex-1 rounded-r6" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
