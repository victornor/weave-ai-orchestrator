import type { ReactNode } from 'react';
import { cx } from '../lib/cx';

export interface TabItem {
  key: string;
  label: string;
  badge?: ReactNode;
}

export function Tabs({
  items,
  active,
  onChange,
  className,
}: {
  items: readonly TabItem[];
  active: string;
  onChange: (key: string) => void;
  className?: string;
}): React.ReactElement {
  return (
    <div role="tablist" className={cx('flex gap-1 overflow-x-auto border-b border-line-1 px-1', className)}>
      {items.map((t) => {
        const on = t.key === active;
        return (
          <button
            key={t.key}
            role="tab"
            type="button"
            aria-selected={on}
            onClick={() => onChange(t.key)}
            className={cx(
              'relative shrink-0 px-3 py-2.5 text-ui font-medium transition-colors duration-(--dur-fast) ease-ac',
              on ? 'text-text-1' : 'text-text-3 hover:text-text-2',
            )}
          >
            <span className="flex items-center gap-1.5">
              {t.label}
              {t.badge}
            </span>
            {on ? <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-pill bg-accent" /> : null}
          </button>
        );
      })}
    </div>
  );
}

/** Segmented control: the window / grain / view switcher shape. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  mono,
  className,
  ariaLabel,
}: {
  options: ReadonlyArray<{ value: T; label: string }>;
  value: T;
  onChange: (v: T) => void;
  mono?: boolean;
  className?: string;
  ariaLabel?: string;
}): React.ReactElement {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className={cx('flex overflow-hidden rounded-r6 border border-line-2 bg-bg-1', className)}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.value)}
            className={cx(
              'border-r border-line-1 px-2.5 py-1.5 text-meta transition-colors duration-(--dur-fast) ease-ac last:border-r-0',
              mono && 'ac-mono',
              on ? 'bg-bg-3 text-text-1' : 'text-text-3 hover:text-text-2',
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
