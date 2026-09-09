import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cx } from '../lib/cx';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'link';
type Size = 'sm' | 'md' | 'thumb';

const VARIANT: Record<Variant, string> = {
  primary: 'bg-accent text-accent-on border border-accent hover:bg-accent-hover',
  secondary: 'bg-bg-3 text-text-soft border border-line-2 hover:bg-bg-2',
  ghost: 'bg-transparent text-text-2 border border-transparent hover:bg-bg-2 hover:text-text-1',
  danger: 'bg-failed/15 text-failed border border-failed/35 hover:bg-failed/25',
  link: 'bg-transparent border-0 text-accent-link hover:text-accent-hover p-0',
};

const SIZE: Record<Size, string> = {
  sm: 'h-7 px-2.5 text-meta rounded-r4',
  md: 'h-8 px-3.5 text-ui rounded-r6',
  thumb: 'h-thumb px-4 text-body rounded-r6',
};

/** Same 44px thumb height, one step smaller padding and type (VS-146 chat density). */
const THUMB_COMPACT = 'h-thumb px-3 text-ui rounded-r6';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  /** VS-146: keep the 44px thumb target, shrink padding and label. */
  compact?: boolean;
  kbd?: string;
  full?: boolean;
  children?: ReactNode;
}

export function Button({ variant = 'secondary', size = 'md', compact, kbd, full, className, children, ...rest }: ButtonProps): React.ReactElement {
  return (
    <button
      type="button"
      {...rest}
      className={cx(
        'inline-flex items-center justify-center gap-2 font-medium select-none',
        'transition-colors duration-(--dur-fast) ease-ac',
        'disabled:opacity-45 disabled:pointer-events-none',
        VARIANT[variant],
        variant === 'link' ? '' : compact && size === 'thumb' ? THUMB_COMPACT : SIZE[size],
        full && 'w-full',
        className,
      )}
    >
      {children}
      {kbd ? <span className="ac-mono text-nano opacity-60">{kbd}</span> : null}
    </button>
  );
}

export function IconButton({ label, className, children, ...rest }: ButtonProps & { label: string }): React.ReactElement {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      {...rest}
      className={cx(
        'inline-flex size-8 items-center justify-center rounded-r6 border border-line-2 bg-transparent text-text-2',
        'transition-colors duration-(--dur-fast) ease-ac hover:bg-bg-3 hover:text-text-1 disabled:opacity-45',
        className,
      )}
    >
      {children}
    </button>
  );
}
