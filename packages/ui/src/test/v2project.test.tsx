/**
 * VS-352: the V2 project overview (`/w/:ws/p/:project`) — the kept V1 sections restyled, the header
 * links, the commit graph, the pull requests and their shared diff, and the unknown-project state.
 */
import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';

const state = vi.hoisted(() => ({
  project: { id: 'p1', slug: 'web', name: 'Web', gitUrl: 'git@example.invalid:web.git', defaultBranch: 'main', status: 'ready', policies: {} },
  param: 'web' as string,
  commits: [] as unknown[],
  pulls: { open: [] as unknown[], recent: [] as unknown[] },
  prDetail: null as Record<string, unknown> | null,
  openingPull: false,
  roadmap: [] as Array<Record<string, unknown>>,
  blocks: [] as Array<Record<string, unknown>>,
  calls: [] as Array<{ kind: string; args: unknown }>,
}));

vi.mock('@tanstack/react-router', () => ({
  useRouterState: () => '/w/ws1/p/web',
  useParams: () => ({ ws: 'ws1', project: state.param }),
}));

vi.mock('../app/link', () => ({
  A: ({ to, params, children, ...rest }: { to: string; params?: Record<string, unknown>; children?: ReactNode } & Record<string, unknown>) => (
    <a href={to.replace(/\$ws/g, String(params?.['ws'] ?? '')).replace(/\$project/g, String(params?.['project'] ?? '')).replace(/\$ticketId/g, String(params?.['ticketId'] ?? '')).replace(/\$workerId/g, String(params?.['workerId'] ?? ''))} {...rest}>
      {children}
    </a>
  ),
  useGo: () => vi.fn(),
  useSearchParams: () => ({}),
}));

vi.mock('../api/context', () => ({ useWs: () => 'ws1', useHookWs: (o?: string) => o ?? 'ws1' }));

vi.mock('../components/Toast', () => ({ useToast: () => ({ push: () => undefined }) }));

vi.mock('../api/hooks', () => ({
  useWorkspaces: () => ({ data: [{ id: 'ws1', name: 'Acme', needsYou: 0 }] }),
  useWorkers: () => ({ data: [] }),
  useWorkersMany: (ids: readonly string[]) => ids.map(() => ({ data: [] })),
  useDecisionsMany: (ids: readonly string[]) => ids.map(() => ({ data: [] })),
  useIncidents: () => ({ data: { items: [] } }),
  useProjects: () => ({ data: [state.project], isLoading: false }),
  useWorkspaceSummary: () => ({ data: { config: {}, workspace: { ticketPrefix: 'ACME' } }, isLoading: false }),
  useProjectSync: () => ({ data: { syncState: 'in_sync', behindBy: 0 } }),
  useProjectFetch: () => ({ mutate: vi.fn(), isPending: false }),
  useKnowledgeDoc: () => ({ isLoading: false, data: { body: '## Current focus\nShip the V2 kept screens', tokenEstimate: 12, budgetTokens: 100, lastCuratedAt: null, curationPending: false } }),
  useKnowledgeDocs: () => ({ isLoading: false, data: [{ scope: 'project', path: 'p1/PROJECT.md', slug: 'project-kb', title: 'Project KB', updatedAt: '2026-09-01T00:00:00.000Z' }] }),
  useKnowledgeHealth: () => ({ isLoading: false, data: { orphans: [], stale: [], unresolvedLinks: [] } }),
  useProjectHistory: () => ({
    refs: [],
    commits: state.commits,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
    hasMore: false,
    isLoadingMore: false,
    loadMore: vi.fn(),
  }),
  useCommit: () => ({ isLoading: false, isError: false, data: { sha: 'a1', message: 'Commit a1 message', author: 'victor', authoredAt: '2026-09-01T00:00:00.000Z', forgeUrl: null, files: [], truncatedFiles: 0 }, refetch: vi.fn() }),
  usePullRequests: () => ({ isLoading: false, data: { available: true, windowDays: 14, open: state.pulls.open, recent: state.pulls.recent, capturedAt: '2026-09-10T00:00:00.000Z', stale: false } }),
  usePullRequest: () => ({ isLoading: false, data: state.openingPull ? { available: true, pullRequest: state.prDetail } : { available: true, pullRequest: null } }),
  usePullRequestDiffFiles: () => ({ isLoading: false, data: { available: true, files: [{ path: 'src/a.ts', status: 'modified', additions: 2, deletions: 1, binary: false, tooLarge: false, previousPath: null }] } }),
  usePullRequestDiffFile: () => ({ isLoading: false, data: { available: true, file: { hunks: [] } } }),
  usePullRequestDiffContext: () => ({ isLoading: false, data: { available: true, lines: [] } }),
  useChangelogRecent: () => ({ isLoading: false, data: { entries: [] } }),
  useChangelogHeatmap: () => ({ isLoading: false, data: undefined }),
  useDecisions: () => ({ isLoading: false, data: [] }),
  useTickets: () => ({ isLoading: false, data: [{ id: 'tk_1', identifier: 'ACME-42' }] }),
  useRuns: () => ({ isLoading: false, data: [] }),
  useRoadmap: () => ({ isLoading: false, data: state.roadmap }),
  useRoadmapBlocks: () => ({ isLoading: false, data: state.blocks }),
  useCreateRoadmapItem: () => ({ isPending: false, mutate: (args: unknown, opts?: { onSuccess?: () => void }) => { state.calls.push({ kind: 'create', args }); opts?.onSuccess?.(); } }),
  usePatchRoadmapItem: () => ({ isPending: false, mutate: (args: unknown, opts?: { onSuccess?: () => void }) => { state.calls.push({ kind: 'patch', args }); opts?.onSuccess?.(); } }),
  useRemoveRoadmapItem: () => ({ isPending: false, mutate: (args: unknown, opts?: { onSuccess?: () => void }) => { state.calls.push({ kind: 'remove', args }); opts?.onSuccess?.(); } }),
  readerTimezone: () => 'UTC',
}));

const { V2ProjectScreen } = await import('../v2/project/ProjectPage');

beforeEach(() => {
  state.param = 'web';
  state.commits = [];
  state.pulls = { open: [], recent: [] };
  state.prDetail = null;
  state.openingPull = false;
  state.roadmap = [];
  state.blocks = [];
  state.calls = [];
});

describe('the V2 project overview', () => {
  it('resolves a project by slug, shows its about block and Current focus, and links its V2 screens', () => {
    render(<V2ProjectScreen />);
    expect(screen.getByRole('heading', { name: 'Web' })).toBeInTheDocument();
    expect(screen.getByText('git@example.invalid:web.git')).toBeInTheDocument();
    expect(screen.getByText('Ship the V2 kept screens')).toBeInTheDocument();
    const links = screen.getAllByRole('link').map((a) => a.getAttribute('href'));
    expect(links).toContain('/w/ws1/work');
    expect(links).toContain('/w/ws1/knowledge');
    expect(links).toContain('/w/ws1/chat');
    expect(links.some((h) => h?.includes('merge-queue'))).toBe(false);
  });

  it('resolves a project by id too', () => {
    state.param = 'p1';
    render(<V2ProjectScreen />);
    expect(screen.getByRole('heading', { name: 'Web' })).toBeInTheDocument();
  });

  it('shows an empty state for an address that resolves to no project', () => {
    state.param = 'ghost';
    render(<V2ProjectScreen />);
    expect(screen.getByText('No such project in this workspace.')).toBeInTheDocument();
  });

  it('renders the kept sections', () => {
    render(<V2ProjectScreen />);
    for (const label of ['Needs you', 'Work under way', 'Roadmap', 'History', 'Pull requests', 'Recent landings', 'Activity', 'Knowledge']) {
      expect(screen.getByRole('heading', { name: label })).toBeInTheDocument();
    }
  });

  const roadmapSection = (): HTMLElement =>
    screen.getByRole('heading', { name: 'Roadmap' }).closest('section') as HTMLElement;

  it('shows the roadmap in order with status, notes and the linked ticket', () => {
    state.blocks = [{ id: 'b1', projectId: 'p1', title: 'UI polish', reportedStatus: 'open', items: [] }];
    state.roadmap = [
      { id: 'r1', projectId: 'p1', blockId: 'b1', title: 'Dark mode', notes: '**Later**', position: 0, status: 'planned', ticketId: 'tk_1' },
      { id: 'r2', projectId: 'p1', blockId: null, title: 'Shortcuts', notes: '', position: 1, status: 'idea', ticketId: null },
    ];
    render(<V2ProjectScreen />);
    const section = roadmapSection();
    const titles = within(section).getAllByText(/^(Dark mode|Shortcuts)$/).map((el) => el.textContent);
    expect(titles).toEqual(['Dark mode', 'Shortcuts']);
    expect(within(section).getByRole('link', { name: 'ACME-42' })).toHaveAttribute('href', '/w/ws1/tickets/ACME-42');
    expect(within(section).getByText('Later').tagName).toBe('STRONG');
    // An item in a block names its block; the section links to the full Roadmap page (VS-478).
    expect(within(section).getByText('UI polish')).toBeInTheDocument();
    expect(within(section).getByRole('link', { name: 'Open the full roadmap' })).toHaveAttribute('href', '/w/ws1/p/web/roadmap');
    // Each item's own select shows its current status.
    expect((within(section).getByLabelText('Status of Dark mode') as HTMLSelectElement).value).toBe('planned');
    expect((within(section).getByLabelText('Status of Shortcuts') as HTMLSelectElement).value).toBe('idea');
  });

  it('adds a roadmap item from the input', () => {
    render(<V2ProjectScreen />);
    fireEvent.change(screen.getByLabelText('Add a roadmap idea'), { target: { value: 'New idea' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(state.calls).toContainEqual({ kind: 'create', args: { projectId: 'p1', title: 'New idea' } });
  });

  it('reorders, changes status, edits and deletes a roadmap item', () => {
    state.roadmap = [
      { id: 'r1', projectId: 'p1', title: 'First', notes: '', position: 0, status: 'idea', ticketId: null },
      { id: 'r2', projectId: 'p1', title: 'Second', notes: '', position: 1, status: 'idea', ticketId: null },
    ];
    render(<V2ProjectScreen />);
    fireEvent.click(screen.getByRole('button', { name: 'Move Second up' }));
    expect(state.calls).toContainEqual({ kind: 'patch', args: { projectId: 'p1', itemId: 'r2', patch: { position: 0 } } });

    fireEvent.change(screen.getByLabelText('Status of First'), { target: { value: 'planned' } });
    expect(state.calls).toContainEqual({ kind: 'patch', args: { projectId: 'p1', itemId: 'r1', patch: { status: 'planned' } } });

    fireEvent.click(screen.getAllByRole('button', { name: 'Edit' })[0]!);
    fireEvent.change(screen.getByLabelText('Idea title'), { target: { value: 'First v2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(state.calls).toContainEqual({ kind: 'patch', args: { projectId: 'p1', itemId: 'r1', patch: { title: 'First v2', notes: '' } } });

    fireEvent.click(screen.getByRole('button', { name: 'Delete First' }));
    expect(state.calls).toContainEqual({ kind: 'remove', args: { projectId: 'p1', itemId: 'r1' } });
  });

  it('shows the roadmap empty state', () => {
    render(<V2ProjectScreen />);
    expect(screen.getByText(/No ideas on the roadmap yet/)).toBeInTheDocument();
  });

  it('draws the commit graph and opens a commit detail', () => {
    state.commits = [{ sha: 'a1', subject: 'Commit a1 subject', author: 'victor', authoredAt: '2026-09-01T00:00:00.000Z', parents: [], refs: [] }];
    render(<V2ProjectScreen />);
    const row = screen.getByRole('button', { name: /Commit a1 subject/ });
    fireEvent.click(row);
    expect(screen.getByText('Commit a1 message')).toBeInTheDocument();
  });

  it('opens a pull request and renders its files through the shared diff renderer', () => {
    state.pulls = {
      open: [{ number: 7, title: 'Dark mode', checks: 'success', state: 'open', isDraft: false, updatedAt: '2026-09-10T00:00:00.000Z', author: 'victor', headRefName: 'ac/dark', ticket: null, changeName: null, reviewDecision: null, queue: null, url: 'https://example.invalid/pr/7' }],
      recent: [],
    };
    state.openingPull = true;
    state.prDetail = {
      number: 7, title: 'Dark mode', checks: 'success', state: 'open', isDraft: false, updatedAt: '2026-09-10T00:00:00.000Z', author: 'victor',
      headRefName: 'ac/dark', baseRefName: 'main', ticket: null, changeName: null, reviewDecision: null, queue: null, url: 'https://example.invalid/pr/7',
      body: 'Adds dark mode', files: [{ path: 'src/a.ts', status: 'modified', additions: 2, deletions: 1, binary: false, tooLarge: false, previousPath: null }], checkRuns: [], headSha: null,
    };
    render(<V2ProjectScreen />);
    fireEvent.click(screen.getByRole('button', { name: /Pull request #7: Dark mode/ }));
    expect(screen.getByRole('button', { name: /src\/a\.ts/ })).toBeInTheDocument();
    expect(screen.getByText('Adds dark mode')).toBeInTheDocument();
  });
});
