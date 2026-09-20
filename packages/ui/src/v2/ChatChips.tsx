/**
 * The V2 chat's live ticket and worker chips (web-v2/chat).
 *
 * The conversation's own account of what the weaver is doing: under a reply that references tickets,
 * a strip of one chip per referenced ticket (`V2TicketStrip`, VS-634) built from `V2DispatchChip`;
 * below the conversation, a row of live workers no message accounts for (`V2WorkerChip`, V1's
 * `WorkerChip`). Both render in V2's one tag recipe (HANDOFF §3) rather than V1's bordered box — the
 * same `.v2-tag` the Work board and ticket header use — with the state word carrying the status hue,
 * exactly as V1's chips do.
 */
import { useState } from 'react';
import type { UiStatus } from '@weave-ai/shared';
import { StatusGlyph } from '../components/StatusGlyph';
import { STATUS_LABEL, STATUS_TEXT } from '../lib/status';
import { projectColorVar } from '../lib/projectColor';
import { cx } from '../lib/cx';
import type { Dispatch } from '../lib/dispatch';

/** Chips shown before a strip collapses the rest behind a "+N more" (VS-634). */
export const MAX_STRIP_CHIPS = 6;

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

/**
 * VS-634: the strip under a weaver message — one chip per ticket the message references, in the
 * order it first mentions them, each opening its ticket through the chat's shared link handler.
 * One wrapped row; at most `MAX_STRIP_CHIPS`, then a `+N more` chip that reveals the rest in place.
 * A message with no references renders nothing, so no empty strip reserves height.
 */
export function V2TicketStrip({
  references,
  projectIds,
  open,
}: {
  references: Dispatch[];
  projectIds: string[];
  /** The chat's one ticket link handler (modal on desktop, navigation on phone). */
  open: (identifier: string) => void;
}): React.ReactElement | null {
  const [expanded, setExpanded] = useState(false);
  if (references.length === 0) return null;
  const shown = expanded ? references : references.slice(0, MAX_STRIP_CHIPS);
  const hidden = references.length - shown.length;
  return (
    <div className="flex flex-wrap gap-1.5" data-v2-ticket-strip>
      {shown.map((reference) => (
        <V2DispatchChip
          key={reference.ticket.id}
          identifier={reference.ticket.identifier}
          name={reference.worker?.name ?? reference.ticket.title}
          status={reference.status}
          projectColorVar={reference.ticket.projectId ? projectColorVar(reference.ticket.projectId, projectIds) : undefined}
          onClick={() => open(reference.ticket.identifier)}
        />
      ))}
      {hidden > 0 ? (
        <button
          type="button"
          data-v2-ticket-strip-more
          aria-label={`Show ${hidden} more referenced tickets`}
          onClick={() => setExpanded(true)}
          className="v2-tag text-text-3 hover:text-text-2"
        >
          +{hidden} more
        </button>
      ) : null}
    </div>
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
