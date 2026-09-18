/**
 * The V2 project Roadmap page (`/w/:ws/p/:project/roadmap`, roadmap/roadmap-page): a project's
 * roadmap blocks in order — each with its pending tickets, and the tickets they became — then the
 * loose items, and an empty state that offers to ask the weaver about roadmaps. Read-only: the
 * weaver edits blocks and pending tickets through its tools (VS-478). Each pending ticket shows the
 * real ticket it became and that ticket's current status, and blocks collapse (collapsed by
 * default, remembered per block in this browser) so a large block never swamps the page (VS-548).
 */
import { useState } from 'react';
import { useParams } from '@tanstack/react-router';
import { projectLabel, type RoadmapBlock, type RoadmapItem, type Ticket } from '@weave-ai/shared';
import { V2Page } from '../V2Page';
import { A, useGo } from '../../app/link';
import { useWs } from '../../api/context';
import { useProjects, useRoadmap, useRoadmapBlocks, useTickets } from '../../api/hooks';
import { Markdown } from '../../components/Markdown';
import { SkeletonRows } from '../../components/Skeleton';
import { EmptyState } from '../../components/States';
import { seedDraft } from '../../lib/drafts';
import { resolveProject } from '../../lib/projectOverview';
import { statusText } from '../../lib/format';
import { cx } from '../../lib/cx';
import { readRoadmapExpanded, writeRoadmapExpanded } from '../prefs';

/** What the empty state's button puts in the composer, so the weaver can explain the feature. */
const ASK_PROMPT = 'Tell me how roadmap blocks save tokens, and how to use them on this project.';

const STATUS_TONE: Record<RoadmapItem['status'], string> = {
  idea: 'text-text-2',
  planned: 'text-accent-link',
  dropped: 'text-text-4 line-through',
};

/** How a linked ticket's status reads beside its identifier; tokens only (VS-548). */
const TICKET_STATUS_TONE: Record<Ticket['status'], string> = {
  backlog: 'text-text-2',
  todo: 'text-text-2',
  proposing: 'text-text-2',
  proposed: 'text-text-2',
  approved: 'text-text-2',
  in_progress: 'text-working',
  in_review: 'text-text-2',
  merging: 'text-merging',
  blocked: 'text-blocked',
  done: 'text-done',
  cancelled: 'text-text-4 line-through',
};

export function V2RoadmapScreen(): React.ReactElement {
  const ws = useWs();
  const go = useGo();
  const { project: param } = useParams({ strict: false }) as { project?: string };
  const projects = useProjects();
  const project = resolveProject(projects.data ?? [], param);
  const blocks = useRoadmapBlocks(project?.id);
  const items = useRoadmap(project?.id);
  // Terminal tickets are included so a `done` block still resolves its items' links and status;
  // scoping to the project keeps the page window on this project's recent tickets (VS-548).
  const tickets = useTickets({ project: project?.id, limit: 500, includeTerminal: true });

  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => readRoadmapExpanded());

  const toggleBlock = (blockId: string): void => {
    setExpanded((cur) => {
      const next = new Set(cur);
      if (next.has(blockId)) next.delete(blockId);
      else next.add(blockId);
      writeRoadmapExpanded(next);
      return next;
    });
  };

  const ticketOf = (ticketId: string | null): Ticket | null =>
    ticketId ? (tickets.data ?? []).find((t) => t.id === ticketId) ?? null : null;

  if (projects.isLoading) {
    return (
      <V2Page title="Roadmap">
        <div className="p-4 md:p-5"><SkeletonRows rows={6} /></div>
      </V2Page>
    );
  }

  if (!project) {
    return (
      <V2Page title="Roadmap" subtitle={param}>
        <div className="p-4 md:p-5">
          <EmptyState
            title="No such project in this workspace."
            detail={param ? <span className="ac-mono">{param}</span> : undefined}
            action={
              <button type="button" onClick={() => go(`/w/${ws}/work`)} className="rounded-r4 border border-line-2 px-3 py-1.5 text-micro text-text-2 hover:bg-bg-2">
                Open Work
              </button>
            }
          />
        </div>
      </V2Page>
    );
  }

  const loose = (items.data ?? []).filter((i) => i.blockId === null);
  const loading = blocks.isLoading || items.isLoading;
  const empty = (blocks.data ?? []).length === 0 && loose.length === 0;

  return (
    <V2Page
      title={`${projectLabel(project)} · Roadmap`}
      subtitle={project.slug}
      actions={
        <A to="/w/$ws/p/$project" params={{ ws, project: project.slug }} className="rounded-r4 border border-line-2 px-2 py-1 text-micro text-text-2 hover:bg-bg-2">
          Project
        </A>
      }
    >
      <div className="mx-auto flex max-w-[80rem] flex-col gap-4 p-4 md:p-5">
        {loading ? (
          <SkeletonRows rows={6} />
        ) : empty ? (
          <EmptyState
            title="No roadmap yet."
            detail="Ask the weaver about roadmaps."
            action={
              <button
                type="button"
                onClick={() => { seedDraft(ws, ASK_PROMPT); go(`/w/${ws}/chat`); }}
                className="rounded-r4 border border-line-2 px-3 py-1.5 text-micro text-text-2 hover:bg-bg-2"
              >
                Ask the weaver about roadmaps
              </button>
            }
          />
        ) : (
          <>
            {(blocks.data ?? []).map((block) => (
              <BlockCard
                key={block.id}
                block={block}
                expanded={expanded.has(block.id)}
                onToggle={() => toggleBlock(block.id)}
                ticketOf={ticketOf}
              />
            ))}
            {loose.length > 0 ? (
              <section className="v2-card flex flex-col gap-2 p-3.5">
                <h2 className="text-ui font-medium text-text-1">Loose items</h2>
                <ul className="flex flex-col gap-1.5">
                  {loose.map((item) => <LooseRow key={item.id} item={item} identifier={ticketOf(item.ticketId)?.identifier ?? null} />)}
                </ul>
              </section>
            ) : null}
          </>
        )}
      </div>
    </V2Page>
  );
}

const BLOCK_TONE: Record<RoadmapBlock['reportedStatus'], string> = {
  open: 'text-text-2',
  started: 'text-working',
  done: 'text-text-3',
  dropped: 'text-text-4',
};

function BlockCard({
  block,
  expanded,
  onToggle,
  ticketOf,
}: {
  block: RoadmapBlock;
  expanded: boolean;
  onToggle: () => void;
  ticketOf: (id: string | null) => Ticket | null;
}): React.ReactElement {
  const bodyId = `roadmap-block-${block.id}`;
  return (
    <section className="v2-card flex flex-col p-3.5">
      <div className="flex flex-wrap items-center gap-2.5">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          aria-controls={bodyId}
          className="flex min-w-0 flex-1 items-center gap-2 py-0.5 text-left"
        >
          <svg
            viewBox="0 0 8 8"
            aria-hidden
            className={cx('size-4 flex-none text-text-3 transition-transform', expanded && 'rotate-90')}
            fill="currentColor"
          >
            <path d="M2.5 1 6 4 2.5 7Z" />
          </svg>
          <h2 className="min-w-0 flex-1 truncate text-ui font-medium text-text-1">{block.title}</h2>
        </button>
        <span className={cx('v2-tag flex-none', BLOCK_TONE[block.reportedStatus])}>{block.reportedStatus}</span>
        <span className="ac-mono flex-none text-nano text-text-4">{block.items.length} {block.items.length === 1 ? 'item' : 'items'}</span>
      </div>
      {expanded ? (
        <div id={bodyId} className="v2-anim-fade flex flex-col gap-2.5 pt-2.5">
          {block.notes ? <Markdown className="text-micro text-text-2 v2-md-compact" source={block.notes} /> : null}
          {block.items.length === 0 ? (
            <p className="text-meta text-text-3">No pending tickets in this block yet.</p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {block.items.map((item) => <PendingRow key={item.id} item={item} ticket={ticketOf(item.ticketId)} />)}
            </ul>
          )}
        </div>
      ) : null}
    </section>
  );
}

/** A pending item's ticket state: its link and current status, or why there is none (VS-548). */
function TicketState({ item, ticket }: { item: RoadmapItem; ticket: Ticket | null }): React.ReactElement {
  if (item.ticketId === null) {
    return <span className="v2-tag flex-none text-text-4" title="No ticket filed yet">unfiled</span>;
  }
  if (!ticket) {
    return <span className="v2-tag flex-none text-text-4" title="A ticket is filed; it is outside the page's recent-ticket window">filed</span>;
  }
  return (
    <>
      <A to="/w/$ws/tickets/$ticketId" params={{ ws: item.workspaceId, ticketId: ticket.identifier }} className="ac-mono flex-none text-nano text-accent-link">
        {ticket.identifier}
      </A>
      <span className={cx('v2-tag flex-none', TICKET_STATUS_TONE[ticket.status])} title={`Ticket status: ${statusText(ticket.status)}`}>
        {statusText(ticket.status)}
      </span>
    </>
  );
}

function PendingRow({ item, ticket }: { item: RoadmapItem; ticket: Ticket | null }): React.ReactElement {
  return (
    <li className="flex flex-col gap-1 rounded-r4 border border-line-1 px-2.5 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="v2-tag flex-none text-text-2">{item.kind.toUpperCase()}</span>
        <span className="min-w-0 flex-1 truncate text-meta text-text-1">{item.title}</span>
        <span className="ac-mono flex-none text-nano text-text-3">{item.priority}</span>
        <TicketState item={item} ticket={ticket} />
      </div>
      {item.description ? <Markdown className="text-micro text-text-2 v2-md-compact" source={item.description} /> : null}
    </li>
  );
}

function LooseRow({ item, identifier }: { item: RoadmapItem; identifier: string | null }): React.ReactElement {
  return (
    <li className="flex flex-col gap-1 rounded-r4 border border-line-1 px-2.5 py-2">
      <div className="flex items-center gap-2">
        <span className={cx('v2-tag flex-none', STATUS_TONE[item.status])}>{item.status}</span>
        <span className="min-w-0 flex-1 truncate text-meta text-text-1">{item.title}</span>
        {identifier ? (
          <A to="/w/$ws/tickets/$ticketId" params={{ ws: item.workspaceId, ticketId: identifier }} className="ac-mono flex-none text-nano text-accent-link">
            {identifier}
          </A>
        ) : null}
      </div>
      {item.notes ? <Markdown className="text-micro text-text-2" source={item.notes} /> : null}
    </li>
  );
}
