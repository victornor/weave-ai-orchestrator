/**
 * The project overview page (VS-95): the address it resolves, the header, and every section that
 * has data. The History and Pull requests sections have their own suites (`historySection.test.tsx`,
 * `pullRequests.test.tsx`); here they only have to be present, named and rendering.
 */
import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Agent, Decision, Project, Run, Ticket } from '@weave-ai/shared';
import type { ChangelogEntry, ChangelogHeatmap, KnowledgeDoc, KnowledgeDocSummary, KnowledgeHealth, MergeQueue, ProjectPullRequests } from '../api/types';
import { agent, decision, project as projectOf, run, ticket } from './factories';

const state = vi.hoisted(() => ({
  param: 'api' as string | undefined,
  projects: [] as Project[],
  projectsLoading: false,
  tickets: [] as Ticket[],
  workers: [] as Agent[],
  runs: [] as Run[],
  decisions: [] as Decision[],
  config: {} as Record<string, unknown>,
  queue: null as MergeQueue | null,
  entries: [] as ChangelogEntry[],
  heatmap: null as ChangelogHeatmap | null,
  hub: null as KnowledgeDoc | null,
  docs: [] as KnowledgeDocSummary[],
  health: null as KnowledgeHealth | null,
  pullRequests: null as ProjectPullRequests | null,
  history: null as { refs: unknown[]; commits: unknown[] } | null,
  go: vi.fn() as ReturnType<typeof vi.fn>,
  sync: null as { syncState: string; behindBy: number | null } | null,
  fetchMutate: vi.fn() as ReturnType<typeof vi.fn>,
  fetchPending: false,
}));

vi.mock('@tanstack/react-router', () => ({
  useParams: () => ({ project: state.param }),
  Link: ({ children, to, params, search, ...rest }: Record<string, unknown> & { children?: React.ReactNode }) => (
    <a
      href={String(to)}
      data-to={String(to)}
      data-params={JSON.stringify(params ?? {})}
      data-search={JSON.stringify(search ?? {})}
      {...(rest as Record<string, unknown>)}
    >
      {children}
    </a>
  ),
}));
vi.mock('../api/context', () => ({ useWs: () => 'ws1', useHookWs: (o?: string) => o ?? 'ws1' }));
vi.mock('../app/link', async () => {
  const router = await import('@tanstack/react-router');
  return { A: (router as unknown as { Link: unknown }).Link, useGo: () => state.go, useSearchParams: () => ({}) };
});
vi.mock('../api/hooks', () => ({
  useProjects: () => ({ data: state.projects, isLoading: state.projectsLoading }),
  useWorkspaceSummary: () => ({ data: { config: state.config } }),
  useTickets: () => ({ data: state.tickets, isLoading: false }),
  useWorkers: () => ({ data: state.workers }),
  useRuns: () => ({ data: state.runs }),
  useDecisions: () => ({ data: state.decisions, isLoading: false }),
  useMergeQueue: () => ({ data: state.queue, isLoading: false, isError: false, refetch: vi.fn() }),
  useChangelogRecent: () => ({ data: { entries: state.entries, nextCursor: null }, isLoading: false }),
  useChangelogHeatmap: () => ({ data: state.heatmap, isLoading: false }),
  useKnowledgeDoc: () => ({ data: state.hub, isLoading: false }),
  useKnowledgeDocs: () => ({ data: state.docs, isLoading: false }),
  useKnowledgeHealth: () => ({ data: state.health, isLoading: false }),
  usePullRequests: () => ({ data: state.pullRequests, isLoading: false }),
  usePullRequest: () => ({ data: null, isLoading: false }),
  useProjectHistory: () => ({
    refs: state.history?.refs ?? [], commits: state.history?.commits ?? [],
    isLoading: false, isError: false, refetch: vi.fn(), hasMore: false, isLoadingMore: false, loadMore: vi.fn(),
  }),
  useCommit: () => ({ data: null, isLoading: false, isError: false, refetch: vi.fn() }),
  useProjectSync: () => ({ data: state.sync }),
  useProjectFetch: () => ({ mutate: state.fetchMutate, isPending: state.fetchPending }),
}));

const { ProjectOverviewRoute } = await import('../routes/project/ProjectOverview');
const { PROJECT_SECTIONS, ProjectSection } = await import('../routes/project/sections');

const NOW = new Date('2026-09-10T12:00:00.000Z');
const daysAgo = (n: number): string => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000).toISOString();

const api = projectOf({ id: 'p1', slug: 'api', name: 'API', gitUrl: 'git@example.com:acme/api.git', defaultBranch: 'trunk' });
const web = projectOf({ id: 'p2', slug: 'web', name: 'Web' });

const entry = (over: Partial<ChangelogEntry> & Pick<ChangelogEntry, 'kind' | 'at'>): ChangelogEntry => ({
  id: `c${Math.random()}`,
  actor: { kind: 'agent', id: 'a1', label: 'Engineer' },
  projectId: 'p1',
  ticketId: 'tk_1',
  ticketIdentifier: 'ACME-1',
  summary: 'a thing happened',
  link: null,
  ...over,
});

/** The header card, which names the project rather than one of its sections. */
const about = (): HTMLElement => screen.getByRole('region', { name: 'About this project' });

/** The card a section heading heads, so a row is looked for in the right one. */
const section = (label: string): HTMLElement => {
  const found = screen.getByRole('heading', { name: label }).closest('section');
  if (!found) throw new Error(`no section for ${label}`);
  return found;
};

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(NOW);
  state.param = 'api';
  state.projects = [api, web];
  state.projectsLoading = false;
  state.tickets = [];
  state.workers = [];
  state.runs = [];
  state.decisions = [];
  state.config = { defaults: { deliveryMode: 'pr' } };
  state.queue = { projectId: 'p1', concurrency: 1, active: [], waiting: [], recent: [] };
  state.entries = [];
  state.heatmap = null;
  state.hub = null;
  state.docs = [];
  state.health = null;
  state.pullRequests = null;
  state.go = vi.fn();
  state.sync = null;
  state.fetchMutate = vi.fn();
  state.fetchPending = false;
});

describe('the address', () => {
  it('opens the project its slug names', () => {
    render(<ProjectOverviewRoute />);
    expect(screen.getByRole('heading', { name: 'API', level: 1 })).toBeTruthy();
  });

  it('opens the same project from its id, the way GET /projects/:id does', () => {
    state.param = 'p1';
    render(<ProjectOverviewRoute />);
    expect(screen.getByRole('heading', { name: 'API', level: 1 })).toBeTruthy();
  });

  it('titles a project with no display name by its slug (VS-330)', () => {
    state.projects = [projectOf({ id: 'p1', slug: 'api', name: '' }), web];
    render(<ProjectOverviewRoute />);
    expect(screen.getByRole('heading', { name: 'api', level: 1 })).toBeTruthy();
  });

  it('says a project it does not have was not found, without an error state', () => {
    state.param = 'ops';
    render(<ProjectOverviewRoute />);
    expect(screen.getByText('No such project in this workspace.')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('the header', () => {
  it('states the repository, the default branch and the delivery mode', () => {
    render(<ProjectOverviewRoute />);
    expect(within(about()).getByText('git@example.com:acme/api.git')).toBeTruthy();
    expect(within(about()).getByText('trunk')).toBeTruthy();
    expect(within(about()).getByText(/^pr · inherited$/)).toBeTruthy();
  });

  it('marks a delivery mode the project sets itself as its own', () => {
    state.projects = [projectOf({ id: 'p1', slug: 'api', name: 'API', policies: { deliveryMode: 'direct' } }), web];
    render(<ProjectOverviewRoute />);
    expect(screen.getByText('direct')).toBeTruthy();
    expect(screen.queryByText(/inherited/)).toBeNull();
  });

  it('shows the Current focus the knowledge file states', () => {
    state.hub = { path: 'p', scope: 'project', body: '## Current focus\n\n- Throughput.\n', tokenEstimate: 10, budgetTokens: 100, lastCuratedAt: null, curationPending: false };
    render(<ProjectOverviewRoute />);
    expect(within(about()).getByText('Current focus')).toBeTruthy();
    expect(within(about()).getByText(/Throughput\./)).toBeTruthy();
  });

  it('omits Current focus entirely when the file has none, rather than standing something in', () => {
    state.hub = { path: 'p', scope: 'project', body: '## Overview\n\n- A thing.\n', tokenEstimate: 10, budgetTokens: 100, lastCuratedAt: null, curationPending: false };
    render(<ProjectOverviewRoute />);
    expect(within(about()).queryByText('Current focus')).toBeNull();
  });

  it('keeps the project"s other views one click away, each scoped to it', () => {
    render(<ProjectOverviewRoute />);
    const board = screen.getByText('Board').closest('a');
    expect(board?.getAttribute('data-to')).toBe('/w/$ws/board');
    expect(JSON.parse(board?.getAttribute('data-search') ?? '{}')).toEqual({ project: 'p1' });
    const queue = screen.getByText('Merge queue').closest('a');
    expect(JSON.parse(queue?.getAttribute('data-search') ?? '{}')).toEqual({ project: 'p1' });
    expect(screen.getByText('Chat').closest('a')?.getAttribute('data-to')).toBe('/w/$ws/chat');
  });
});

describe("the project's sync state (VS-131)", () => {
  it('shows nothing when the clone is in sync', () => {
    state.sync = { syncState: 'in_sync', behindBy: null };
    render(<ProjectOverviewRoute />);
    expect(within(about()).queryByText(/behind|diverged/i)).toBeNull();
  });

  it('shows nothing before the sync check has answered', () => {
    state.sync = null;
    render(<ProjectOverviewRoute />);
    expect(within(about()).queryByText(/behind|diverged/i)).toBeNull();
  });

  it('shows how many commits behind, with a Sync action that fast-forwards it', () => {
    state.sync = { syncState: 'behind', behindBy: 3 };
    render(<ProjectOverviewRoute />);
    expect(within(about()).getByText(/3 behind/i)).toBeTruthy();
    fireEvent.click(within(about()).getByRole('button', { name: /sync/i }));
    expect(state.fetchMutate).toHaveBeenCalledTimes(1);
  });

  it('reports a diverged clone plainly, with no Sync button offered as a fix', () => {
    state.sync = { syncState: 'diverged', behindBy: null };
    render(<ProjectOverviewRoute />);
    expect(within(about()).getByText(/diverged/i)).toBeTruthy();
    expect(within(about()).getByText(/human must resolve/i)).toBeTruthy();
    expect(within(about()).queryByRole('button', { name: /sync/i })).toBeNull();
  });
});

describe('needs you', () => {
  beforeEach(() => {
    state.tickets = [ticket({ id: 'tk_1', identifier: 'ACME-1', projectId: 'p1' }), ticket({ id: 'tk_2', identifier: 'WEB-9', projectId: 'p2' })];
  });

  it('lists this project"s open decisions, each opening its ticket', () => {
    state.decisions = [decision({ id: 'd1', ticketId: 'tk_1', title: 'Plan: the overview page' })];
    render(<ProjectOverviewRoute />);
    const card = section('Needs you');
    expect(within(card).getByText('Plan: the overview page')).toBeTruthy();
    expect(JSON.parse(within(card).getByText('Plan: the overview page').closest('a')?.getAttribute('data-params') ?? '{}')).toEqual({ ws: 'ws1', ticketId: 'ACME-1' });
  });

  it('leaves out a decision belonging to another project', () => {
    state.decisions = [decision({ id: 'd2', ticketId: 'tk_2', title: 'Plan: something else' })];
    render(<ProjectOverviewRoute />);
    expect(within(section('Needs you')).getByText('Nothing is waiting for you in this project.')).toBeTruthy();
  });
});

describe('work under way', () => {
  it('shows a ticket under its status with its worker and that worker"s last line', () => {
    state.tickets = [ticket({ id: 'tk_1', identifier: 'ACME-1', title: 'The overview page', projectId: 'p1', status: 'in_progress', workerId: 'a1' })];
    state.workers = [agent({ id: 'a1', name: 'Platform Engineer #89', ticketId: 'tk_1', status: 'running' })];
    state.runs = [run({ agentId: 'a1', summary: 'Implemented tasks 1-3', finishedAt: '2026-09-10T11:00:00.000Z' })];
    render(<ProjectOverviewRoute />);
    const card = section('Work under way');
    expect(within(card).getByText('The overview page')).toBeTruthy();
    expect(within(card).getByText('Platform Engineer #89')).toBeTruthy();
    expect(within(card).getByText('Implemented tasks 1-3')).toBeTruthy();
  });

  it('names no worker for a ticket that has none, and no line for a worker with nothing to report', () => {
    state.tickets = [
      ticket({ id: 'tk_1', identifier: 'ACME-1', title: 'Unstaffed', projectId: 'p1', status: 'todo', workerId: null }),
      ticket({ id: 'tk_2', identifier: 'ACME-2', title: 'Quiet worker', projectId: 'p1', status: 'in_progress', workerId: 'a2' }),
    ];
    state.workers = [agent({ id: 'a2', name: 'Quiet #1', ticketId: 'tk_2', status: 'running' })];
    state.runs = [run({ agentId: 'a2', summary: null })];
    const card = (render(<ProjectOverviewRoute />), section('Work under way'));
    expect(within(card).getByText('Unstaffed')).toBeTruthy();
    expect(within(card).getByText('Quiet #1')).toBeTruthy();
    expect(within(card).queryByText('Implemented tasks 1-3')).toBeNull();
  });

  it('names a paused worker\'s reason instead of its last line (VS-137)', () => {
    state.tickets = [ticket({ id: 'tk_1', identifier: 'ACME-1', title: 'Landing branch settable', projectId: 'p1', status: 'approved', workerId: 'a1' })];
    state.workers = [agent({ id: 'a1', name: 'Platform Engineer #3', ticketId: 'tk_1', status: 'paused', pauseReason: 'runtime_login_expired: the claude login expired' })];
    render(<ProjectOverviewRoute />);
    const card = section('Work under way');
    // A paused worker is not "live" (VS-137), so it names no worker on the summary line...
    expect(within(card).queryByText('Platform Engineer #3')).toBeNull();
    // ...but its pause reason still shows, in place of a last-status line it has none of.
    expect(within(card).getByText('paused · runtime_login_expired: the claude login expired')).toBeTruthy();
  });

  it('leaves out another project"s tickets and anything finished', () => {
    state.tickets = [
      ticket({ id: 'tk_1', identifier: 'WEB-1', title: 'Another project', projectId: 'p2', status: 'in_progress' }),
      ticket({ id: 'tk_2', identifier: 'ACME-2', title: 'Already landed', projectId: 'p1', status: 'done' }),
    ];
    render(<ProjectOverviewRoute />);
    const card = section('Work under way');
    expect(within(card).getByText('Nothing is under way in this project.')).toBeTruthy();
  });
});

describe('landing', () => {
  it('shows what is merging and what waits behind it, in order', () => {
    state.queue = {
      projectId: 'p1',
      concurrency: 1,
      active: [{ ticketId: 'tk_1', identifier: 'ACME-1', title: 'Merging now', projectId: 'p1', position: null, queuedAt: null, startedAt: null, workerId: null, priority: 'medium', ahead: false, ciState: null, ciStateAt: null }],
      waiting: [{ ticketId: 'tk_2', identifier: 'ACME-2', title: 'Behind it', projectId: 'p1', position: 1, queuedAt: null, startedAt: null, workerId: null, priority: 'medium', ahead: false, ciState: null, ciStateAt: null }],
      recent: [],
    };
    render(<ProjectOverviewRoute />);
    const card = section('Landing');
    expect(within(card).getByText('Merging now')).toBeTruthy();
    expect(within(card).getByText('#1')).toBeTruthy();
  });

  it('says so when nothing is landing', () => {
    render(<ProjectOverviewRoute />);
    expect(within(section('Landing')).getByText('Nothing is merging or waiting to merge.')).toBeTruthy();
  });
});

describe('recent landings', () => {
  it('lists a landing with its ticket and its pull request', () => {
    state.entries = [
      entry({ kind: 'landed', at: daysAgo(1), ticketId: 'tk_1', ticketIdentifier: 'ACME-1', summary: 'ACME-1 landed' }),
      entry({ kind: 'pr_opened', at: daysAgo(2), ticketId: 'tk_1', link: { kind: 'url', target: 'https://example.com/pr/7' } }),
    ];
    render(<ProjectOverviewRoute />);
    const card = section('Recent landings');
    expect(within(card).getByText('ACME-1 landed')).toBeTruthy();
    expect(within(card).getByRole('link', { name: /Pull request for ACME-1/ }).getAttribute('href')).toBe('https://example.com/pr/7');
  });

  it('lists a landing with no recorded pull request without one', () => {
    state.entries = [entry({ kind: 'landed', at: daysAgo(1), summary: 'ACME-1 landed' })];
    render(<ProjectOverviewRoute />);
    expect(within(section('Recent landings')).queryByRole('link', { name: /Pull request/ })).toBeNull();
  });

  it('says so for a fortnight with nothing in it', () => {
    state.entries = [entry({ kind: 'landed', at: daysAgo(30), summary: 'long ago' })];
    render(<ProjectOverviewRoute />);
    expect(within(section('Recent landings')).getByText('Nothing landed in the last 14 days.')).toBeTruthy();
  });
});

describe('activity', () => {
  it('shows the heatmap and the newest entries, and opens the full changelog for this project', () => {
    state.heatmap = {
      days: [{ date: '2026-09-09', landed: 2, total: 3, byKind: { filed: 1, plan_approved: 0, pr_opened: 0, landed: 2, cancelled: 0, hired: 0, upgraded: 0 } }],
      timezone: 'UTC',
      measure: { kind: 'landed', label: 'landed', definition: 'tickets that reached the repository' },
    };
    state.entries = [entry({ kind: 'filed', at: daysAgo(1), summary: 'ACME-1 was filed' })];
    render(<ProjectOverviewRoute />);
    const card = section('Activity');
    expect(within(card).getByText('ACME-1 was filed')).toBeTruthy();
    const link = within(card).getByText('Open the full changelog').closest('a');
    expect(JSON.parse(link?.getAttribute('data-search') ?? '{}')).toEqual({ project: 'p1', tab: 'changelog' });
  });
});

describe('knowledge', () => {
  it('lists the hub file"s sections and the project"s documents', () => {
    state.hub = { path: 'p', scope: 'project', body: '## Overview\n\n- a\n\n## Landmines\n\n- b\n', tokenEstimate: 500, budgetTokens: 10000, lastCuratedAt: null, curationPending: false };
    state.docs = [
      { path: 'projects/api/docs/run-engine.md', scope: 'project', projectId: 'p1', projectSlug: 'api', slug: 'run-engine', folder: null, title: 'The run engine', summary: '', tokenEstimate: 900, budgetTokens: 2000, links: 1, backlinks: 0, updatedAt: daysAgo(3) },
    ];
    render(<ProjectOverviewRoute />);
    const card = section('Knowledge');
    expect(within(card).getByText('Overview')).toBeTruthy();
    expect(within(card).getByText('Landmines')).toBeTruthy();
    expect(within(card).getByText('The run engine')).toBeTruthy();
  });

  it('says so for a project with no documents', () => {
    render(<ProjectOverviewRoute />);
    expect(within(section('Knowledge')).getByText('No linked documents in this project.')).toBeTruthy();
  });

  it('reports a clean network as having none of an issue, rather than omitting the measure', () => {
    state.health = { hubs: [], orphans: [], stale: [], unresolvedLinks: [] };
    render(<ProjectOverviewRoute />);
    expect(within(section('Knowledge')).getByText('No orphan documents, no stale documents, no unresolved links.')).toBeTruthy();
  });

  it('shows the counts for an orphan, a stale document and an unresolved link', () => {
    state.health = {
      hubs: [],
      orphans: [{ path: 'p1', scope: 'project', projectId: 'p1', projectSlug: 'api', slug: 'orphan', folder: null, title: 'Orphan', summary: '', tokenEstimate: 1, budgetTokens: 1, links: 0, backlinks: 0, updatedAt: daysAgo(1) }],
      stale: [{ path: 'p2', scope: 'project', projectId: 'p1', projectSlug: 'api', slug: 'stale', folder: null, title: 'Stale', summary: '', tokenEstimate: 1, budgetTokens: 1, links: 0, backlinks: 1, updatedAt: daysAgo(120) }],
      unresolvedLinks: [{ fromPath: 'p3', fromTitle: 'From', toSlug: 'nowhere' }],
    };
    render(<ProjectOverviewRoute />);
    const card = section('Knowledge');
    expect(within(card).getByText(/1 document with no backlink/)).toBeTruthy();
    expect(within(card).getByText(/1 document not updated in 90 days/)).toBeTruthy();
    expect(within(card).getByText(/1 unresolved link/)).toBeTruthy();
  });
});

describe('the sections', () => {
  it('keeps History and Pull requests in the published order', () => {
    expect(PROJECT_SECTIONS.map((s) => s.key)).toEqual([
      'needs', 'work', 'landing', 'history', 'pulls', 'landings', 'activity', 'knowledge',
    ]);
  });

  // Its content is VS-96's; all this file asserts is that giving it content changed nothing else.
  it('renders the History section without disturbing the page', () => {
    render(<ProjectOverviewRoute />);
    const card = section('History');
    expect(within(card).getByText(/No commits yet/)).toBeTruthy();
    expect(within(card).queryByRole('alert')).toBeNull();
  });

  // Its content is VS-97's; all this file asserts is that giving it content changed nothing else.
  it('renders the Pull requests section without disturbing the page', () => {
    state.pullRequests = { projectId: 'p1', available: false, reason: 'no_forge', message: null, stale: false, capturedAt: '2026-09-07T10:00:00.000Z', windowDays: 30, open: [], recent: [] };
    render(<ProjectOverviewRoute />);
    const card = section('Pull requests');
    expect(within(card).getByText(/no forge/)).toBeTruthy();
    expect(within(card).queryByRole('alert')).toBeNull();
  });
});

describe('scrollable sections', () => {
  it('caps every section but Activity, which already bounds itself to SHOWN=12', () => {
    const capped = PROJECT_SECTIONS.filter((s) => s.scrollable).map((s) => s.key);
    expect(capped).toEqual(['needs', 'work', 'landing', 'history', 'pulls', 'landings', 'knowledge']);
    expect(PROJECT_SECTIONS.find((s) => s.key === 'activity')?.scrollable).toBe(false);
  });

  it('caps a scrollable section at a share of --ac-app-h with plain overflow-y-auto, whether it has few rows or many', () => {
    const few = <ProjectSection id="x" label="X" scrollable><ul><li>one</li><li>two</li></ul></ProjectSection>;
    const { container: shortContainer, unmount } = render(few);
    const shortBody = shortContainer.querySelector('#project-section-x');
    expect(shortBody?.className).toContain('overflow-y-auto');
    expect(shortBody?.className).toContain('max-h-[calc(var(--ac-app-h)*0.4)]');
    // Not .ac-scroll: that utility sets overscroll-behavior: contain, which would trap the page
    // scroll at the section's boundary instead of letting it continue (criterion 3).
    expect(shortBody?.className).not.toContain('ac-scroll');
    expect(within(shortBody as HTMLElement).getAllByRole('listitem')).toHaveLength(2);
    unmount();

    const many = (
      <ProjectSection id="x" label="X" scrollable>
        <ul>{Array.from({ length: 50 }, (_, i) => <li key={i}>row {i}</li>)}</ul>
      </ProjectSection>
    );
    const { container: longContainer } = render(many);
    const longBody = longContainer.querySelector('#project-section-x');
    // Same classes regardless of content — the cap is a maximum, not a fixed height, and nothing is
    // sliced out of the DOM to fit it.
    expect(longBody?.className).toBe(shortBody?.className);
    expect(within(longBody as HTMLElement).getAllByRole('listitem')).toHaveLength(50);
  });

  it('gives a non-scrollable section no cap and no scroll class', () => {
    const { container } = render(
      <ProjectSection id="x" label="X">
        <p>content</p>
      </ProjectSection>,
    );
    const body = container.querySelector('#project-section-x');
    expect(body?.className).not.toContain('overflow-y-auto');
    expect(body?.className).not.toContain('max-h-');
  });
});

describe('the layout', () => {
  it('gives every section an address of its own', () => {
    render(<ProjectOverviewRoute />);
    for (const s of PROJECT_SECTIONS) expect(document.getElementById(s.key)).not.toBeNull();
  });

  it('collapses a section and says so, then expands it again', () => {
    render(<ProjectOverviewRoute />);
    const toggle = within(section('Knowledge')).getByRole('button', { name: /Knowledge/ });
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(within(section('Knowledge')).queryByText('No linked documents in this project.')).toBeNull();
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
  });

  it('sizes nothing in raw viewport units, so the phone keyboard work still holds', () => {
    const { container } = render(<ProjectOverviewRoute />);
    expect(container.innerHTML).not.toMatch(/\b(?:h|min-h|max-h)-\[?\d*(?:d|s|l)?vh/);
  });
});
