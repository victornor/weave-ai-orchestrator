import type { ReactNode } from 'react';
import { StatusGlyph } from './StatusGlyph';
import { Button } from './Button';
import { ApiError, NetworkError } from '../api/client';
import { cx } from '../lib/cx';

/** Empty state: one sentence, then what is true instead, then an action. */
export function EmptyState({
  title,
  detail,
  action,
  className,
}: {
  title: string;
  detail?: ReactNode;
  action?: ReactNode;
  className?: string;
}): React.ReactElement {
  return (
    <div className={cx('ac-card mx-auto max-w-sm p-6 text-center', className)}>
      <div className="mb-2.5 flex justify-center">
        <StatusGlyph status="done" size="md" />
      </div>
      <div className="text-ui text-text-soft">{title}</div>
      {detail ? <div className="mt-1 text-micro text-text-3">{detail}</div> : null}
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}

export function codeOf(error: unknown): string {
  if (error instanceof ApiError) return error.code.toUpperCase();
  if (error instanceof NetworkError) return error.code;
  return 'UNKNOWN_ERROR';
}

export function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  return 'Something went wrong.';
}

/** Errors always show the typed code, one sentence, and a next step. */
export function ErrorState({
  error,
  code,
  message,
  onRetry,
  actions,
  className,
}: {
  error?: unknown;
  code?: string;
  message?: string;
  onRetry?: () => void;
  actions?: ReactNode;
  className?: string;
}): React.ReactElement {
  const c = code ?? codeOf(error);
  const m = message ?? messageOf(error);
  return (
    <div className={cx('ac-card border-failed/30 p-3.5', className)} role="alert">
      <div className="mb-2 flex items-center gap-2">
        <StatusGlyph status="failed" size="xs" />
        <span className="ac-mono text-micro text-failed">{c}</span>
      </div>
      <p className="mb-2.5 text-meta leading-relaxed text-text-2">{m}</p>
      <div className="flex items-center gap-3">
        {onRetry ? (
          <Button variant="link" onClick={onRetry}>
            Retry
          </Button>
        ) : null}
        {actions}
      </div>
    </div>
  );
}
