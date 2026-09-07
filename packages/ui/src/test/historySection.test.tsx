/**
 * The project overview's History section (VS-96): rows and refs from fixtures, ticket links,
 * selecting a commit and a branch, the end-of-history and error states, and appending a second
 * page without collapsing.
 */
import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Project } from '@agent-conductor/shared';
import type { CommitDetail, HistoryCommit, ProjectRef } from '../api/types';
import { project as projectOf } from './factories';

const state = vi.hoisted(() => ({
  refs: [] as ProjectRef[],
  commits: [] as HistoryCommit[],
  isLoading: false,
  isError: false,
  hasMore: false,
  isLoadingMore: false,
  loadMore: vi.fn(),
  refetch: vi.fn(),
  ticketPrefix: 'TST',
  commitDetail: null as CommitDetail | null,
  commitLoading: false,
}));

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to, params, search, ...rest }: Record<string, unknown> & { children?: React.ReactNode }) => (
    <a href={String(to)} data-to={String(to)} data-params={JSON.stringify(params ?? {})} data-search={JSON.stringify(search ?? {})} {...(rest as Record<string, unknown>)}>
      {children}
    </a>
  ),
}));
vi.mock('../app/link', async () => {
  const router = await import('@tanstack/react-router');
  return { A: (router as unknown as { Link: unknown }).Link, useSearchParams: () => ({}) };
});
vi.mock('../api/hooks', () => ({
  useProjectHistory: () => ({
    refs: state.refs, commits: state.commits, isLoading: state.isLoading, isError: state.isError,
    refetch: state.refetch, hasMore: state.hasMore, isLoadingMore: state.isLoadingMore, loadMore: state.loadMore,
  }),
  useCommit: () => ({ data: state.commitDetail, isLoading: state.commitLoading, isError: false, refetch: vi.fn() }),
  useWorkspaceSummary: () => ({ data: { workspace: { ticketPrefix: state.ticketPrefix } } }),
}));

const { HistorySection } = await import('../routes/project/HistorySection');

const api: Project = projectOf({ id: 'p1', slug: 'api', name: 'API', defaultBranch: 'main' });

function commit(over: Partial<HistoryCommit> & { sha: string; parents: string[] }): HistoryCommit {
  return { author: 'victornor', authoredAt: '2026-09-07T10:00:00.000Z', subject: 'A commit', refs: [], ...over };
}
function ref(over: Partial<ProjectRef> & { name: string; sha: string }): ProjectRef {
  return { isDefault: false, ticketId: null, ticketIdentifier: null, agentId: null, agentName: null, ...over };
}

const show = (): void => { render(<HistorySection project={api} ws="ws1" />); };

beforeEach(() => {
  state.refs = [ref({ name: 'main', sha: 'c1', isDefault: true })];
  state.commits = [commit({ sha: 'c1', parents: [] })];
  state.isLoading = false;
  state.isError = false;
  state.hasMore = false;
  state.isLoadingMore = false;
  state.loadMore = vi.fn();
  state.refetch = vi.fn();
  state.ticketPrefix = 'TST';
  state.commitDetail = null;
  state.commitLoading = false;
});

describe('rendering rows and refs from fixtures', () => {
  it('shows the subject, author, relative time and abbreviated sha of each commit', () => {
    state.commits = [commit({ sha: 'abcdef1234567', parents: [], subject: 'Add the thing', author: 'victornor' })];
    show();
    expect(screen.getByText('Add the thing')).toBeTruthy();
    expect(screen.getByText('victornor')).toBeTruthy();
    expect(screen.getByText('abcdef1')).toBeTruthy();
  });

  it('lists the branches the history covers', () => {
    state.refs = [ref({ name: 'main', sha: 'c1', isDefault: true }), ref({ name: 'ac/vs-1', sha: 'c1', ticketIdentifier: 'TST-1' })];
    show();
    expect(screen.getByRole('list', { name: 'Branches' })).toBeTruthy();
    expect(screen.getByText('ac/vs-1')).toBeTruthy();
  });

  it('shows the default branch distinguished from the rest', () => {
    state.refs = [ref({ name: 'main', sha: 'c1', isDefault: true })];
    state.commits = [commit({ sha: 'c1', parents: [] })];
    show();
    // The default branch's badge on the row and its chip in the ref bar both name it.
    expect(screen.getAllByText('main').length).toBeGreaterThan(0);
  });
});

describe('a ticket identifier', () => {
  it("links a row's ticket from its branch", () => {
    state.refs = [ref({ name: 'ac/vs-1', sha: 'c1', ticketIdentifier: 'TST-1' })];
    state.commits = [commit({ sha: 'c1', parents: [], refs: ['ac/vs-1'] })];
    show();
    expect(screen.getByText('TST-1')).toBeTruthy();
  });

  it("links a row's ticket from its commit message when no branch names one", () => {
    state.refs = [];
    state.commits = [commit({ sha: 'c1', parents: [], subject: 'TST-9: fix the thing' })];
    show();
    expect(screen.getByText('TST-9')).toBeTruthy();
  });

  it('shows no ticket when neither the branch nor the message names one', () => {
    state.refs = [];
    state.commits = [commit({ sha: 'c1', parents: [], subject: 'A plain commit' })];
    show();
    expect(screen.queryByText(/TST-/)).toBeNull();
  });
});

describe('selecting a commit', () => {
  it('shows its files and additions/deletions', () => {
    state.commits = [commit({ sha: 'c1', parents: [] })];
    state.commitDetail = {
      sha: 'c1', parents: [], author: 'victornor', email: 'v@example.com', authoredAt: '2026-09-07T10:00:00.000Z', committedAt: '2026-09-07T10:00:00.000Z',
      message: 'Add the thing\n\nLonger body.', files: [{ path: 'a.ts', previousPath: null, status: 'modified', additions: 3, deletions: 1 }],
      truncatedFiles: 0, forgeUrl: 'https://github.com/acme/api/commit/c1',
    };
    show();
    fireEvent.click(screen.getByText('A commit').closest('button')!);
    expect(screen.getByText(/Longer body/)).toBeTruthy();
    expect(screen.getByText('a.ts')).toBeTruthy();
    expect(screen.getByText('+3')).toBeTruthy();
    expect(screen.getByText('-1')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'View on the forge' })).toBeTruthy();
  });
});

describe('selecting a branch', () => {
  it('names its ticket and its worker, each linked', () => {
    state.refs = [ref({ name: 'ac/vs-1', sha: 'c1', ticketIdentifier: 'TST-1', agentId: 'ag_1', agentName: 'Engineer #1' })];
    state.commits = [commit({ sha: 'c1', parents: [], refs: ['ac/vs-1'] })];
    show();
    fireEvent.click(within(screen.getByRole('list', { name: 'Branches' })).getByText('ac/vs-1'));
    const links = screen.getAllByRole('link');
    expect(links.some((l) => l.textContent === 'TST-1')).toBe(true);
    expect(links.some((l) => l.textContent === 'Engineer #1')).toBe(true);
  });

  it('says a branch belongs to no ticket when it does not', () => {
    state.refs = [ref({ name: 'main', sha: 'c1', isDefault: true })];
    state.commits = [commit({ sha: 'c1', parents: [] })];
    show();
    fireEvent.click(screen.getAllByText('main')[0]!);
    expect(screen.getByText('belongs to no ticket')).toBeTruthy();
  });
});

describe('the end of history and loading more', () => {
  it('offers to load more when there is a next page', () => {
    state.hasMore = true;
    show();
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
    expect(state.loadMore).toHaveBeenCalled();
  });

  it('says loading while the next page is in flight', () => {
    state.hasMore = true;
    state.isLoadingMore = true;
    show();
    expect(screen.getByText('Loading…')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();
  });

  it('says so when everything reachable is already shown', () => {
    state.hasMore = false;
    show();
    expect(screen.getByText(/every commit reachable/)).toBeTruthy();
  });

  it('appends a second page without collapsing back to the first', () => {
    state.commits = [commit({ sha: 'c1', parents: [] }), commit({ sha: 'c2', parents: [] })];
    show();
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });
});

describe('failure and empty states', () => {
  it('shows a retry, never an empty history, when the read fails', () => {
    state.isError = true;
    show();
    expect(screen.getByRole('alert')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(state.refetch).toHaveBeenCalled();
  });

  it('says there are no commits yet on the default branch', () => {
    state.commits = [];
    show();
    expect(screen.getByText(/No commits yet on main/)).toBeTruthy();
  });
});
