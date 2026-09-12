import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { KnowledgeDocDetail, KnowledgeDocSummary, TicketArtifactSummary } from '../api/types';

const DOC_NESTED: KnowledgeDocSummary = {
  path: 'projects/api/docs/runbooks/incidents/retry-policy.md', scope: 'project', projectId: 'p1', projectSlug: 'api',
  slug: 'retry-policy', folder: 'runbooks/incidents', title: 'Retry policy', summary: 'Backoff and jitter.',
  tokenEstimate: 100, budgetTokens: 10000, links: 0, backlinks: 0, updatedAt: '2026-09-11T00:00:00Z',
};

const DOC_FLAT: KnowledgeDocSummary = {
  path: 'projects/api/docs/run-engine.md', scope: 'project', projectId: 'p1', projectSlug: 'api',
  slug: 'run-engine', folder: null, title: 'The run engine', summary: '', tokenEstimate: 50, budgetTokens: 10000,
  links: 0, backlinks: 0, updatedAt: '2026-09-11T00:00:00Z',
};

const DETAIL: KnowledgeDocDetail = {
  ...DOC_NESTED, body: '# Retry policy\n\nBackoff and jitter.\n', revision: 1, linksTo: [], linkedFrom: [],
};

const state = vi.hoisted(() => ({
  docs: [] as KnowledgeDocSummary[],
  hubFiles: [] as Array<{ id: string; path: string; scope: string; projectId: string | null; projectSlug: string | null; kind: 'hub' | 'doc' }>,
  archive: [] as Array<{ path: string; date: string }>,
  archiveLoading: false,
  artifacts: [] as TicketArtifactSummary[],
  artifactsLoading: false,
}));

const linkState = vi.hoisted(() => ({ search: {} as Record<string, string | undefined>, go: vi.fn() }));

vi.mock('../api/context', () => ({ useWs: () => 'ws1' }));
vi.mock('../app/link', () => ({
  A: ({ to, children }: { to: string; children?: React.ReactNode }) => <a href={to}>{children}</a>,
  useSearchParams: () => linkState.search,
  useGo: () => linkState.go,
}));

vi.mock('../api/hooks', () => ({
  useProjects: () => ({ data: [{ id: 'p1', slug: 'api' }] }),
  useKnowledgeDocs: () => ({ data: state.docs, isLoading: false, isError: false, refetch: vi.fn() }),
  useKnowledgeIndex: () => ({ data: { files: state.hubFiles, warnings: [] }, isLoading: false, isError: false, refetch: vi.fn() }),
  useKnowledgeDocDetail: () => ({ data: DETAIL, isLoading: false, isError: false }),
  useKnowledgeDocMutation: () => ({ mutate: vi.fn() }),
  useKnowledgeMoveDoc: () => ({ mutate: vi.fn() }),
  useKnowledgeDoc: () => ({ data: { path: 'projects/api/PROJECT.md', scope: 'project', body: '# api\n' }, isLoading: false }),
  useKnowledgeRevisions: () => ({ data: [] }),
  useKnowledgeMutation: () => ({ mutate: vi.fn() }),
  useKnowledgeArchiveMany: (roots: Array<{ scope: string; project?: string }>) =>
    roots.map(() => ({ data: state.archive, isLoading: state.archiveLoading })),
  useKnowledgeArchiveFile: () => ({ data: { path: 'a', body: '# Archived\n' }, isLoading: false }),
  useProjectArtifacts: () => ({ data: state.artifacts, isLoading: state.artifactsLoading }),
  useTicketDocumentRevisions: () => ({ data: [] }),
}));

const { KnowledgeExplorer } = await import('../routes/KnowledgeExplorer');

/** Render with `matchMedia` forced to a narrow viewport, restoring it afterwards. */
function renderNarrow(ui: React.ReactElement): ReturnType<typeof render> {
  const real = window.matchMedia;
  window.matchMedia = ((q: string) => ({
    matches: true, media: q, onchange: null,
    addEventListener: () => undefined, removeEventListener: () => undefined,
    addListener: () => undefined, removeListener: () => undefined, dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
  try {
    return render(ui);
  } finally {
    window.matchMedia = real;
  }
}

beforeEach(() => {
  state.docs = [];
  state.hubFiles = [];
  state.archive = [];
  state.archiveLoading = false;
  state.artifacts = [];
  state.artifactsLoading = false;
  linkState.search = {};
  linkState.go.mockClear();
});

describe('KnowledgeExplorer', () => {
  it('reaches a document nested two folders deep through its folder chain, and opens it', () => {
    state.docs = [DOC_NESTED];
    render(<KnowledgeExplorer project="p1" />);

    expect(screen.queryByText('Retry policy')).toBeNull(); // collapsed by default
    fireEvent.click(screen.getByText('runbooks'));
    fireEvent.click(screen.getByText('incidents'));
    const doc = screen.getByText('Retry policy');
    expect(doc).toBeInTheDocument();

    fireEvent.click(doc);
    expect(screen.getByText('Backoff and jitter.')).toBeInTheDocument();
  });

  it('renders a hub file distinctly from a document, both at the project root', () => {
    state.hubFiles = [{ id: 'h1', path: 'projects/api/PROJECT.md', scope: 'project', projectId: 'p1', projectSlug: 'api', kind: 'hub' }];
    state.docs = [DOC_FLAT];
    render(<KnowledgeExplorer project="p1" />);

    const hubRow = screen.getByText('PROJECT.md').closest('button')!;
    expect(within(hubRow).getByText('hub')).toBeInTheDocument();
    const docRow = screen.getByText('The run engine').closest('button')!;
    expect(within(docRow).queryByText('hub')).toBeNull();

    fireEvent.click(hubRow);
    expect(screen.getByRole('heading', { name: 'api' })).toBeInTheDocument();
  });

  it('shows no archive entry for a scope with nothing archived', () => {
    state.hubFiles = [{ id: 'h1', path: 'projects/api/PROJECT.md', scope: 'project', projectId: 'p1', projectSlug: 'api', kind: 'hub' }];
    state.archive = [];
    render(<KnowledgeExplorer project="p1" />);
    expect(screen.queryByText('archive')).toBeNull();
  });

  it('shows a collapsed archive entry that expands to the dated files, when the scope has any', () => {
    state.hubFiles = [{ id: 'h1', path: 'projects/api/PROJECT.md', scope: 'project', projectId: 'p1', projectSlug: 'api', kind: 'hub' }];
    state.archive = [{ path: 'projects/api/docs/archive/2026-09-11.md', date: '2026-09-11' }];
    render(<KnowledgeExplorer project="p1" />);

    expect(screen.queryByText('2026-09-11')).toBeNull();
    fireEvent.click(screen.getByText('archive'));
    const date = screen.getByText('2026-09-11');
    expect(date).toBeInTheDocument();

    fireEvent.click(date);
    expect(screen.getByText('Archived')).toBeInTheDocument();
  });
});

const ARTIFACT: TicketArtifactSummary = {
  id: 'wp_1', ticketId: 'tk_1', ticketIdentifier: 'ACME-42', ticketTitle: 'Add dark mode',
  key: 'overview', title: 'Overview', metadata: { kind: 'diagram' }, url: '/api/w/ws1/tickets/tk_1/artifacts/overview/raw',
  updatedAt: '2026-09-12T00:00:00Z',
};

describe('KnowledgeExplorer artifacts entry (VS-270)', () => {
  it('shows no Artifacts entry for a project with none', () => {
    state.hubFiles = [{ id: 'h1', path: 'projects/api/PROJECT.md', scope: 'project', projectId: 'p1', projectSlug: 'api', kind: 'hub' }];
    state.artifacts = [];
    render(<KnowledgeExplorer project="p1" />);
    expect(screen.queryByText('Artifacts')).toBeNull();
  });

  it('lists an artifact with its ticket identifier and opens it', () => {
    state.hubFiles = [{ id: 'h1', path: 'projects/api/PROJECT.md', scope: 'project', projectId: 'p1', projectSlug: 'api', kind: 'hub' }];
    state.artifacts = [ARTIFACT];
    render(<KnowledgeExplorer project="p1" />);

    expect(screen.getByText('Artifacts')).toBeInTheDocument();
    const row = screen.getByText('Overview').closest('button')!;
    expect(within(row).getByText('ACME-42')).toBeInTheDocument();

    fireEvent.click(row);
    expect(screen.getByTitle('Overview').tagName).toBe('IFRAME');
  });

  it('lists artifacts from two different tickets, each correctly attributed', () => {
    state.hubFiles = [{ id: 'h1', path: 'projects/api/PROJECT.md', scope: 'project', projectId: 'p1', projectSlug: 'api', kind: 'hub' }];
    const other: TicketArtifactSummary = { ...ARTIFACT, id: 'wp_2', ticketId: 'tk_2', ticketIdentifier: 'ACME-43', ticketTitle: 'Second ticket', key: 'sequence', title: 'Sequence diagram' };
    state.artifacts = [ARTIFACT, other];
    render(<KnowledgeExplorer project="p1" />);

    const rowA = screen.getByText('Overview').closest('button')!;
    const rowB = screen.getByText('Sequence diagram').closest('button')!;
    expect(within(rowA).getByText('ACME-42')).toBeInTheDocument();
    expect(within(rowB).getByText('ACME-43')).toBeInTheDocument();

    fireEvent.click(rowB);
    expect(screen.getByTitle('Sequence diagram').tagName).toBe('IFRAME');
  });

  it('shows the Artifacts entry even when the project has no documents or hubs to browse', () => {
    state.docs = [];
    state.hubFiles = [];
    state.artifacts = [ARTIFACT];
    render(<KnowledgeExplorer project="p1" />);
    expect(screen.getByText('Artifacts')).toBeInTheDocument();
    expect(screen.queryByText('Nothing to browse yet.')).toBeNull();
  });

  it('still shows the ordinary empty state when there are no documents, hubs, or artifacts', () => {
    state.docs = [];
    state.hubFiles = [];
    state.artifacts = [];
    render(<KnowledgeExplorer project="p1" />);
    expect(screen.getByText('Nothing to browse yet.')).toBeInTheDocument();
  });
});

const PROJECT_HUB = { id: 'h1', path: 'projects/api/PROJECT.md', scope: 'project', projectId: 'p1', projectSlug: 'api', kind: 'hub' as const };

describe('KnowledgeExplorer two-pane browser (VS-279)', () => {
  it('fills the page with a tree pane and a content pane, defaulting to PROJECT.md', () => {
    state.hubFiles = [PROJECT_HUB];
    state.docs = [DOC_FLAT];
    render(<KnowledgeExplorer project="p1" />);

    expect(screen.getByText('The run engine')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'api' })).toBeInTheDocument();
    expect(screen.getByRole('separator', { name: 'Resize tree pane' })).toBeInTheDocument();
  });

  it('renders a selected document in the content pane without leaving the explorer', () => {
    state.hubFiles = [PROJECT_HUB];
    state.docs = [DOC_FLAT];
    render(<KnowledgeExplorer project="p1" />);

    fireEvent.click(screen.getByText('The run engine'));
    expect(screen.getByRole('heading', { name: 'Retry policy' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'api' })).toBeNull();
    expect(screen.getByText('The run engine')).toBeInTheDocument();
    expect(screen.getByRole('separator', { name: 'Resize tree pane' })).toBeInTheDocument();
  });

  it("defaults to the first project's PROJECT.md when no project is selected", () => {
    state.hubFiles = [PROJECT_HUB];
    state.docs = [DOC_FLAT];
    render(<KnowledgeExplorer />);

    expect(screen.getByRole('heading', { name: 'api' })).toBeInTheDocument();
  });

  it('shows only the tree at a narrow viewport until something is selected', () => {
    state.hubFiles = [PROJECT_HUB];
    state.docs = [DOC_FLAT];
    renderNarrow(<KnowledgeExplorer project="p1" />);

    expect(screen.getByText('The run engine')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'api' })).toBeNull();
    expect(screen.queryByRole('separator')).toBeNull();
  });

  it('replaces the tree with the selected content on a narrow viewport and offers a way back', () => {
    state.hubFiles = [PROJECT_HUB];
    state.docs = [DOC_FLAT];
    renderNarrow(<KnowledgeExplorer project="p1" />);

    fireEvent.click(screen.getByText('The run engine'));
    expect(screen.queryByText('The run engine')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Retry policy' })).toBeInTheDocument();

    fireEvent.click(screen.getByText('← tree'));
    expect(screen.getByText('The run engine')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Retry policy' })).toBeNull();
  });

  it('reflects the selected document in the URL', () => {
    state.hubFiles = [PROJECT_HUB];
    state.docs = [DOC_FLAT];
    render(<KnowledgeExplorer project="p1" />);

    fireEvent.click(screen.getByText('The run engine'));
    const call = linkState.go.mock.calls.at(-1);
    expect(call?.[0]).toBe('/w/$ws/knowledge');
    expect(call?.[1]).toMatchObject({ search: { tab: 'explorer', project: 'p1', doc: 'project:run-engine' } });
  });

  it('opens with the document named in the URL already selected', () => {
    state.hubFiles = [PROJECT_HUB];
    state.docs = [DOC_NESTED];
    linkState.search = { tab: 'explorer', project: 'p1', doc: 'project:retry-policy' };
    render(<KnowledgeExplorer project="p1" />);

    expect(screen.getByRole('heading', { name: 'Retry policy' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'api' })).toBeNull();
  });

  it('marks the selected document row and clears the mark when it changes', () => {
    state.hubFiles = [PROJECT_HUB];
    state.docs = [DOC_FLAT];
    render(<KnowledgeExplorer project="p1" />);

    const flatRow = (): HTMLElement => screen.getByText('The run engine').closest('button')!;
    const hubRow = (): HTMLElement => screen.getByText('PROJECT.md').closest('button')!;
    expect(flatRow().getAttribute('aria-current')).toBeNull();

    fireEvent.click(flatRow());
    expect(flatRow().getAttribute('aria-current')).toBe('true');

    fireEvent.click(hubRow());
    expect(hubRow().getAttribute('aria-current')).toBe('true');
    expect(flatRow().getAttribute('aria-current')).toBeNull();
  });
});
