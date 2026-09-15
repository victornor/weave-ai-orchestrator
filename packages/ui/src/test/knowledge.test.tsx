import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CapabilityDetail, CapabilitySummary, SpecChangeDetail, SpecChangeSummary } from '../api/types';
import { eventually } from './eventually';

/** The archived change exactly as `GET /specs/:project/changes/:name` returns it (core `getChange`). */
const ARCHIVED: SpecChangeDetail = {
  changeName: 'tst-1-login',
  state: 'archived',
  ticketId: null,
  ticketIdentifier: null,
  createdAt: null,
  archivedAt: '2026-08-01T00:00:00.000Z',
  capabilities: [{ capability: 'auth', deltaKind: 'added' }],
  taskProgress: { done: 1, total: 2 },
  proposal: '## Why\nPeople need to sign in.\n',
  design: null,
  tasks: [
    { text: 'add the login form', done: true },
    { text: 'wire the session cookie', done: false },
  ],
  deltas: [{ capability: 'auth', kind: 'added', body: '## ADDED Requirements\nThe system SHALL accept an email and password.\n' }],
};

/** The capability list entry as `GET /specs/:project` returns it (core `listCapabilities`). */
const CAPABILITY: CapabilitySummary = {
  id: 'cap1',
  capability: 'conductor-chat/dispatch-labels',
  title: 'Dispatch labels',
  requirementCount: 2,
  lastArchivedChange: 'tst-1-login',
  pendingChanges: [],
  updatedAt: '2026-08-01T00:00:00.000Z',
};

/** The detail as `GET /specs/:project/capabilities/:capability` returns it (core `getCapability`). */
const CAPABILITY_DETAIL: CapabilityDetail = {
  id: 'cap1',
  capability: 'conductor-chat/dispatch-labels',
  title: 'Dispatch labels',
  body: '# dispatch-labels Specification\n',
  requirements: [
    { name: 'Anchored labels', text: 'The label SHALL stay anchored to its message.', scenarios: [{ steps: [{ word: 'WHEN', text: 'the transcript scrolls' }] }] },
    { name: 'Dispatch caption', text: 'The caption SHALL name the role.', scenarios: [] },
  ],
  pending: [],
  history: [
    { changeName: 'tst-1-login', ticketId: 'tk_1', ticketIdentifier: 'TST-1', state: 'archived', archivedAs: '2026-08-01-tst-1-login', archivedAt: '2026-08-01T00:00:00.000Z' },
  ],
};

/** The same capability while an active change is about to rewrite it (core fills `delta` per requirement). */
const CAPABILITY_PENDING: CapabilityDetail = {
  ...CAPABILITY_DETAIL,
  requirements: [
    { ...CAPABILITY_DETAIL.requirements[0]!, delta: { kind: 'MODIFIED', changeName: 'tst-3-labels', ticketIdentifier: 'TST-3', state: 'pending' } },
    { ...CAPABILITY_DETAIL.requirements[1]!, delta: { kind: 'REMOVED', changeName: 'tst-3-labels', ticketIdentifier: 'TST-3', state: 'pending' } },
    { name: 'Label tooltip', text: 'The label SHALL carry a tooltip.', scenarios: [], delta: { kind: 'ADDED', changeName: 'tst-3-labels', ticketIdentifier: null, state: 'pending' } },
  ],
  pending: [{ changeName: 'tst-3-labels', ticketId: 'tk_3', ticketIdentifier: 'TST-3', deltaKind: 'modified' }],
};

const state = vi.hoisted(() => ({
  change: {} as Record<string, unknown>,
  capabilityArgs: [] as string[],
  capability: null as CapabilityDetail | null,
  // The route reads `?project=` and `?tab=` off the URL (VS-95).
  url: {} as Record<string, string | undefined>,
}));

vi.mock('../api/context', () => ({ useWs: () => 'ws1', useHookWs: (o?: string) => o ?? 'ws1' }));
vi.mock('../app/link', () => ({
  useSearchParams: () => state.url,
  A: ({ to, children, ...rest }: { to: string; children?: React.ReactNode }) => <a href={to} {...rest}>{children}</a>,
}));

vi.mock('../api/hooks', () => ({
  useProjects: () => ({ data: [{ id: 'p1', slug: 'api' }] }),
  useSearch: () => ({ data: [], isLoading: false }),
  useKnowledgeIndex: () => ({ data: { files: [] }, isLoading: false, isError: false, refetch: vi.fn() }),
  useKnowledgeDoc: () => ({ data: null, isLoading: false }),
  useKnowledgeRevisions: () => ({ data: [] }),
  useKnowledgeMutation: () => ({ mutate: vi.fn() }),
  useKnowledgeDocs: () => ({ data: [], isLoading: false }),
  useKnowledgeDocDetail: () => ({ data: null, isLoading: false }),
  useKnowledgeDocMutation: () => ({ mutate: vi.fn() }),
  useKnowledgeGraph: () => ({ data: { nodes: [], edges: [] }, isLoading: false }),
  // The Changelog tab lives in this route now; the mock is wholesale, so it needs these too.
  useChangelog: () => ({ data: [], isLoading: false, isError: false, hasOlder: false, isLoadingOlder: false, loadOlder: vi.fn(), loadUntil: vi.fn() }),
  useChangelogHeatmap: () => ({ data: undefined, isLoading: false }),
  readerTimezone: () => 'UTC',
  useCapabilities: () => ({ data: [CAPABILITY], isLoading: false, isError: false, refetch: vi.fn() }),
  useCapability: (project: string, capability: string) => {
    state.capabilityArgs = [project, capability];
    return { data: state.capability, isLoading: false, isError: !state.capability };
  },
  useSpecGraph: () => ({ data: { nodes: [], edges: [] }, isLoading: false }),
  useSpecChanges: () => ({ data: [{ ...ARCHIVED } as unknown as SpecChangeSummary], isLoading: false, isError: false }),
  useSpecChange: () => ({ data: state.change, isLoading: false, isError: false }),
}));

const { KnowledgeRoute } = await import('../routes/Knowledge');

/** Specs tab → the changes list → the archived change. */
function openArchivedChange(): void {
  render(<KnowledgeRoute />);
  fireEvent.click(screen.getByRole('tab', { name: 'Specs' }));
  fireEvent.click(screen.getByText('tst-1-login'));
}

/** Specs tab → the capability list → the capability page. */
function openCapability(): void {
  render(<KnowledgeRoute />);
  fireEvent.click(screen.getByRole('tab', { name: 'Specs' }));
  fireEvent.click(screen.getByText('conductor-chat/dispatch-labels'));
}

beforeEach(() => {
  state.change = { ...ARCHIVED };
  state.capabilityArgs = [];
  state.capability = CAPABILITY_DETAIL;
  state.url = {};
});

describe('Knowledge — archived change page', () => {
  it('renders tasks with progress, the proposal and the archived spec deltas', () => {
    openArchivedChange();
    expect(screen.getByText(/Tasks · 1\/2/)).toBeInTheDocument();
    expect(screen.getByText('add the login form')).toBeInTheDocument();
    expect(screen.getByText('wire the session cookie')).toBeInTheDocument();
    expect(screen.getByText('Proposal')).toBeInTheDocument();
    expect(screen.getByText(/People need to sign in/)).toBeInTheDocument();
    expect(screen.getByText('added · auth')).toBeInTheDocument();
  });

  it('does not throw when a change carries no tasks or deltas', () => {
    state.change = { ...ARCHIVED, tasks: undefined, deltas: undefined, design: null };
    openArchivedChange();
    expect(screen.getByText(/Tasks · 0\/0/)).toBeInTheDocument();
  });
});

describe('Knowledge — graph tab', () => {
  it('does not load the graph renderer until its tab is opened', async () => {
    render(<KnowledgeRoute />);
    expect(screen.queryByLabelText('Search the graph')).toBeNull();

    fireEvent.click(screen.getAllByRole('tab', { name: 'Graph' })[0]!);

    // The graph renderer is a separate `lazy()` chunk; `findByText`'s one-second wall clock was the
    // flake under a loaded suite (VS-446), so wait without a stopwatch.
    await eventually(() => expect(screen.getByText('Nothing to draw yet.')).toBeInTheDocument());
  });
});

describe('Knowledge — nested capability page', () => {
  it('opens a nested capability by its full id and renders its requirements and change history', () => {
    render(<KnowledgeRoute />);
    fireEvent.click(screen.getByRole('tab', { name: 'Specs' }));
    fireEvent.click(screen.getByText('conductor-chat/dispatch-labels'));

    expect(state.capabilityArgs[1]).toBe('conductor-chat/dispatch-labels');
    expect(screen.getByText('Anchored labels')).toBeInTheDocument();
    expect(screen.getByText('The label SHALL stay anchored to its message.')).toBeInTheDocument();
    expect(screen.getByText('Dispatch caption')).toBeInTheDocument();
    expect(screen.getByText('Change history')).toBeInTheDocument();
    expect(screen.getByText('TST-1')).toBeInTheDocument();
    expect(screen.getByText('archived')).toBeInTheDocument();
  });
});

describe('Knowledge — pending deltas on a capability', () => {
  it('marks the requirements an active change is about to modify, remove and add', () => {
    state.capability = CAPABILITY_PENDING;
    openCapability();
    expect(screen.getByText('MODIFIED')).toBeInTheDocument();
    expect(screen.getByText('REMOVED')).toBeInTheDocument();
    expect(screen.getByText('ADDED')).toBeInTheDocument();
    expect(screen.getAllByText('TST-3 · pending')).toHaveLength(2);
    expect(screen.getByText('tst-3-labels · pending')).toBeInTheDocument();   // no ticket yet: the change name stands in
    expect(screen.getByText('The label SHALL carry a tooltip.')).toBeInTheDocument();
  });

  it('marks nothing when no active change touches the capability', () => {
    openCapability();
    expect(screen.getByText('Anchored labels')).toBeInTheDocument();
    expect(screen.queryByText('MODIFIED')).not.toBeInTheDocument();
    expect(screen.queryByText('ADDED')).not.toBeInTheDocument();
    expect(screen.queryByText(/· pending/)).not.toBeInTheDocument();
  });
});

/**
 * VS-95: the project overview links into this area, so it has to be able to arrive at a project's
 * changelog or knowledge rather than at the workspace's.
 */
describe('the address', () => {
  it('opens the tab the URL names', () => {
    state.url = { tab: 'changelog' };
    render(<KnowledgeRoute />);
    expect(screen.getByRole('tab', { name: 'Changelog' }).getAttribute('aria-selected')).toBe('true');
  });

  it('selects the project the URL names', () => {
    state.url = { project: 'p1' };
    render(<KnowledgeRoute />);
    expect((screen.getByLabelText('Project') as HTMLSelectElement).value).toBe('p1');
  });

  it('ignores a tab name it does not have, rather than showing nothing', () => {
    state.url = { tab: 'nonsense' };
    render(<KnowledgeRoute />);
    expect(screen.getByRole('tab', { name: 'Knowledge' }).getAttribute('aria-selected')).toBe('true');
  });

  it('still switches tabs on a click, without the URL having changed', () => {
    render(<KnowledgeRoute />);
    fireEvent.click(screen.getByRole('tab', { name: 'Specs' }));
    expect(screen.getByRole('tab', { name: 'Specs' }).getAttribute('aria-selected')).toBe('true');
  });
});
