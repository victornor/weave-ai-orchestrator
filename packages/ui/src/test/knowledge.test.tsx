import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SpecChangeDetail, SpecChangeSummary } from '../api/types';

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
const CAPABILITY = {
  id: 'cap1',
  capability: 'auth',
  title: 'Auth',
  requirementCount: 2,
  lastArchivedChange: 'tst-1-login',
  pendingChanges: [],
  updatedAt: '2026-08-01T00:00:00.000Z',
};

const state = vi.hoisted(() => ({ change: {} as Record<string, unknown> }));

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
  useCapability: () => ({ data: null, isLoading: false, isError: true }),
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
