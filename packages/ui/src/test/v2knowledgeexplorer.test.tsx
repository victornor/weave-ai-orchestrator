/** The V2 knowledge explorer route (VS-347): the kept V1 explorer is reached inside the V2 frame,
 * with its folder tree and its default hub document pane. Hooks and the router are mocked. */
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type { KnowledgeDocSummary } from '../api/types';

const state = vi.hoisted(() => ({ docs: [] as KnowledgeDocSummary[], hubs: [] as Array<Record<string, unknown>> }));

vi.mock('../api/context', () => ({ useWs: () => 'ws1' }));
const linkState = vi.hoisted(() => ({ search: {} as Record<string, string | undefined>, go: vi.fn() }));
vi.mock('../app/link', () => ({
  A: ({ to, children }: { to: string; children?: ReactNode }) => <a href={to}>{children}</a>,
  useSearchParams: () => linkState.search,
  useGo: () => linkState.go,
}));
vi.mock('../api/hooks', () => ({
  useProjects: () => ({ data: [{ id: 'p1', slug: 'api', name: 'api' }] }),
  useKnowledgeDocs: () => ({ data: state.docs, isLoading: false, isError: false, refetch: vi.fn() }),
  useKnowledgeIndex: () => ({ data: { files: state.hubs, warnings: [] }, isLoading: false, isError: false, refetch: vi.fn() }),
  useKnowledgeDocDetail: () => ({ data: null, isLoading: false, isError: true }),
  useKnowledgeDocMutation: () => ({ mutate: vi.fn() }),
  useKnowledgeMoveDoc: () => ({ mutate: vi.fn() }),
  useKnowledgeDoc: () => ({ data: { path: 'projects/api/PROJECT.md', scope: 'project', body: '# api\n' }, isLoading: false, refetch: vi.fn() }),
  useKnowledgeRevisions: () => ({ data: [] }),
  useKnowledgeMutation: () => ({ mutate: vi.fn() }),
  useKnowledgeArchiveMany: (roots: Array<{ scope: string; project?: string }>) => roots.map(() => ({ data: [], isLoading: false })),
  useKnowledgeArchiveFile: () => ({ data: { path: 'a', body: '# Archived\n' }, isLoading: false }),
  useProjectArtifacts: () => ({ data: [], isLoading: false }),
  useWorkspaceArtifacts: () => ({ data: [], isLoading: false }),
  useTicketDocumentRevisions: () => ({ data: [] }),
}));

const DOC: KnowledgeDocSummary = {
  path: 'projects/api/docs/theming.md', scope: 'project', projectId: 'p1', projectSlug: 'api',
  slug: 'theming', folder: null, title: 'Theming decisions', summary: '', tokenEstimate: 50, budgetTokens: 10000,
  links: 0, backlinks: 1, updatedAt: '2026-09-12T00:00:00Z',
};

beforeEach(() => {
  state.docs = [DOC];
  state.hubs = [{ id: 'h1', path: 'projects/api/PROJECT.md', scope: 'project', projectId: 'p1', projectSlug: 'api', kind: 'hub' }];
  linkState.search = {};
});

const { KnowledgeExplorerPage } = await import('../v2/knowledge/KnowledgeExplorerPage');

describe('the V2 knowledge explorer route', () => {
  it('renders the folder tree and the default hub pane', async () => {
    render(<KnowledgeExplorerPage />);
    expect(await screen.findByText('PROJECT.md')).toBeInTheDocument();
    expect(screen.getByText('Theming decisions')).toBeInTheDocument();
    // The pane defaults to the project's PROJECT.md hub, whose body is `# api`.
    expect(await screen.findByRole('heading', { name: 'api' })).toBeInTheDocument();
  });
});
