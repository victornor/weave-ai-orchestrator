/**
 * The project's pull requests (VS-97), reserved by VS-95 and given content here.
 *
 * Everything shown is joined on the daemon — which ticket a pull request belongs to, which OpenSpec
 * change that ticket implements, where it stands in the merge queue — so this reads one endpoint and
 * derives nothing. Which pull request is open is `?pr=` on the overview's own address, mirrored into
 * state the way the board reads `?project=` and Settings reads `?section=`, so an opened pull request
 * can be linked to and returned to without a route of its own.
 *
 * Read-only by construction: there is nothing here that approves, merges, reviews or comments.
 */
import { useEffect, useState } from 'react';
import { A, useSearchParams } from '../../app/link';
import { usePullRequest, usePullRequests } from '../../api/hooks';
import { Badge, StatusGlyph } from '../../components/StatusGlyph';
import { Button } from '../../components/Button';
import { SkeletonRows } from '../../components/Skeleton';
import { Markdown } from '../../components/Markdown';
import { ago } from '../../lib/format';
import { cx } from '../../lib/cx';
import { UNAVAILABLE } from '../../lib/pullRequestUnavailable';
import { PullRequestDiff } from './PullRequestDiff';
import type * as T from '../../api/types';
import type { ProjectSectionProps } from './sections';


const CHECK_STATUS = { success: 'done', failure: 'failed', pending: 'working', none: 'idle' } as const;

export function PullRequestsSection({ project, ws }: ProjectSectionProps): React.ReactElement {
  const url = useSearchParams();
  const [open, setOpen] = useState<number | null>(() => numberOf(url['pr']));
  useEffect(() => { setOpen(numberOf(url['pr'])); }, [url['pr']]);

  const prs = usePullRequests(project.id);

  if (prs.isLoading) return <SkeletonRows rows={3} />;
  const data = prs.data;
  // A request that failed outright is the one case the endpoint cannot describe for itself.
  if (!data) return <p className="text-meta text-text-3">{UNAVAILABLE.unreachable}</p>;
  if (!data.available) {
    return (
      <div className="flex flex-col gap-1">
        <p className="text-meta leading-relaxed text-text-3">{data.reason ? UNAVAILABLE[data.reason] : UNAVAILABLE.unreachable}</p>
        {data.reason === 'unreachable' && data.message ? <p className="ac-mono text-nano text-text-4">{data.message}</p> : null}
      </div>
    );
  }

  if (open !== null) return <PullRequestDetail project={project} ws={ws} number={open} onBack={() => setOpen(null)} />;

  if (!data.open.length && !data.recent.length) {
    return <p className="text-meta text-text-3">No open pull requests, and none merged or closed in the last {data.windowDays} days.</p>;
  }

  return (
    <div className="flex flex-col gap-3.5">
      {data.open.length ? <Group label="Open" prs={data.open} ws={ws} projectId={project.id} onOpen={setOpen} /> : null}
      {data.recent.length ? (
        <Group label={`Merged and closed · last ${data.windowDays} days`} prs={data.recent} ws={ws} projectId={project.id} onOpen={setOpen} />
      ) : null}
      <Captured at={data.capturedAt} stale={data.stale} />
    </div>
  );
}

function Group({ label, prs, ws, projectId, onOpen }: { label: string; prs: T.ProjectPullRequest[]; ws: string; projectId: string; onOpen: (n: number) => void }): React.ReactElement {
  return (
    <div>
      <div className="ac-label mb-1.5 flex items-center gap-2">
        {label}
        <span className="ac-mono text-nano text-text-4">{prs.length}</span>
      </div>
      <ul className="flex flex-col gap-1">
        {prs.map((pr) => (
          <li key={pr.number}>
            <Row pr={pr} ws={ws} projectId={projectId} onOpen={onOpen} />
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * One entry. The whole row opens the pull request; the ticket and the change are links out of it, so
 * they are siblings of the opening control rather than nested inside it.
 */
function Row({ pr, ws, projectId, onOpen }: { pr: T.ProjectPullRequest; ws: string; projectId: string; onOpen: (n: number) => void }): React.ReactElement {
  return (
    <div className="flex flex-col gap-1 rounded-r4 px-1 py-1 hover:bg-bg-2">
      <div className="flex min-w-0 items-center gap-2">
        <StatusGlyph status={CHECK_STATUS[pr.checks]} size="xs" title={`checks ${pr.checks}`} />
        <button
          type="button"
          onClick={() => onOpen(pr.number)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
          aria-label={`Pull request #${pr.number}: ${pr.title}`}
        >
          <span className="ac-mono flex-none text-nano text-text-3">#{pr.number}</span>
          <span className="min-w-0 flex-1 truncate text-meta text-text-1">{pr.title}</span>
        </button>
        <StateBadge pr={pr} />
        <span className="ac-mono flex-none text-nano text-text-4">{ago(pr.updatedAt)}</span>
      </div>
      <div className="ac-mono flex flex-wrap items-center gap-x-2 gap-y-1 pl-5 text-nano text-text-3">
        {pr.author ? <span>{pr.author}</span> : null}
        <span className="max-w-[16rem] truncate" title={pr.headRefName}>{pr.headRefName}</span>
        {pr.ticket ? (
          <A to="/w/$ws/tickets/$ticketId" params={{ ws, ticketId: pr.ticket.identifier }} search={{ tab: 'activity' }} className="text-accent-link">
            {pr.ticket.identifier}
          </A>
        ) : null}
        {pr.changeName ? (
          <A
            to="/w/$ws/knowledge"
            params={{ ws }}
            search={{ project: projectId, tab: 'specs' }}
            className="truncate text-accent-link"
            title={pr.changeName}
          >
            {pr.changeName}
          </A>
        ) : null}
        {pr.reviewDecision ? <span className="text-text-4">{pr.reviewDecision.replace(/_/g, ' ')}</span> : null}
        {pr.queue ? (
          <Badge tone="accent">
            {pr.queue.state === 'landing' ? 'landing' : `queued${pr.queue.position === null ? '' : ` · ${pr.queue.position}`}`}
          </Badge>
        ) : null}
      </div>
    </div>
  );
}

function StateBadge({ pr }: { pr: T.ProjectPullRequest }): React.ReactElement {
  if (pr.isDraft) return <Badge>draft</Badge>;
  return <Badge tone={pr.state === 'merged' ? 'added' : pr.state === 'closed' ? 'removed' : 'accent'}>{pr.state}</Badge>;
}

/** One opened pull request: its description, what it changes, its checks, and the way back. */
function PullRequestDetail({
  project,
  ws,
  number,
  onBack,
}: { project: ProjectSectionProps['project']; ws: string; number: number; onBack: () => void }): React.ReactElement {
  const detail = usePullRequest(project.id, number);

  if (detail.isLoading) return <SkeletonRows rows={5} />;
  const data = detail.data;
  if (!data || !data.available) {
    return (
      <div className="flex flex-col gap-2">
        <BackTo onBack={onBack} />
        <p className="text-meta text-text-3">{data?.reason ? UNAVAILABLE[data.reason] : UNAVAILABLE.unreachable}</p>
      </div>
    );
  }
  const pr = data.pullRequest;
  if (!pr) {
    return (
      <div className="flex flex-col gap-2">
        <BackTo onBack={onBack} />
        <p className="text-meta text-text-3">The forge has no pull request #{number}.</p>
      </div>
    );
  }

  const totals = pr.files.reduce((acc, f) => ({ additions: acc.additions + f.additions, deletions: acc.deletions + f.deletions }), { additions: 0, deletions: 0 });

  return (
    <div className="flex min-w-0 flex-col gap-3.5">
      <div className="flex flex-wrap items-center gap-2">
        <BackTo onBack={onBack} />
        <span className="ac-mono text-nano text-text-3">#{pr.number}</span>
        <span className="min-w-0 flex-1 truncate text-ui text-text-strong">{pr.title}</span>
        <StateBadge pr={pr} />
      </div>

      <div className="ac-mono flex flex-wrap items-center gap-x-2 gap-y-1 text-nano text-text-3">
        {pr.author ? <span>{pr.author}</span> : null}
        <span className="truncate" title={`${pr.headRefName} → ${pr.baseRefName}`}>{pr.headRefName} → {pr.baseRefName}</span>
        {pr.ticket ? (
          <A to="/w/$ws/tickets/$ticketId" params={{ ws, ticketId: pr.ticket.identifier }} search={{ tab: 'activity' }} className="text-accent-link">
            {pr.ticket.identifier}
          </A>
        ) : null}
        {pr.ticket?.hasPlan ? (
          <A
            to="/w/$ws/tickets/$ticketId"
            params={{ ws, ticketId: pr.ticket.identifier }}
            search={{ tab: 'plan' }}
            className="text-accent-link"
          >
            plan
          </A>
        ) : null}
        {pr.changeName ? (
          <A to="/w/$ws/knowledge" params={{ ws }} search={{ project: project.id, tab: 'specs' }} className="truncate text-accent-link" title={pr.changeName}>
            {pr.changeName}
          </A>
        ) : null}
        <a href={pr.url} target="_blank" rel="noreferrer" className="text-accent-link">
          open on the forge
        </a>
      </div>

      {pr.body.trim() ? (
        <Markdown className="text-meta text-text-2" source={pr.body} />
      ) : (
        <p className="text-meta text-text-3">No description.</p>
      )}

      <div>
        <div className="ac-label mb-1.5 flex items-center gap-2">
          Files
          <span className="ac-mono text-nano text-text-4">{pr.files.length}</span>
          <span className="ac-mono text-nano text-done">+{totals.additions}</span>
          <span className="ac-mono text-nano text-failed">−{totals.deletions}</span>
        </div>
        <PullRequestDiff projectId={project.id} number={number} />
      </div>

      <div>
        <div className="ac-label mb-1.5">Checks</div>
        {pr.checkRuns.length ? (
          <ul className="flex flex-col gap-0.5">
            {pr.checkRuns.map((c) => (
              <li key={c.name} className="flex items-center gap-2 px-1">
                <StatusGlyph status={CHECK_STATUS[c.state]} size="xs" />
                <span className="ac-mono min-w-0 flex-1 truncate text-nano text-text-2">{c.name}</span>
                {c.url ? (
                  <a href={c.url} target="_blank" rel="noreferrer" className="ac-mono flex-none text-nano text-accent-link">
                    details
                  </a>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-meta text-text-3">No checks reported.</p>
        )}
      </div>
    </div>
  );
}

function BackTo({ onBack }: { onBack: () => void }): React.ReactElement {
  return (
    <Button variant="link" onClick={onBack}>
      ← pull requests
    </Button>
  );
}

/** When the daemon last read the forge, so a cached list is never silently wrong about its own age. */
function Captured({ at, stale }: { at: string; stale: boolean }): React.ReactElement {
  return (
    <p className={cx('ac-mono text-nano', stale ? 'text-stalled' : 'text-text-4')}>
      read from the forge {ago(at)}
      {stale ? ' · the forge could not be re-read' : ''}
    </p>
  );
}

function numberOf(v: string | undefined): number | null {
  if (!v) return null;
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}
