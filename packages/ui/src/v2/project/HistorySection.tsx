/**
 * The V2 project overview's History section (web-v2/project-overview): the commit graph and branch
 * visualisation, restyled. The lane math is the shared pure `layoutGraph` (`lib/commitGraph`); this
 * file only turns its output into V2 rows. Read-only by construction.
 */
import { useEffect, useMemo, useState } from 'react';
import type { GraphRow } from '../../lib/commitGraph';
import { layoutGraph } from '../../lib/commitGraph';
import { useCommit, useProjectHistory, useWorkspaceSummary } from '../../api/hooks';
import { A, useSearchParams } from '../../app/link';
import { SkeletonRows } from '../../components/Skeleton';
import { ErrorState } from '../../components/States';
import { ago } from '../../lib/format';
import { cx } from '../../lib/cx';
import type * as T from '../../api/types';
import type { V2ProjectSectionProps } from './sections';

const LANE_W = 14;
const ROW_H = 30;
const PHONE_MAX_LANES = 3;

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => (typeof window !== 'undefined' ? window.matchMedia(query).matches : false));
  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = (): void => setMatches(mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}

const shortSha = (sha: string): string => sha.slice(0, 7);

/** A `PREFIX-123` this workspace's tickets are identified by, if the subject names one. */
function identifierIn(subject: string, ticketPrefix: string | undefined): string | null {
  if (!ticketPrefix) return null;
  const m = subject.match(new RegExp(`\\b(${ticketPrefix}-\\d+)\\b`, 'i'));
  return m ? m[1]!.toUpperCase() : null;
}

export function HistorySection({ project, ws }: V2ProjectSectionProps): React.ReactElement {
  const history = useProjectHistory(project.id);
  const summary = useWorkspaceSummary();
  const ticketPrefix = summary.data?.workspace?.ticketPrefix;
  const url = useSearchParams();
  const phone = useMediaQuery('(max-width: 767px)');

  const [selectedSha, setSelectedSha] = useState<string | null>(() => url['commit'] ?? null);
  const [selectedRef, setSelectedRef] = useState<string | null>(null);

  const refByName = useMemo(() => new Map((history.refs ?? []).map((r) => [r.name, r])), [history.refs]);
  const rows = useMemo(() => (history.commits ? layoutGraph(history.commits) : []), [history.commits]);
  const laneCount = rows[0]?.laneCount ?? 1;
  const displayLanes = phone ? Math.min(laneCount, PHONE_MAX_LANES) : laneCount;

  if (history.isLoading) return <SkeletonRows rows={6} />;
  if (history.isError) return <ErrorState code="HISTORY_FAILED" message="The commit graph could not be read." onRetry={history.refetch} />;
  if (!history.commits || history.commits.length === 0) return <p className="text-meta text-text-3">No commits yet on {project.defaultBranch}.</p>;

  const detail = selectedSha ? (
    <CommitDetail projectId={project.id} sha={selectedSha} onClose={() => setSelectedSha(null)} />
  ) : null;

  return (
    <div className="flex flex-col gap-3">
      {history.refs && history.refs.length > 0 ? (
        <RefBar refs={history.refs} selected={selectedRef} onSelect={setSelectedRef} />
      ) : null}

      <div className={cx('grid gap-3', !phone && 'md:grid-cols-[minmax(0,1fr)_20rem]')}>
        <ol className="flex flex-col overflow-x-auto" aria-label="Commit graph">
          {rows.map((row, i) => {
            const commit = history.commits![i]!;
            const refs = commit.refs.map((name) => refByName.get(name)).filter((r): r is T.ProjectRef => r !== undefined);
            const highlighted = selectedRef ? commit.refs.includes(selectedRef) : false;
            const ticketIdentifier = refs.find((r) => r.ticketIdentifier)?.ticketIdentifier ?? identifierIn(commit.subject, ticketPrefix);
            const isDefaultRow = refs.some((r) => r.isDefault);
            return (
              <li key={commit.sha}>
                <button
                  type="button"
                  onClick={() => setSelectedSha(commit.sha)}
                  aria-current={selectedSha === commit.sha}
                  className={cx(
                    'flex w-full items-center gap-2 rounded-r4 px-1.5 py-1 text-left hover:bg-bg-2',
                    selectedSha === commit.sha && 'bg-accent-tint',
                    highlighted && 'ring-1 ring-accent-edge',
                  )}
                >
                  <Lane row={row} laneCount={displayLanes} />
                  <span className="ac-mono shrink-0 text-nano text-text-4">{shortSha(commit.sha)}</span>
                  <span className="min-w-0 flex-1 truncate text-meta text-text-1">{commit.subject}</span>
                  {isDefaultRow ? <span className="v2-tag shrink-0 text-text-1">{project.defaultBranch}</span> : null}
                  {refs.filter((r) => !r.isDefault).map((r) => <span key={r.name} className="v2-tag shrink-0 text-text-3">{r.name}</span>)}
                  {ticketIdentifier ? <span className="ac-mono shrink-0 text-nano text-accent-link">{ticketIdentifier}</span> : null}
                  <span className="ac-mono shrink-0 text-nano text-text-4">{commit.author}</span>
                  <span className="ac-mono shrink-0 text-nano text-text-4">{ago(commit.authoredAt)}</span>
                </button>
              </li>
            );
          })}
        </ol>

        {!phone ? <div className="hidden md:block">{detail}</div> : null}
      </div>

      <div className="flex items-center gap-2">
        {history.isLoadingMore ? (
          <span className="text-micro text-text-3">Loading…</span>
        ) : history.hasMore ? (
          <button type="button" onClick={history.loadMore} className="rounded-r4 border border-line-2 px-3 py-1.5 text-micro text-text-2 hover:bg-bg-2 hover:text-text-1">
            Load more
          </button>
        ) : (
          <span className="text-micro text-text-4">That's every commit reachable from what is shown.</span>
        )}
      </div>

      {phone && selectedSha ? detail : null}

      {selectedRef ? <SelectedBranch branch={refByName.get(selectedRef)} ws={ws} onClear={() => setSelectedRef(null)} /> : null}
    </div>
  );
}

/** The lane column: a straight line for every lane still open across this row, plus this row's edges. */
function Lane({ row, laneCount }: { row: GraphRow; laneCount: number }): React.ReactElement {
  const w = Math.max(1, laneCount) * LANE_W;
  const cap = (l: number): number => Math.min(l, laneCount - 1);
  const cx_ = (l: number): number => cap(l) * LANE_W + LANE_W / 2;
  const cy = ROW_H / 2;
  return (
    <svg width={w} height={ROW_H} className="shrink-0" aria-hidden>
      {row.lanesAfter.map((l) => (
        <line key={`through-${l}`} x1={cx_(l)} y1={cy} x2={cx_(l)} y2={ROW_H} className="stroke-line-2" strokeWidth={1.5} />
      ))}
      {row.edges.map((e, i) => (
        <line key={i} x1={cx_(e.fromLane)} y1={0} x2={cx_(e.toLane)} y2={cy} className="stroke-line-2" strokeWidth={1.5} />
      ))}
      <circle cx={cx_(row.lane)} cy={cy} r={3.5} className="fill-accent-link" />
    </svg>
  );
}

function RefBar({ refs, selected, onSelect }: { refs: T.ProjectRef[]; selected: string | null; onSelect: (name: string | null) => void }): React.ReactElement {
  return (
    <div className="flex flex-wrap gap-1.5" role="list" aria-label="Branches">
      {refs.map((r) => (
        <button
          key={r.name}
          type="button"
          onClick={() => onSelect(selected === r.name ? null : r.name)}
          className={cx(
            'ac-mono rounded-r4 border px-1.5 py-0.5 text-nano',
            selected === r.name ? 'border-accent-edge bg-accent-tint text-accent-link' : 'border-line-2 text-text-3 hover:bg-bg-2',
          )}
        >
          {r.isDefault ? <span className="font-medium">{r.name}</span> : r.name}
        </button>
      ))}
    </div>
  );
}

function SelectedBranch({ branch: r, ws, onClear }: { branch: T.ProjectRef | undefined; ws: string; onClear: () => void }): React.ReactElement | null {
  if (!r) return null;
  return (
    <div className="v2-card flex items-center gap-2 p-2.5 text-meta">
      <span className="ac-mono text-text-2">{r.name}</span>
      {r.ticketIdentifier ? (
        <A to="/v2/w/$ws/tickets/$ticketId" params={{ ws, ticketId: r.ticketIdentifier }} className="text-accent-link">
          {r.ticketIdentifier}
        </A>
      ) : (
        <span className="text-text-3">belongs to no ticket</span>
      )}
      {r.agentId && r.agentName ? (
        <A to="/v2/w/$ws/workers/$workerId" params={{ ws, workerId: r.agentId }} className="text-accent-link">
          {r.agentName}
        </A>
      ) : null}
      <button type="button" onClick={onClear} className="ml-auto rounded-r4 border border-line-2 px-2 py-1 text-micro text-text-2 hover:bg-bg-2">
        Clear
      </button>
    </div>
  );
}

function CommitDetail({ projectId, sha, onClose }: { projectId: string; sha: string; onClose: () => void }): React.ReactElement {
  const commit = useCommit(projectId, sha);
  if (commit.isLoading) return <SkeletonRows rows={4} />;
  if (commit.isError || !commit.data) return <ErrorState code="COMMIT_FAILED" message="This commit could not be read." onRetry={() => void commit.refetch()} />;
  const d = commit.data;
  return (
    <div className="v2-card flex flex-col gap-2.5 p-3">
      <div className="flex items-start justify-between gap-2">
        <span className="ac-mono text-nano text-text-4">{shortSha(d.sha)}</span>
        <button type="button" onClick={onClose} className="rounded-r4 border border-line-2 px-2 py-1 text-micro text-text-2 hover:bg-bg-2">Close</button>
      </div>
      <pre className="whitespace-pre-wrap text-meta text-text-1">{d.message}</pre>
      <div className="ac-label">
        {d.author} · {ago(d.authoredAt)}
      </div>
      {d.forgeUrl ? (
        <a href={d.forgeUrl} target="_blank" rel="noreferrer" className="v2-link text-micro">View on the forge</a>
      ) : null}
      <div className="flex flex-col gap-1">
        {d.files.map((f) => (
          <div key={f.path} className="flex items-center gap-2 text-micro">
            <span className="ac-mono min-w-0 flex-1 truncate text-text-2">{f.path}</span>
            <span className="ac-mono shrink-0 text-done">+{f.additions}</span>
            <span className="ac-mono shrink-0 text-failed">-{f.deletions}</span>
          </div>
        ))}
        {d.truncatedFiles > 0 ? <span className="text-nano text-text-4">and {d.truncatedFiles} more file(s)</span> : null}
      </div>
    </div>
  );
}
