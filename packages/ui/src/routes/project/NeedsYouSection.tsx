/** The project's open human decisions, found through the ticket each one is about (VS-95). */
import { useMemo } from 'react';
import { useDecisions, useTickets } from '../../api/hooks';
import { A } from '../../app/link';
import { StatusGlyph } from '../../components/StatusGlyph';
import { SkeletonRows } from '../../components/Skeleton';
import { ago } from '../../lib/format';
import { decisionsForProject } from '../../lib/projectOverview';
import type { ProjectSectionProps } from './sections';

export function NeedsYouSection({ project, ws }: ProjectSectionProps): React.ReactElement {
  const decisions = useDecisions({ status: 'open', owner: 'human' });
  const tickets = useTickets({ limit: 300 });
  const mine = useMemo(
    () => decisionsForProject(decisions.data ?? [], tickets.data ?? [], project.id),
    [decisions.data, tickets.data, project.id],
  );
  const byId = useMemo(() => new Map((tickets.data ?? []).map((t) => [t.id, t])), [tickets.data]);

  if (decisions.isLoading || tickets.isLoading) return <SkeletonRows rows={2} />;
  if (!mine.length) return <p className="text-meta text-text-3">Nothing is waiting for you in this project.</p>;

  return (
    <ul className="flex flex-col gap-2">
      {mine.map((d) => {
        const t = d.ticketId ? byId.get(d.ticketId) : undefined;
        return (
          <li key={d.id}>
            <A
              to="/w/$ws/tickets/$ticketId"
              params={{ ws, ticketId: t?.identifier ?? d.ticketId ?? '' }}
              className="flex items-start gap-2.5 rounded-r4 px-1 py-1 hover:bg-bg-2"
            >
              <StatusGlyph status="needs-you" size="xs" className="mt-1" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-meta text-text-1">{d.title}</span>
                <span className="ac-mono text-nano text-text-3">
                  {t?.identifier ?? '—'} · {d.kind.replace(/_/g, ' ')}
                </span>
              </span>
              <span className="ac-mono flex-none text-nano text-text-4">{ago(d.createdAt)}</span>
            </A>
          </li>
        );
      })}
    </ul>
  );
}
