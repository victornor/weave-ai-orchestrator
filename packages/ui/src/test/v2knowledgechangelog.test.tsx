/**
 * VS-371: the V2 Knowledge Changelog tab — the same timeline the V2 Changelog screen renders, scoped
 * to the Knowledge tab's chosen project.
 */
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChangelogEntry } from '../api/types';

const state = vi.hoisted(() => ({
  search: {} as Record<string, string | undefined>,
  entries: [] as ChangelogEntry[],
  project: undefined as string | undefined,
}));

vi.mock('../api/context', () => ({ useWs: () => 'ws1' }));
vi.mock('../app/link', () => ({
  A: ({ children }: { children?: React.ReactNode }) => <a href="#">{children}</a>,
  useSearchParams: () => state.search,
  useGo: () => vi.fn(),
}));
vi.mock('../api/hooks', () => ({
  useWorkspaces: () => ({ data: [] }),
  useWorkers: () => ({ data: [] }),
  useIncidents: () => ({ data: { items: [] } }),
  readerTimezone: () => 'UTC',
  useChangelog: (project?: string) => {
    state.project = project;
    return { data: state.entries, isLoading: false, isError: false, hasOlder: false, isLoadingOlder: false, loadOlder: vi.fn(), loadUntil: vi.fn(async () => undefined) };
  },
  useChangelogHeatmap: () => ({ data: undefined, isLoading: false }),
}));

const { KnowledgeChangelogPage } = await import('../v2/knowledge/KnowledgeChangelogPage');

beforeEach(() => {
  state.search = {};
  state.entries = [];
  state.project = undefined;
});

describe('the V2 Knowledge Changelog tab', () => {
  it('renders the project-scoped record', () => {
    state.search = { project: 'p1' };
    state.entries = [
      {
        id: 'e1', at: '2026-09-02T10:00:00.000Z', kind: 'landed', actor: { kind: 'human', id: 'v', label: 'the owner' },
        projectId: 'p1', ticketId: 't1', ticketIdentifier: 'ACME-1', summary: 'Landed: dark mode', link: null,
      },
    ];
    render(<KnowledgeChangelogPage />);
    expect(screen.getByText('Landed: dark mode')).toBeInTheDocument();
    expect(state.project).toBe('p1');
  });

  it('is workspace-wide with no project chosen, and renders again after a remount', () => {
    state.entries = [
      {
        id: 'e1', at: '2026-09-02T10:00:00.000Z', kind: 'filed', actor: { kind: 'human', id: 'v', label: 'the owner' },
        projectId: 'p1', ticketId: null, ticketIdentifier: null, summary: 'Filed: a thing', link: null,
      },
    ];
    const { unmount } = render(<KnowledgeChangelogPage />);
    expect(screen.getByText('Filed: a thing')).toBeInTheDocument();
    expect(state.project).toBeUndefined();
    unmount();
    render(<KnowledgeChangelogPage />);
    expect(screen.getByText('Filed: a thing')).toBeInTheDocument();
  });
});
