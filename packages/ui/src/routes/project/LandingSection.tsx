/**
 * The project's merge queue: what is merging and what is waiting behind it, in order (VS-95). The
 * queue view itself is a page of its own; this says where the project stands and links to it.
 */
import { A } from '../../app/link';
import { useMergeQueue } from '../../api/hooks';
import { StatusGlyph } from '../../components/StatusGlyph';
import { SkeletonRows } from '../../components/Skeleton';
import { ErrorState } from '../../components/States';
import type { ProjectSectionProps } from './sections';

export function LandingSection({ project, ws }: ProjectSectionProps): React.ReactElement {
  const queue = useMergeQueue(project.id);
  const active = queue.data?.active ?? [];
  const waiting = queue.data?.waiting ?? [];

  if (queue.isLoading) return <SkeletonRows rows={2} />;
  if (queue.isError) {
    return (
      <ErrorState
        code="MERGE_QUEUE_QUERY_FAILED"
        message="Could not read this project's merge queue."
        onRetry={() => void queue.refetch()}
      />
    );
  }

  return (
    <div className="flex flex-col gap-2.5">
      {active.length === 0 && waiting.length === 0 ? (
        <p className="text-meta text-text-3">Nothing is merging or waiting to merge.</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {[...active, ...waiting].map((e) => (
            <li key={e.ticketId}>
              <A
                to="/w/$ws/tickets/$ticketId"
                params={{ ws, ticketId: e.identifier }}
                className="flex items-center gap-2 rounded-r4 px-1 py-1 hover:bg-bg-2"
              >
                <StatusGlyph status={e.position === null ? 'merging' : 'idle'} size="xs" pulse={e.position === null} />
                <span className="ac-mono flex-none text-nano text-text-3">{e.identifier}</span>
                <span className="min-w-0 flex-1 truncate text-meta text-text-1">{e.title}</span>
                <span className="ac-mono flex-none text-nano text-text-4">
                  {e.position === null ? 'merging' : `#${e.position}`}
                </span>
              </A>
            </li>
          ))}
        </ul>
      )}
      <A
        to="/w/$ws/merge-queue"
        params={{ ws }}
        search={{ project: project.id }}
        className="text-micro font-medium text-accent-link"
      >
        Open the merge queue
      </A>
    </div>
  );
}
