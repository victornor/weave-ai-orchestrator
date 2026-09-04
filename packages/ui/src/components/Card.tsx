import type { ReactNode } from 'react';
import { cx } from '../lib/cx';

export function Card({ className, children, as: As = 'div', ...rest }: { className?: string; children: ReactNode; as?: 'div' | 'article' | 'section' } & Record<string, unknown>): React.ReactElement {
  return (
    <As className={cx('ac-card', className)} {...rest}>
      {children}
    </As>
  );
}

export function CardHeader({ className, children }: { className?: string; children: ReactNode }): React.ReactElement {
  return <div className={cx('flex items-center gap-2 border-b border-line-1 px-3.5 py-2.5', className)}>{children}</div>;
}

export function CardBody({ className, children }: { className?: string; children: ReactNode }): React.ReactElement {
  return <div className={cx('p-3.5', className)}>{children}</div>;
}

export function Panel({ className, children }: { className?: string; children: ReactNode }): React.ReactElement {
  return <div className={cx('ac-panel', className)}>{children}</div>;
}

export function SectionLabel({ children }: { children: ReactNode }): React.ReactElement {
  return <div className="ac-label mb-3">{children}</div>;
}

export function Divider(): React.ReactElement {
  return <div className="h-px w-full bg-line-1" />;
}
