import type { Ref, ReactNode } from 'react';
import { cx } from '../lib/cx';

export function PageHeader({
  title,
  meta,
  actions,
  tabs,
  className,
}: {
  title: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  tabs?: ReactNode;
  className?: string;
}): React.ReactElement {
  return (
    <header className={cx('flex-none border-b border-line-1 bg-bg-0', className)}>
      <div className="flex min-h-11 flex-wrap items-center gap-2.5 px-4 py-2.5 md:px-5">
        <h1 className="text-head font-semibold tracking-head text-text-1 md:text-ui">{title}</h1>
        {meta ? (
          <>
            <span className="hidden h-3 w-px bg-line-2 md:block" />
            <span className="text-meta text-text-3">{meta}</span>
          </>
        ) : null}
        <div className="flex-1" />
        {actions}
      </div>
      {tabs}
    </header>
  );
}

export function Page({ children, className }: { children: ReactNode; className?: string }): React.ReactElement {
  return <div className={cx('flex h-full min-h-0 flex-col', className)}>{children}</div>;
}

/** `scrollRef` reaches the scrolling element itself, for a body that follows its own bottom. */
export function PageBody({
  children,
  className,
  scrollRef,
}: {
  children: ReactNode;
  className?: string;
  scrollRef?: Ref<HTMLDivElement>;
}): React.ReactElement {
  return (
    <div ref={scrollRef} className={cx('ac-scroll min-h-0 flex-1', className)}>
      {children}
    </div>
  );
}
