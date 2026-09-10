import type { UiStatus } from '@agent-conductor/shared';
import { StatusGlyph } from './StatusGlyph';
import { cx } from '../lib/cx';

export function TicketChip({
  identifier,
  title,
  status,
  onClick,
  className,
}: {
  identifier: string;
  title?: string;
  status: UiStatus;
  onClick?: () => void;
  className?: string;
}): React.ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        'inline-flex max-w-full items-center gap-1.5 rounded-r4 border border-line-2 bg-bg-2 px-2 py-1 align-[-3px]',
        'transition-colors duration-(--dur-fast) ease-ac hover:bg-bg-3',
        className,
      )}
    >
      <StatusGlyph status={status} size="xs" />
      <span className="ac-mono text-micro text-text-soft">{identifier}</span>
      {title ? <span className="ac-truncate text-micro text-text-3">{title}</span> : null}
    </button>
  );
}

/** One entry in a single-select tag strip, e.g. the chat's project picker (`role="radio"`, expects a `role="radiogroup"` parent). */
export function ProjectTag({
  label,
  active,
  onClick,
  className,
  colorVar,
}: {
  label: string;
  active: boolean;
  onClick?: () => void;
  className?: string;
  colorVar?: string;
}): React.ReactElement {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      className={cx(
        'inline-flex max-w-full shrink-0 items-center gap-1.5 rounded-r4 border px-2 py-1 text-micro',
        'transition-colors duration-(--dur-fast) ease-ac',
        active ? 'border-accent-edge bg-accent-tint' : 'border-line-2 bg-bg-2 hover:bg-bg-3',
        colorVar ? undefined : active ? 'text-accent-link' : 'text-text-3',
        className,
      )}
    >
      <span className="ac-truncate max-w-32" {...(colorVar ? { style: { color: colorVar }, 'data-project-color': '' } : {})}>{label}</span>
    </button>
  );
}

export function WorkerChip({
  name,
  status,
  note,
  onClick,
  className,
  projectColorVar,
}: {
  name: string;
  status: UiStatus;
  note?: string;
  onClick?: () => void;
  className?: string;
  projectColorVar?: string;
}): React.ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        'inline-flex max-w-full items-center gap-1.5 rounded-r4 border border-line-2 bg-bg-2 px-2 py-1',
        'transition-colors duration-(--dur-fast) ease-ac hover:bg-bg-3',
        className,
      )}
    >
      <StatusGlyph status={status} size="xs" pulse={status === 'working'} />
      <span className={cx('text-micro', projectColorVar ? undefined : 'text-text-soft')} {...(projectColorVar ? { style: { color: projectColorVar }, 'data-project-color': '' } : {})}>{name}</span>
      {note ? <span className="ac-mono ac-truncate text-micro text-text-3">{note}</span> : null}
    </button>
  );
}
