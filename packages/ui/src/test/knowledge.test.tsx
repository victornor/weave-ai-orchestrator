import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CapabilityDetail, CapabilitySummary, SpecChangeDetail, SpecChangeSummary } from '../api/types';

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

const state = vi.hoisted(() => ({ change: {} as Record<string, unknown>, capabilityArgs: [] as string[] }));

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
  useCapabilities: () => ({ data: [CAPABILITY], isLoading: false, isError: false, refetch: vi.fn() }),
  useCapability: (project: string, capability: string) => {
    state.capabilityArgs = [project, capability];
    return { data: CAPABILITY_DETAIL, isLoading: false, isError: false };
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

beforeEach(() => {
  state.change = { ...ARCHIVED };
  state.capabilityArgs = [];
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
