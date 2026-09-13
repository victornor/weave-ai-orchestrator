/** The V2 Knowledge home (VS-347): the knowledge-base list with its meters, the cross-knowledge/spec
 * search and its kind filters, and the capability drill-down. Hooks and the router are mocked. */
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type { CapabilityDetail, CapabilitySummary, SearchHit, SpecChangeSummary, TicketArtifactSummary, WeaverArtifactSummary } from '../api/types';

const state = vi.hoisted(() => ({
  files: [] as Array<Record<string, unknown>>,
  hits: [] as SearchHit[],
  capabilities: [] as CapabilitySummary[],
  changes: [] as SpecChangeSummary[],
  capability: null as CapabilityDetail | null,
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
  useCapabilities: () => ({ data: state.capabilities, isLoading: false, isError: false }),
  useSpecChanges: () => ({ data: state.changes, isLoading: false, isError: false }),
  useCapability: () => ({ data: state.capability, isLoading: false, isError: false }),
  useSpecChange: () => ({ data: null, isLoading: false, isError: true }),
  useProjectArtifacts: () => ({ data: state.artifacts, isLoading: false }),
  useWorkspaceArtifacts: () => ({ data: state.weaverArtifacts, isLoading: false }),
  useTicketDocumentRevisions: () => ({ data: [] }),
  useKnowledgeDoc: () => ({ data: null, isLoading: false, refetch: vi.fn() }),
  useKnowledgeRevisions: () => ({ data: [] }),
  useKnowledgeMutation: () => ({ mutate: vi.fn() }),
  useKnowledgeDocDetail: () => ({ data: null, isLoading: false, isError: true }),
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

const TICKET_ARTIFACT = {
  id: 'wp1', ticketId: 'tk1', ticketIdentifier: 'ACME-42', ticketTitle: 'Add dark mode',
  key: 'overview', title: 'Theming explainer', metadata: { kind: 'diagram' },
  url: '/api/w/acme/tickets/tk1/artifacts/overview/raw', previewable: true, updatedAt: '2026-09-12T00:00:00Z',
};
const WEAVER_ARTIFACT = { key: 'plan', title: 'Workspace overview', kind: 'plan', revision: 1, updatedAt: '2026-09-12T00:00:00Z' };

beforeEach(() => {
  state.files = [KB_WORKSPACE, KB_PROJECT];
  state.hits = [];
  state.capabilities = [];
  state.changes = [];
  state.capability = null;
  state.artifacts = [];
  state.weaverArtifacts = [];
});

describe('the V2 Knowledge home', () => {
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

  it('returns knowledge and spec hits for one query, and the chips narrow them', () => {
    state.hits = [
      { kind: 'knowledge', projectId: 'p1', projectSlug: 'web', title: 'Theming decisions', subtitle: null, href: {} },
      { kind: 'capability', projectId: 'p1', projectSlug: 'web', title: 'theming', subtitle: null, href: {} },
    ];
    render(<KnowledgeHome />);
    fireEvent.change(screen.getByLabelText('Search knowledge, specs and artifacts'), { target: { value: 'theming' } });

    expect(screen.getByText('Theming decisions')).toBeInTheDocument();
    expect(screen.getByText('theming')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Knowledge' }));
    expect(screen.getByText('Theming decisions')).toBeInTheDocument();
    expect(screen.queryByText('theming')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Specs' }));
    expect(screen.queryByText('Theming decisions')).toBeNull();
    expect(screen.getByText('theming')).toBeInTheDocument();
  });

  it('opens a capability into its page with requirements and change history', () => {
    state.capabilities = [
      { id: 'c1', capability: 'auth', title: null, requirementCount: 1, lastArchivedChange: null, updatedAt: '', pendingChanges: [] },
    ];
    state.capability = {
      id: 'c1', capability: 'auth', title: null, body: '',
      requirements: [{ name: 'Login', text: 'The system SHALL accept an email and password.', scenarios: [] }],
      pending: [],
      history: [{ changeName: 'acme-1-login', ticketId: null, ticketIdentifier: 'ACME-1', state: 'archived', archivedAs: null, archivedAt: null }],
    };
    render(<KnowledgeHome />);

    fireEvent.click(screen.getByText('auth').closest('button')!);
    expect(screen.getByText('The system SHALL accept an email and password.')).toBeInTheDocument();
    expect(screen.getByText('Change history')).toBeInTheDocument();
    expect(screen.getByText('acme-1-login')).toBeInTheDocument();
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
