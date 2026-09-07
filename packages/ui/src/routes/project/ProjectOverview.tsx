/**
 * The project overview (VS-95): everything happening in one project, in one place.
 *
 * The page resolves the address against the project list the shell has already loaded — the daemon
 * accepts a slug or an id for the same project and so does this — and then owns nothing but the
 * header and the layout. Each section reads its own data, so a section can be given content without
 * the page changing.
 */
import { useParams } from '@tanstack/react-router';
import { Page, PageBody, PageHeader } from '../../components/Page';
import { Badge } from '../../components/StatusGlyph';
import { Button } from '../../components/Button';
import { SkeletonRows } from '../../components/Skeleton';
import { EmptyState } from '../../components/States';
import { Markdown } from '../../components/Markdown';
import { useKnowledgeDoc, useProjects, useWorkspaceSummary } from '../../api/hooks';
import { useWs } from '../../api/context';
import { A, useGo } from '../../app/link';
import { currentFocus, deliveryModeOf, resolveProject } from '../../lib/projectOverview';
import { PROJECT_SECTIONS, ProjectSection } from './sections';
import { cx } from '../../lib/cx';

export function ProjectOverviewRoute(): React.ReactElement {
  const ws = useWs();
  const go = useGo();
  const { project: param } = useParams({ strict: false }) as { project?: string };
  const projects = useProjects();
  const summary = useWorkspaceSummary();
  const project = resolveProject(projects.data ?? [], param);

  if (projects.isLoading) {
    return (
      <Page>
        <PageHeader title="Project" />
        <PageBody className="p-4 md:p-5">
          <SkeletonRows rows={6} />
        </PageBody>
      </Page>
    );
  }

  if (!project) {
    return (
      <Page>
        <PageHeader title="Project" />
        <PageBody className="p-4 md:p-5">
          <EmptyState
            title="No such project in this workspace."
            detail={param ? <span className="ac-mono">{param}</span> : undefined}
            action={
              <Button variant="secondary" onClick={() => go('/w/$ws/board', { params: { ws } })}>
                Open the board
              </Button>
            }
          />
        </PageBody>
      </Page>
    );
  }

  const delivery = deliveryModeOf(project, summary.data?.config);

  return (
    <Page>
      <PageHeader
        title={project.name}
        meta={<span className="ac-mono">{project.slug}</span>}
        actions={
          <div className="flex flex-wrap items-center gap-1.5">
            <HeaderLink to="/w/$ws/board" ws={ws} search={{ project: project.id }} label="Board" />
            <HeaderLink to="/w/$ws/merge-queue" ws={ws} search={{ project: project.id }} label="Merge queue" />
            <HeaderLink to="/w/$ws/knowledge" ws={ws} search={{ project: project.id, tab: 'knowledge' }} label="Knowledge" />
            <HeaderLink to="/w/$ws/knowledge" ws={ws} search={{ project: project.id, tab: 'specs' }} label="Specs" />
            <HeaderLink to="/w/$ws/chat" ws={ws} label="Chat" />
          </div>
        }
      />

      <PageBody className="p-4 md:p-5">
        <div className="mx-auto flex max-w-[80rem] flex-col gap-4">
          <section aria-label="About this project" className="ac-card flex flex-col gap-2.5 p-3.5">
            <div className="flex flex-wrap items-center gap-2.5">
              <span className="ac-mono truncate text-micro text-text-2">{project.gitUrl}</span>
              <Badge>{project.defaultBranch}</Badge>
              <Badge tone={delivery.inherited ? 'neutral' : 'accent'}>
                {delivery.mode}
                {delivery.inherited ? ' · inherited' : ''}
              </Badge>
              {project.status !== 'ready' ? <Badge tone="modified">{project.status}</Badge> : null}
            </div>
            <CurrentFocus projectId={project.id} />
          </section>

          {/* One flow: a phone reads it top to bottom, the desktop grid packs it into columns. */}
          <div className="grid grid-cols-1 gap-4 md:grid-flow-row-dense md:grid-cols-3">
            {PROJECT_SECTIONS.map(({ key, label, column, Body }) => (
              <ProjectSection key={key} id={key} label={label} className={cx(column === 'main' && 'md:col-span-2')}>
                <Body project={project} ws={ws} />
              </ProjectSection>
            ))}
          </div>
        </div>
      </PageBody>
    </Page>
  );
}

/**
 * The project's Current focus, from its knowledge file. Its own component so the query is only made
 * once a project has resolved — and so a file with no Current focus renders nothing at all.
 */
function CurrentFocus({ projectId }: { projectId: string }): React.ReactElement | null {
  const hub = useKnowledgeDoc('project', projectId);
  const focus = currentFocus(hub.data?.body);
  if (!focus) return null;
  return (
    <div>
      <div className="ac-label mb-1">Current focus</div>
      <Markdown className="text-meta text-text-2" source={focus} />
    </div>
  );
}

function HeaderLink({
  to,
  ws,
  search,
  label,
}: {
  to: string;
  ws: string;
  search?: Record<string, unknown>;
  label: string;
}): React.ReactElement {
  return (
    <A
      to={to}
      params={{ ws }}
      {...(search ? { search } : {})}
      className="rounded-r4 border border-line-2 px-2 py-1 text-micro text-text-2 hover:bg-bg-2"
    >
      {label}
    </A>
  );
}
