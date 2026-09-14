/**
 * VS-371: the V2 Specs tab — the project's OpenSpec capabilities and the changes that shaped them,
 * with the one-line explanation, moved off the Knowledge home.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CapabilityDetail, CapabilitySummary, SpecChangeSummary } from '../api/types';

const state = vi.hoisted(() => ({
  search: {} as Record<string, string | undefined>,
  capabilities: [] as CapabilitySummary[],
  changes: [] as SpecChangeSummary[],
  capability: null as CapabilityDetail | null,
  change: null as unknown,
}));

vi.mock('../api/context', () => ({ useWs: () => 'ws1' }));
vi.mock('../app/link', () => ({
  A: ({ children }: { children?: React.ReactNode }) => <a href="#">{children}</a>,
  useSearchParams: () => state.search,
  useGo: () => vi.fn(),
}));
vi.mock('../api/hooks', () => ({
  useProjects: () => ({ data: [{ id: 'p1', slug: 'web', name: 'web' }] }),
  useCapabilities: () => ({ data: state.capabilities, isLoading: false, isError: false }),
  useSpecChanges: () => ({ data: state.changes, isLoading: false, isError: false }),
  useCapability: () => ({ data: state.capability, isLoading: false, isError: state.capability === null }),
  useSpecChange: () => ({ data: state.change, isLoading: false, isError: state.change === null }),
}));

const { KnowledgeSpecsPage } = await import('../v2/knowledge/KnowledgeSpecs');

beforeEach(() => {
  state.search = { project: 'p1' };
  state.capabilities = [];
  state.changes = [];
  state.capability = null;
  state.change = null;
});

describe('the V2 Specs tab', () => {
  it('explains what specs are and lists the project\u2019s capabilities and changes', () => {
    state.capabilities = [
      { id: 'c1', capability: 'auth', title: null, requirementCount: 2, lastArchivedChange: null, updatedAt: '', pendingChanges: [] },
    ];
    state.changes = [
      {
        changeName: 'acme-1-login', state: 'archived', ticketId: 't1', ticketIdentifier: 'ACME-1',
        createdAt: '2026-08-01T00:00:00Z', archivedAt: '2026-09-01T00:00:00Z', capabilities: [],
        taskProgress: { done: 3, total: 3 },
      },
    ];
    render(<KnowledgeSpecsPage />);
    expect(screen.getByText(/Specs are this project's OpenSpec capabilities/)).toBeInTheDocument();
    expect(screen.getByText('auth')).toBeInTheDocument();
    expect(screen.getByText('Changes')).toBeInTheDocument();
    expect(screen.getByText('acme-1-login')).toBeInTheDocument();
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
    render(<KnowledgeSpecsPage />);

    fireEvent.click(screen.getByText('auth').closest('button')!);
    expect(screen.getByText('The system SHALL accept an email and password.')).toBeInTheDocument();
    expect(screen.getByText('Change history')).toBeInTheDocument();
    expect(screen.getByText('acme-1-login')).toBeInTheDocument();
  });

  it('renders its view again after a remount', () => {
    state.capabilities = [
      { id: 'c1', capability: 'auth', title: null, requirementCount: 1, lastArchivedChange: null, updatedAt: '', pendingChanges: [] },
    ];
    const { unmount } = render(<KnowledgeSpecsPage />);
    expect(screen.getByText('auth')).toBeInTheDocument();
    unmount();
    render(<KnowledgeSpecsPage />);
    expect(screen.getByText('auth')).toBeInTheDocument();
  });
});
