import type { UiStatus } from '@agent-conductor/shared';
import { StatusGlyph } from './StatusGlyph';
import { STATUS_LABEL, STATUS_TEXT } from '../lib/status';
import { cx } from '../lib/cx';

/**
 * One dispatch in the conductor chat: work the conductor filed in the turn above it. Unlike the
 * worker chip it stands for, it stays where it is once the work ends and reports how it ended
 * (spec `conductor-chat/dispatch-labels`).
 */
export function DispatchLabel({
  name,
  identifier,
  status,
  onClick,
  className,
  projectColorVar,
}: {
  /** The dispatched agent's name, or the ticket's title until a worker exists. */
  name: string;
  identifier: string;
  status: UiStatus;
  onClick?: () => void;
  className?: string;
  projectColorVar?: string;
}): React.ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`${identifier}: ${name} — ${STATUS_LABEL[status]}`}
      className={cx(
        'inline-flex max-w-full items-center gap-1.5 self-start rounded-r4 border border-line-2 bg-bg-2 px-2 py-1',
        'transition-colors duration-(--dur-fast) ease-ac hover:bg-bg-3',
        className,
      )}
    >
      <StatusGlyph status={status} size="xs" pulse={status === 'working'} />
      {projectColorVar ? <span className="size-1.5 rounded-full" style={{ background: projectColorVar }} data-project-color aria-hidden /> : null}
      <span className="ac-mono text-micro text-text-soft">{identifier}</span>
      <span className="ac-truncate text-micro text-text-3">{name}</span>
      <span className={cx('ac-mono text-micro', STATUS_TEXT[status])}>{STATUS_LABEL[status]}</span>
    </button>
  );
}
