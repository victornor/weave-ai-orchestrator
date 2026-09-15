/**
 * The V2 project Roadmap page (`/w/:ws/p/:project/roadmap`, roadmap/roadmap-page): a project's
 * roadmap blocks in order — each with its pending tickets, and the tickets they became — then the
 * loose items, and an empty state that offers to ask the weaver about roadmaps. Read-only: the
 * weaver edits blocks and pending tickets through its tools (VS-478).
 */
import { useParams } from '@tanstack/react-router';
import { projectLabel, type RoadmapBlock, type RoadmapItem } from '@weave-ai/shared';
import { V2Page } from '../V2Page';
import { A, useGo } from '../../app/link';
import { useWs } from '../../api/context';
import { useProjects, useRoadmap, useRoadmapBlocks, useTickets } from '../../api/hooks';
import { Markdown } from '../../components/Markdown';
import { SkeletonRows } from '../../components/Skeleton';
import { EmptyState } from '../../components/States';
import { seedDraft } from '../../lib/drafts';
import { resolveProject } from '../../lib/projectOverview';
import { cx } from '../../lib/cx';

/** What the empty state's button puts in the composer, so the weaver can explain the feature. */
const ASK_PROMPT = 'Tell me how roadmap blocks save tokens, and how to use them on this project.';

const STATUS_TONE: Record<RoadmapItem['status'], string> = {
  idea: 'text-text-2',
  planned: 'text-accent-link',
  dropped: 'text-text-4 line-through',
};

export function V2RoadmapScreen(): React.ReactElement {
  const ws = useWs();
  const go = useGo();
  const { project: param } = useParams({ strict: false }) as { project?: string };
  const projects = useProjects();
  const project = resolveProject(projects.data ?? [], param);
  const blocks = useRoadmapBlocks(project?.id);
  const items = useRoadmap(project?.id);
  const tickets = useTickets({ limit: 300 });

  const identifierOf = (ticketId: string | null): string | null =>
    ticketId ? (tickets.data ?? []).find((t) => t.id === ticketId)?.identifier ?? null : null;

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
              <BlockCard key={block.id} block={block} identifierOf={identifierOf} />
            ))}
            {loose.length > 0 ? (
              <section className="v2-card flex flex-col gap-2 p-3.5">
                <h2 className="text-ui font-medium text-text-1">Loose items</h2>
                <ul className="flex flex-col gap-1.5">
                  {loose.map((item) => <LooseRow key={item.id} item={item} identifier={identifierOf(item.ticketId)} />)}
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

function BlockCard({ block, identifierOf }: { block: RoadmapBlock; identifierOf: (id: string | null) => string | null }): React.ReactElement {
  return (
    <section className="v2-card flex flex-col gap-2.5 p-3.5">
      <div className="flex flex-wrap items-center gap-2.5">
        <h2 className="min-w-0 flex-1 truncate text-ui font-medium text-text-1">{block.title}</h2>
        <span className={cx('v2-tag', BLOCK_TONE[block.reportedStatus])}>{block.reportedStatus}</span>
        <span className="ac-mono text-nano text-text-4">{block.items.length} pending</span>
      </div>
      {block.notes ? <Markdown className="text-micro text-text-2 v2-md-compact" source={block.notes} /> : null}
      {block.items.length === 0 ? (
        <p className="text-meta text-text-3">No pending tickets in this block yet.</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {block.items.map((item) => <PendingRow key={item.id} item={item} identifier={identifierOf(item.ticketId)} />)}
        </ul>
      )}
    </section>
  );
}

function PendingRow({ item, identifier }: { item: RoadmapItem; identifier: string | null }): React.ReactElement {
  return (
    <li className="flex flex-col gap-1 rounded-r4 border border-line-1 px-2.5 py-2">
      <div className="flex items-center gap-2">
        <span className="v2-tag flex-none text-text-2">{item.kind.toUpperCase()}</span>
        <span className="min-w-0 flex-1 truncate text-meta text-text-1">{item.title}</span>
        <span className="ac-mono flex-none text-nano text-text-3">{item.priority}</span>
        {identifier ? (
          <A to="/w/$ws/tickets/$ticketId" params={{ ws: item.workspaceId, ticketId: identifier }} className="ac-mono flex-none text-nano text-accent-link">
            {identifier}
          </A>
        ) : null}
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
