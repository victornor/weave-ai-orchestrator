import type { ReactNode } from 'react';
import { cx } from '../lib/cx';

export interface Column<T> {
  key: string;
  header: string;
  width?: string;
  align?: 'left' | 'right';
  mono?: boolean;
  render: (row: T) => ReactNode;
}

/** Dense scan-line table: the board's table view, devices, runs, revisions. */
export function Table<T>({
  columns,
  rows,
  rowKey,
  onRowClick,
  activeIndex,
  className,
  emptyLabel = 'Nothing here.',
}: {
  columns: ReadonlyArray<Column<T>>;
  rows: readonly T[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  activeIndex?: number;
  className?: string;
  emptyLabel?: string;
}): React.ReactElement {
  return (
    <div className={cx('w-full overflow-x-auto', className)}>
      <table className="w-full border-collapse">
        <thead>
          <tr className="bg-bg-1">
            {columns.map((c) => (
              <th
                key={c.key}
                scope="col"
                style={c.width ? { width: c.width } : undefined}
                className={cx('ac-label border-b border-line-1 px-3 py-2 text-left font-medium', c.align === 'right' && 'text-right')}
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="px-3 py-6 text-center text-meta text-text-3">
                {emptyLabel}
              </td>
            </tr>
          ) : (
            rows.map((r, i) => (
              <tr
                key={rowKey(r)}
                onClick={() => onRowClick?.(r)}
                aria-selected={i === activeIndex}
                className={cx(
                  'border-b border-line-1 transition-colors duration-(--dur-fast) ease-ac',
                  onRowClick && 'cursor-pointer hover:bg-bg-1',
                  i === activeIndex && 'bg-bg-2',
                )}
              >
                {columns.map((c) => (
                  <td key={c.key} className={cx('px-3 py-2 text-meta text-text-2', c.mono && 'ac-mono', c.align === 'right' && 'text-right')}>
                    {c.render(r)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

export function ListRow({
  children,
  onClick,
  active,
  className,
}: {
  children: ReactNode;
  onClick?: () => void;
  active?: boolean;
  className?: string;
}): React.ReactElement {
  return (
    <div
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={(e) => {
        if (onClick && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          onClick();
        }
      }}
      className={cx(
        'flex items-center gap-3 border-b border-line-1 px-4 py-2.5 transition-colors duration-(--dur-fast) ease-ac',
        onClick && 'cursor-pointer hover:bg-bg-1',
        active && 'bg-bg-2',
        className,
      )}
    >
      {children}
    </div>
  );
}
