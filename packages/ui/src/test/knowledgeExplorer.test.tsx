import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { KnowledgeDocDetail, KnowledgeDocSummary } from '../api/types';

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
}));

vi.mock('../api/context', () => ({ useWs: () => 'ws1' }));
vi.mock('../app/link', () => ({ A: ({ to, children }: { to: string; children?: React.ReactNode }) => <a href={to}>{children}</a> }));

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
}));

const { KnowledgeExplorer } = await import('../routes/KnowledgeExplorer');

beforeEach(() => {
  state.docs = [];
  state.hubFiles = [];
  state.archive = [];
  state.archiveLoading = false;
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
