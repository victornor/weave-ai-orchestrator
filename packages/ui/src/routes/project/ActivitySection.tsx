/**
 * The project's changelog (VS-95): the same heatmap and the same newest-first record the Knowledge
 * area's Changelog view shows, narrowed to this project. The full timeline stays where it is.
 */
import { A } from '../../app/link';
import { useChangelogHeatmap, useChangelogRecent } from '../../api/hooks';
import { ActivityHeatmap } from '../../components/Heatmap';
import { Badge } from '../../components/StatusGlyph';
import { SkeletonRows } from '../../components/Skeleton';
import { ago } from '../../lib/format';
import { KIND_LABEL, KIND_TONE } from '../Changelog';
import type { ProjectSectionProps } from './sections';

/** How many entries the overview shows before sending the reader to the full timeline. */
const SHOWN = 12;

export function ActivitySection({ project, ws }: ProjectSectionProps): React.ReactElement {
  const heat = useChangelogHeatmap(project.id);
  const recent = useChangelogRecent(project.id);
  const entries = (recent.data?.entries ?? []).slice(0, SHOWN);

  return (
    <div className="flex flex-col gap-3.5">
      {heat.data ? (
        <div className="overflow-x-auto">
          <ActivityHeatmap heatmap={heat.data} />
        </div>
      ) : heat.isLoading ? (
        <SkeletonRows rows={1} />
      ) : null}

      {recent.isLoading ? (
        <SkeletonRows rows={4} />
      ) : entries.length === 0 ? (
        <p className="text-meta text-text-3">Nothing has happened in this project yet.</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {entries.map((e) => (
            <li key={e.id} className="flex items-center gap-2 px-1 py-1">
              <Badge tone={KIND_TONE[e.kind]}>{KIND_LABEL[e.kind]}</Badge>
              {e.ticketIdentifier ? (
                <A
                  to="/w/$ws/tickets/$ticketId"
                  params={{ ws, ticketId: e.ticketIdentifier }}
                  className="ac-mono flex-none text-nano text-accent-link"
                >
                  {e.ticketIdentifier}
                </A>
              ) : null}
              <span className="min-w-0 flex-1 truncate text-meta text-text-2">{e.summary}</span>
              <span className="ac-mono flex-none text-nano text-text-4">{ago(e.at)}</span>
            </li>
          ))}
        </ul>
      )}

      <A
        to="/w/$ws/knowledge"
        params={{ ws }}
        search={{ project: project.id, tab: 'changelog' }}
        className="text-micro font-medium text-accent-link"
      >
        Open the full changelog
      </A>
    </div>
  );
}
