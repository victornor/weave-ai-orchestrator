/**
 * The V2 chat's live ticket and worker chips (web-v2/chat).
 *
 * The conversation's own account of what the weaver is doing: under a reply that references tickets,
 * a strip of one chip per referenced ticket (`V2TicketStrip`, VS-634) built from `V2DispatchChip`;
 * below the conversation, a row of live workers no message accounts for (`V2WorkerChip`, V1's
 * `WorkerChip`). Both render in V2's one tag recipe (HANDOFF §3) rather than V1's bordered box — the
 * same `.v2-tag` the Work board and ticket header use — with the state word carrying the status hue,
 * exactly as V1's chips do.
 *
 * VS-637: each chip carries its own expand control beside the status, separate from the chip body.
 * The body still opens the ticket through the chat's one link handler; the chevron toggles a bounded
 * inline panel that mounts the modal's own `TicketActivityFeed` under the chip row — lazily, only
 * while open, following new output through the chat's existing queries and stream. A panel collapses
 * when its ticket reaches a terminal state while open.
 */
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { TERMINAL_TICKET_STATUSES, type UiStatus } from '@weave-ai/shared';
import { StatusGlyph } from '../components/StatusGlyph';
import { STATUS_LABEL, STATUS_TEXT } from '../lib/status';
import { projectColorVar } from '../lib/projectColor';
import { cx } from '../lib/cx';
import { useStickToBottom } from '../lib/stickToBottom';
import { usePrefersReducedMotion } from '../lib/streamReveal';
import { useTicketComments, useTicketRuns } from '../api/hooks';
import { useExitPresence } from './motion';
import { TicketActivityFeed } from './ticket/TicketActivityFeed';
import type { Dispatch } from '../lib/dispatch';

/** Chips shown before a strip collapses the rest behind a "+N more" (VS-634). */
export const MAX_STRIP_CHIPS = 6;

/** How long an auto-collapsing panel is held for its exit animation. Reduced motion skips it. */
export const CHIP_PANEL_EXIT_MS = 180;

/** The expand control's clear label, naming the ticket and which action it offers (VS-637). */
export function chipExpandLabel(identifier: string, expanded: boolean): string {
  return expanded ? `Hide live status of ${identifier}` : `Show live status of ${identifier}`;
}

/** One dispatch: a worker's own name while it runs, the ticket's title before a worker exists. */
export function V2DispatchChip({
  identifier,
  name,
  status,
  onClick,
  projectColorVar,
  expanded,
  onToggle,
  panelId,
}: {
  identifier: string;
  name: string;
  status: UiStatus;
  onClick?: () => void;
  projectColorVar?: string;
  /** VS-637: when given, the chip grows a chevron that toggles the inline panel. */
  expanded?: boolean;
  onToggle?: () => void;
  /** The id of the panel this chip's chevron controls, for `aria-controls`. */
  panelId?: string;
}): React.ReactElement {
  const body = (
    <button
      type="button"
      onClick={onClick}
      aria-label={`${identifier}: ${name} — ${STATUS_LABEL[status]}`}
      data-v2-dispatch-chip
      className={onToggle ? 'flex min-w-0 items-center gap-1.5 text-text-3 hover:text-text-2' : 'v2-tag max-w-full text-text-3 hover:text-text-2'}
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
  if (!onToggle) return body;
  return (
    <span data-v2-ticket-chip className="v2-tag max-w-full text-text-3">
      {body}
      <button
        type="button"
        data-v2-chip-expand
        aria-expanded={expanded ?? false}
        {...(panelId ? { 'aria-controls': panelId } : {})}
        aria-label={chipExpandLabel(identifier, expanded ?? false)}
        onClick={onToggle}
        className="flex h-8 w-8 flex-none items-center justify-center rounded-r4 text-text-4 hover:bg-bg-3 hover:text-text-1"
      >
        <ChevronDown aria-hidden size={13} strokeWidth={2} className={cx('transition-transform duration-150', expanded && 'rotate-180')} />
      </button>
    </span>
  );
}

/**
 * VS-637: the inline panel behind a chip's chevron — the ticket's own live feed in a short bounded
 * scroller. It mounts the one `TicketActivityFeed` the ticket modal renders (no second renderer),
 * and follows new output in `contained` mode so its own scrolling can never move the chat. The
 * comment/run queries here are the ones `TicketActivityFeed` makes under the same keys — cache hits,
 * not a second request — used only for the follow's signal and readiness.
 */
function TicketChipPanel({
  reference,
  panelId,
  onOpen,
}: {
  reference: Dispatch;
  panelId: string;
  onOpen: (identifier: string) => void;
}): React.ReactElement {
  const ticket = reference.ticket;
  const comments = useTicketComments(ticket.id);
  const runs = useTicketRuns(ticket.id);
  const stick = useStickToBottom(
    [ticket.id, comments.data?.length ?? 0, runs.data?.length ?? 0],
    { contained: true, ready: !comments.isLoading && !runs.isLoading },
  );
  return (
    <div id={panelId} data-ticket-chip-feed className="min-w-0">
      <div
        ref={stick.scrollRef}
        data-ticket-chip-scroll
        className="ac-scroll v2-card max-h-[10lh] overflow-y-auto text-meta leading-relaxed"
      >
        <div className="p-3">
          <TicketActivityFeed ticket={ticket} workerName={reference.worker?.name ?? null} onTicket={onOpen} />
        </div>
        <div ref={stick.bottomRef} />
      </div>
    </div>
  );
}

/**
 * VS-634: the strip under a weaver message — one chip per ticket the message references, in the
 * order it first mentions them, each opening its ticket through the chat's shared link handler.
 * One wrapped row; at most `MAX_STRIP_CHIPS`, then a `+N more` chip that reveals the rest in place.
 * A message with no references renders nothing, so no empty strip reserves height.
 *
 * VS-637: each chip's chevron toggles an inline panel under the row. Open state is per chip in the
 * current view; several may be open at once. A panel whose ticket reaches a terminal state *while
 * open* collapses on its own — a ticket already finished when expanded stays open until closed.
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
  const [openIds, setOpenIds] = useState<string[]>([]);
  const reduced = usePrefersReducedMotion();
  const armed = useRef(new Set<string>());
  const panelIdBase = useId();

  const toggle = useCallback((reference: Dispatch): void => {
    const id = reference.ticket.id;
    setOpenIds((cur) => {
      if (cur.includes(id)) {
        armed.current.delete(id);
        return cur.filter((x) => x !== id);
      }
      if (!TERMINAL_TICKET_STATUSES.includes(reference.ticket.status)) armed.current.add(id);
      return [...cur, id];
    });
  }, []);

  const byId = useMemo(() => new Map(references.map((r) => [r.ticket.id, r] as const)), [references]);

  // A terminal transition while open is the one case that closes a panel without the reader asking.
  useEffect(() => {
    const closing = [...armed.current].filter((id) => {
      const ticket = byId.get(id)?.ticket;
      return ticket != null && TERMINAL_TICKET_STATUSES.includes(ticket.status);
    });
    if (closing.length === 0) return;
    for (const id of closing) armed.current.delete(id);
    setOpenIds((cur) => cur.filter((id) => !closing.includes(id)));
  }, [byId]);

  const presence = useExitPresence(openIds, (id) => id, reduced ? 0 : CHIP_PANEL_EXIT_MS);
  // Under reduced motion the closing transition is skipped outright, so the feed unmounts now.
  const visible = reduced ? presence.filter((p) => !p.exiting) : presence;

  if (references.length === 0) return null;
  const shown = expanded ? references : references.slice(0, MAX_STRIP_CHIPS);
  const hidden = references.length - shown.length;
  return (
    <div className="flex flex-col gap-2" data-v2-ticket-strip>
      <div className="flex flex-wrap gap-1.5">
        {shown.map((reference) => (
          <V2DispatchChip
            key={reference.ticket.id}
            identifier={reference.ticket.identifier}
            name={reference.worker?.name ?? reference.ticket.title}
            status={reference.status}
            projectColorVar={reference.ticket.projectId ? projectColorVar(reference.ticket.projectId, projectIds) : undefined}
            expanded={openIds.includes(reference.ticket.id)}
            onToggle={() => toggle(reference)}
            panelId={`${panelIdBase}-${reference.ticket.id}`}
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
      {visible.map((entry) => {
        const reference = byId.get(entry.item);
        if (!reference) return null;
        return (
          <div key={entry.item} data-v2-chip-panel={entry.item} className={cx('min-w-0', entry.exiting && 'v2-anim-exit')}>
            <TicketChipPanel reference={reference} panelId={`${panelIdBase}-${entry.item}`} onOpen={open} />
          </div>
        );
      })}
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