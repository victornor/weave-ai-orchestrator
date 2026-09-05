import type { ReactNode } from 'react';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';

export interface AProps {
  to: string;
  params?: Record<string, unknown>;
  search?: Record<string, unknown> | ((prev: Record<string, unknown>) => Record<string, unknown>);
  replace?: boolean;
  className?: string;
  title?: string;
  'aria-label'?: string;
  'aria-current'?: 'page' | 'true' | undefined;
  children?: ReactNode;
}

/**
 * Route paths are assembled at runtime (workspace slug in every path), so the
 * typed-link generics get in the way; this is the one place that is loosened.
 */
export const A = Link as unknown as (props: AProps) => React.ReactElement;

export type Go = (to: string, opts?: { params?: Record<string, unknown>; search?: Record<string, unknown>; replace?: boolean }) => void;

export function useGo(): Go {
  const nav = useNavigate();
  return (to, opts) => void (nav as unknown as (o: Record<string, unknown>) => void)({ to, ...(opts ?? {}) });
}

/** The current URL search, loosened the same way `A` is: every route validates search by passthrough. */
export function useSearchParams(): Record<string, string | undefined> {
  return useSearch({ strict: false }) as Record<string, string | undefined>;
}
