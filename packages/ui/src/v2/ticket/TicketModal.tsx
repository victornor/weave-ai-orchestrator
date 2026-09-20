/**
 * A ticket opened over a chat (VS-623).
 *
 * Clicking a ticket reference in the weaver, planning or session chat should not navigate away from
 * the conversation. One shared handler — `useTicketLink`, provided by `TicketModalProvider` at the
 * workspace shell — opens this modal on a desktop viewport and falls back to navigating to the ticket
 * page on a phone. The modal is built only from the ticket page's own pieces: `Sheet` for the dialog,
 * `useTicket` for the detail, the ticket's `TicketActivityFeed` and `RunTranscript` for the live feed,
 * and `LiveActivityLine` for the live row. It carries a small **Open ticket** control that goes to the
 * full page, and it shows the existing not-found state for an unknown identifier.
 */
import { createContext, useCallback, useContext, useEffect, useId, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { ticketUiStatus, type Ticket } from '@weave-ai/shared';
import { workerPauseDetail } from '@weave-ai/render';
import { useGo } from '../../app/link';
import { useWs } from '../../api/context';
import { useWorkerActivity } from '../../api/workerActivity';
import { useTicket, useTicketRuns, useWorkers } from '../../api/hooks';
import { Button } from '../../components/Button';
import { ErrorState } from '../../components/States';
import { Sheet } from '../../components/Sheet';
import { SkeletonRows } from '../../components/Skeleton';
import { StatusGlyph } from '../../components/StatusGlyph';
import { LiveActivityLine, type LiveActivityLineModel } from '../../components/LiveActivityLine';
import { liveWorkersByTicket } from '../../lib/board';
import { lastLinesByAgent } from '../../lib/projectOverview';
import { activityLine, mergeWorkerActivity } from '../../lib/workerActivity';
import { TicketActivityFeed } from './TicketActivityFeed';

/** Whether a ticket reference opens the modal (desktop) or navigates (phone). */
export function prefersTicketModal(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(min-width: 768px)').matches
  );
}

const TicketLinkContext = createContext<((identifier: string) => void) | null>(null);

/**
 * The one click behaviour every chat uses. Inside the provider it opens the modal on a desktop
 * viewport, else navigates; without a provider (a test, or a stray surface) it always navigates to
 * the ticket page, so no caller can render a dead link.
 */
export function useTicketLink(): (identifier: string) => void {
  const ctx = useContext(TicketLinkContext);
  const go = useGo();
  const ws = useWs();
  const navigate = useCallback(
    (identifier: string): void => go('/w/$ws/tickets/$ticketId', { params: { ws, ticketId: identifier } }),
    [go, ws],
  );
  return ctx ?? navigate;
}

/**
 * Owns the open ticket and renders the modal once for every chat under it (mounted in `V2Workspace`).
 * Opening never unmounts the chat, so its scroll and draft survive.
 */
export function TicketModalProvider({ children }: { children: ReactNode }): React.ReactElement {
  const ws = useWs();
  const go = useGo();
  const [identifier, setIdentifier] = useState<string | null>(null);
  const open = useCallback(
    (id: string): void => {
      if (prefersTicketModal()) setIdentifier(id);
      else go('/w/$ws/tickets/$ticketId', { params: { ws, ticketId: id } });
    },
    [go, ws],
  );
  return (
    <TicketLinkContext.Provider value={open}>
      {children}
      <TicketModal identifier={identifier} onClose={() => setIdentifier(null)} />
    </TicketLinkContext.Provider>
  );
}

/** The ticket's live state line, the same inputs the ticket page header feeds `LiveActivityLine`. */
function useTicketLiveLine(ticket: Ticket | undefined): LiveActivityLineModel | null {
  const workers = useWorkers({});
  const activity = useWorkerActivity();
  const runs = useTicketRuns(ticket?.id ?? '');
  return useMemo(() => {
    if (!ticket) return null;
    const liveWorker = liveWorkersByTicket(workers.data ?? []).get(ticket.id);
    if (!liveWorker) return null;
    const summary = mergeWorkerActivity(liveWorker, activity);
    const runLine = lastLinesByAgent(runs.data ?? []).get(liveWorker.id) ?? null;
    return activityLine(summary, runLine) ?? { label: 'Starting the turn', since: null };
  }, [ticket, workers.data, activity, runs.data]);
}

export function TicketModal({ identifier, onClose }: { identifier: string | null; onClose: () => void }): React.ReactElement | null {
  const ws = useWs();
  const go = useGo();
  const headingId = useId();
  const detail = useTicket(identifier ?? '');
  const ticket = detail.data?.ticket;
  const liveLine = useTicketLiveLine(ticket);
  // A modal is only opened on a desktop viewport by the handler; a resize below the breakpoint
  // closes it rather than stranding a modal where the phone behaviour should be navigation.
  useEffect(() => {
    if (identifier === null) return;
    const close = (): void => onClose();
    window.addEventListener('resize', close);
    return () => window.removeEventListener('resize', close);
  }, [identifier, onClose]);

  if (identifier === null) return null;
  const pauseReason = detail.data?.worker ? workerPauseDetail(detail.data.worker)?.summary ?? null : null;

  return (
    <Sheet open onClose={onClose} labelledBy={headingId}>
      <div data-ticket-modal className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="ac-mono text-micro text-accent-link">{identifier}</span>
          {ticket ? (
            <>
              <span className="v2-tag text-text-3">{ticket.kind}</span>
              <StatusGlyph status={ticketUiStatus(ticket.status)} size="xs" pulse={ticket.status === 'in_progress'} />
            </>
          ) : null}
          <div className="flex-1" />
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              go('/w/$ws/tickets/$ticketId', { params: { ws, ticketId: identifier } });
              onClose();
            }}
          >
            Open ticket
          </Button>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-r4 px-2 py-1 text-text-3 hover:bg-bg-3 hover:text-text-1">
            ✕
          </button>
        </div>
        {detail.isLoading ? (
          <SkeletonRows rows={5} />
        ) : detail.isError || !detail.data || !ticket ? (
          <ErrorState code="TICKET_NOT_FOUND" message={`No ticket ${identifier} in this workspace.`} />
        ) : (
          <>
            <h2 id={headingId} className="text-head font-semibold tracking-head text-text-strong" data-ticket-modal-title>
              {ticket.title}
            </h2>
            <div className="flex flex-wrap items-center gap-2 text-micro text-text-3">
              <span>{detail.data.worker?.name ?? 'unassigned'}</span>
              {pauseReason ? <span className="ac-mono">paused · {pauseReason}</span> : null}
            </div>
            <LiveActivityLine line={liveLine} />
            <TicketActivityFeed ticket={ticket} workerName={detail.data.worker?.name ?? null} onTicket={(id) => go('/w/$ws/tickets/$ticketId', { params: { ws, ticketId: id } })} />
          </>
        )}
      </div>
    </Sheet>
  );
}
