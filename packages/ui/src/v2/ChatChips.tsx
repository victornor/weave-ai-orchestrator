/**
 * The V2 chat's live ticket and worker chips (web-v2/chat).
 *
 * The conversation's own account of what the weaver is doing: under a reply, one chip per dispatch
 * that turn filed (`V2DispatchChip`, V1's `DispatchLabel`); below the conversation, a row of live
 * workers no message accounts for (`V2WorkerChip`, V1's `WorkerChip`). Both render in V2's one tag
 * recipe (HANDOFF §3) rather than V1's bordered box — the same `.v2-tag` the Work board and ticket
 * header use — with the state word carrying the status hue, exactly as V1's chips do.
 */
import type { UiStatus } from '@weave-ai/shared';
import { StatusGlyph } from '../components/StatusGlyph';
import { STATUS_LABEL, STATUS_TEXT } from '../lib/status';
import { cx } from '../lib/cx';

/** One dispatch: a worker's own name while it runs, the ticket's title before a worker exists. */
export function V2DispatchChip({
  identifier,
  name,
  status,
  onClick,
  projectColorVar,
}: {
  identifier: string;
  name: string;
  status: UiStatus;
  onClick?: () => void;
  projectColorVar?: string;
}): React.ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`${identifier}: ${name} — ${STATUS_LABEL[status]}`}
      data-v2-dispatch-chip
      className="v2-tag max-w-full text-text-3 hover:text-text-2"
    >
      <StatusGlyph status={status} size="xs" pulse={status === 'working'} />
      <span
        className={cx('ac-mono', projectColorVar ? undefined : 'text-text-2')}
        {...(projectColorVar ? { style: { color: projectColorVar }, 'data-project-color': '' } : {})}
      >
        {identifier}
      </span>
      <span className="truncate">{name}</span>
      <span className={cx('ac-mono flex-none', STATUS_TEXT[status])}>{STATUS_LABEL[status]}</span>
    </button>
  );
}

/** One live worker with no message in the thread to account for it. */
export function V2WorkerChip({
  name,
  status,
  onClick,
  projectColorVar,
}: {
  name: string;
  status: UiStatus;
  onClick?: () => void;
  projectColorVar?: string;
}): React.ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      data-v2-worker-chip
      className="v2-tag max-w-full text-text-3 hover:text-text-2"
    >
      <StatusGlyph status={status} size="xs" pulse={status === 'working'} />
      <span
        className={cx('truncate', projectColorVar ? undefined : 'text-text-2')}
        {...(projectColorVar ? { style: { color: projectColorVar }, 'data-project-color': '' } : {})}
      >
        {name}
      </span>
    </button>
  );
}
