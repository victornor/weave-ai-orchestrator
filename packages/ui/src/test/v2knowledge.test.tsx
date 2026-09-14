/** The V2 Knowledge tab (VS-371, from VS-347): the knowledge-base list with its meters, the
 * cross-knowledge search, V1's document catalogue, and the artifacts list. The specs list is not
 * here — it has its own tab (`v2knowledgespecs.test.tsx`). Hooks and the router are mocked. */
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type { CapabilitySummary, KnowledgeDocDetail, KnowledgeDocSummary, SearchHit, TicketArtifactSummary, WeaverArtifactSummary } from '../api/types';

const state = vi.hoisted(() => ({
  files: [] as Array<Record<string, unknown>>,
  hits: [] as SearchHit[],
  docs: [] as KnowledgeDocSummary[],
  docDetail: null as KnowledgeDocDetail | null,
  capabilities: [] as CapabilitySummary[],
  artifacts: [] as TicketArtifactSummary[],
  weaverArtifacts: [] as WeaverArtifactSummary[],
}));

vi.mock('../api/context', () => ({ useWs: () => 'acme' }));
vi.mock('../app/link', () => ({
  A: ({ to, params, children }: { to: string; params?: Record<string, unknown>; children?: ReactNode }) => {
    const href = Object.entries(params ?? {}).reduce((acc, [k, v]) => acc.replace(`$${k}`, String(v)), to);
    return <a href={href}>{children}</a>;
  },
  useSearchParams: () => ({}),
  useGo: () => vi.fn(),
}));
vi.mock('../api/hooks', () => ({
  useKnowledgeIndex: () => ({ data: { files: state.files, warnings: [] }, isLoading: false, isError: false, refetch: vi.fn() }),
  useProjects: () => ({ data: [{ id: 'p1', slug: 'web', name: 'web' }] }),
  useSearch: () => ({ data: state.hits, isLoading: false }),
  useKnowledgeDocs: () => ({ data: state.docs, isLoading: false, isError: false, refetch: vi.fn() }),
  useCapabilities: () => ({ data: state.capabilities, isLoading: false, isError: false }),
  useSpecChanges: () => ({ data: [], isLoading: false, isError: false }),
  useCapability: () => ({ data: null, isLoading: false, isError: false }),
  useSpecChange: () => ({ data: null, isLoading: false, isError: true }),
  useProjectArtifacts: () => ({ data: state.artifacts, isLoading: false }),
  useWorkspaceArtifacts: () => ({ data: state.weaverArtifacts, isLoading: false }),
  useTicketDocumentRevisions: () => ({ data: [] }),
  useKnowledgeDoc: () => ({ data: null, isLoading: false, refetch: vi.fn() }),
  useKnowledgeRevisions: () => ({ data: [] }),
  useKnowledgeMutation: () => ({ mutate: vi.fn() }),
  useKnowledgeDocDetail: () => ({ data: state.docDetail, isLoading: false, isError: state.docDetail === null }),
  useKnowledgeDocMutation: () => ({ mutate: vi.fn() }),
  useKnowledgeMoveDoc: () => ({ mutate: vi.fn() }),
}));

const { KnowledgeHome } = await import('../v2/knowledge/KnowledgeHome');

const KB_WORKSPACE = {
  id: 'w1', workspaceId: 'acme', projectId: null, path: 'WORKSPACE.md', scope: 'workspace',
  tokenEstimate: 4100, budgetTokens: 16000, lastCuratedAt: '2026-09-12T00:00:00Z', curationPending: false,
  curationDueInDays: 6, hash: 'a', updatedAt: '2026-09-12T00:00:00Z',
};
const KB_PROJECT = {
  id: 'h1', workspaceId: 'acme', projectId: 'p1', path: 'projects/web/PROJECT.md', scope: 'project',
  tokenEstimate: 11600, budgetTokens: 12000, lastCuratedAt: null, curationPending: true,
  projectSlug: 'web', hash: 'b', updatedAt: '2026-09-12T00:00:00Z',
};
const DOC: KnowledgeDocSummary = {
  path: 'projects/web/docs/theming.md', scope: 'project', projectId: 'p1', projectSlug: 'web',
  slug: 'theming', folder: null, title: 'Theming decisions', summary: 'What the theme does.',
  tokenEstimate: 50, budgetTokens: 10000, links: 0, backlinks: 1, updatedAt: '2026-09-12T00:00:00Z',
};
const DOC_DETAIL: KnowledgeDocDetail = {
  ...DOC, body: '# Theming\n\nThe theme carries one accent.', revision: 2, linksTo: [], linkedFrom: [],
};

const TICKET_ARTIFACT = {
  id: 'wp1', ticketId: 'tk1', ticketIdentifier: 'ACME-42', ticketTitle: 'Add dark mode',
  key: 'overview', title: 'Theming explainer', metadata: { kind: 'diagram' },
  url: '/api/w/acme/tickets/tk1/artifacts/overview/raw', previewable: true, updatedAt: '2026-09-12T00:00:00Z',
};
const WEAVER_ARTIFACT = { key: 'plan', title: 'Workspace overview', kind: 'plan', revision: 1, updatedAt: '2026-09-12T00:00:00Z' };

beforeEach(() => {
  state.files = [KB_WORKSPACE, KB_PROJECT];
  state.hits = [];
  state.docs = [];
  state.docDetail = null;
  state.capabilities = [];
  state.artifacts = [];
  state.weaverArtifacts = [];
});

describe('the V2 Knowledge tab', () => {
  it('lists every knowledge base with its hue, meter and curation line', () => {
    render(<KnowledgeHome />);
    expect(screen.getByText('Knowledge bases')).toBeInTheDocument();
    expect(screen.getByText('WORKSPACE.md')).toBeInTheDocument();
    expect(screen.getByText('web')).toBeInTheDocument();
    // Workspace hub: 4.1k of 16k, curated and due in 6 days.
    expect(screen.getByText(/4\.1k \/ 16k tok/)).toBeInTheDocument();
    expect(screen.getByText(/curated .* ago · next in 6d/)).toBeInTheDocument();
    // Project hub: 11.6k of 12k, curation due.
    expect(screen.getByText(/11\.6k \/ 12k tok/)).toBeInTheDocument();
    expect(screen.getByText('curation due')).toBeInTheDocument();
  });

  it('lists a seeded hub\u2019s documents and opens one to read it', () => {
    state.docs = [DOC];
    state.docDetail = DOC_DETAIL;
    render(<KnowledgeHome />);

    fireEvent.click(screen.getByText('Theming decisions'));
    // The document panel renders the linked page's own path and body.
    expect(screen.getByText('projects/web/docs/theming.md')).toBeInTheDocument();
    expect(screen.getByText(/The theme carries one accent/)).toBeInTheDocument();
  });

  it('returns knowledge and spec hits for one query', () => {
    state.hits = [
      { kind: 'knowledge', projectId: 'p1', projectSlug: 'web', title: 'Theming decisions', subtitle: null, href: {} },
      { kind: 'capability', projectId: 'p1', projectSlug: 'web', title: 'theming', subtitle: null, href: {} },
    ];
    render(<KnowledgeHome />);
    fireEvent.change(screen.getByLabelText('Search knowledge, specs and artifacts'), { target: { value: 'theming' } });

    expect(screen.getByText('Theming decisions')).toBeInTheDocument();
    expect(screen.getByText('theming')).toBeInTheDocument();
  });

  it('no longer mixes the specs list into the Knowledge tab', () => {
    state.capabilities = [
      { id: 'c1', capability: 'auth', title: null, requirementCount: 1, lastArchivedChange: null, updatedAt: '', pendingChanges: [] },
    ];
    render(<KnowledgeHome />);
    expect(screen.queryByText('Capabilities')).toBeNull();
    expect(screen.queryByText('auth')).toBeNull();
  });

  it('opens a ticket artifact in place, through its ticket-scoped raw route', () => {
    state.artifacts = [TICKET_ARTIFACT];
    render(<KnowledgeHome />);

    fireEvent.click(screen.getByText('Theming explainer'));
    expect(screen.getByTitle('Theming explainer').tagName).toBe('IFRAME');
  });

  it('links a workspace artifact to its own reader address', () => {
    state.weaverArtifacts = [WEAVER_ARTIFACT];
    render(<KnowledgeHome />);

    expect(screen.getByRole('link', { name: /Workspace overview/ })).toHaveAttribute('href', '/v2/w/acme/artifacts/plan');
  });
});
