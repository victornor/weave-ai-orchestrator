/**
 * What reached the repository in the last fortnight (VS-95), read off the project's changelog: a
 * `landed` entry per ticket, carrying the pull request the same ticket's `pr_opened` entry recorded.
 */
import { useMemo } from 'react';
import { A } from '../../app/link';
import { useChangelogRecent } from '../../api/hooks';
import { StatusGlyph } from '../../components/StatusGlyph';
import { SkeletonRows } from '../../components/Skeleton';
import { ago } from '../../lib/format';
import { LANDING_WINDOW_DAYS, recentLandings } from '../../lib/projectOverview';
import type { ProjectSectionProps } from './sections';

export function LandingsSection({ project, ws }: ProjectSectionProps): React.ReactElement {
  const recent = useChangelogRecent(project.id);
  const landings = useMemo(() => recentLandings(recent.data?.entries ?? []), [recent.data]);

  if (recent.isLoading) return <SkeletonRows rows={3} />;
  if (!landings.length) {
    return <p className="text-meta text-text-3">Nothing landed in the last {LANDING_WINDOW_DAYS} days.</p>;
  }

  return (
    <ul className="flex flex-col gap-1">
      {landings.map((l) => (
        <li key={`${l.ticketId ?? l.identifier}-${l.at}`} className="flex items-center gap-2 px-1 py-1">
          <StatusGlyph status="done" size="xs" />
          {l.identifier ? (
            <A
              to="/w/$ws/tickets/$ticketId"
              params={{ ws, ticketId: l.identifier }}
              className="ac-mono flex-none text-nano text-accent-link"
            >
              {l.identifier}
            </A>
          ) : null}
          <span className="min-w-0 flex-1 truncate text-meta text-text-1">{l.summary}</span>
          {l.prUrl ? (
            <a
              href={l.prUrl}
              target="_blank"
              rel="noreferrer"
              className="ac-mono flex-none text-nano text-accent-link"
              aria-label={`Pull request for ${l.identifier ?? 'this landing'}`}
            >
              PR
            </a>
          ) : null}
          <span className="ac-mono flex-none text-nano text-text-4">{ago(l.at)}</span>
        </li>
      ))}
    </ul>
  );
}
