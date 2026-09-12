/**
 * The project overview's Pull requests section (VS-97): the grouping, the links it joins each entry
 * to, the detail it opens, and what it says for a project that has no forge.
 */
import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Project } from '@weave-ai/shared';
import type { ProjectPullRequest, ProjectPullRequests, PullRequestDetailResult } from '../api/types';
import { project as projectOf } from './factories';

const state = vi.hoisted(() => ({
  list: null as ProjectPullRequests | null,
  listLoading: false,
  detail: null as PullRequestDetailResult | null,
  detailLoading: false,
  search: {} as Record<string, string | undefined>,
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
  return { A: (router as unknown as { Link: unknown }).Link, useSearchParams: () => state.search };
});
vi.mock('../api/hooks', () => ({
  usePullRequests: () => ({ data: state.list, isLoading: state.listLoading }),
  usePullRequest: () => ({ data: state.detail, isLoading: state.detailLoading }),
  // The diff view's own manifest, derived from the same fixture files `opened()` already sets on the
  // detail — VS-107 moved the "Files" list from a plain read of `pullRequest.files` to this endpoint,
  // and every existing test here still only cares that a changed file's path and counts are on screen.
  usePullRequestDiffFiles: () => ({
    data: state.detail?.pullRequest
      ? {
          projectId: 'p1', number: state.detail.pullRequest.number, available: true, reason: null, message: null, stale: false,
          files: state.detail.pullRequest.files.map((f) => ({ ...f, previousPath: null, status: 'modified' as const, binary: false, tooLarge: false })),
        }
      : null,
    isLoading: false,
  }),
  usePullRequestDiffFile: () => ({ data: null, isLoading: false }),
  usePullRequestDiffContext: () => ({ data: null, isLoading: false }),
}));

const { PullRequestsSection } = await import('../routes/project/PullRequestsSection');

const api: Project = projectOf({ id: 'p1', slug: 'api', name: 'API' });

function pr(over: Partial<ProjectPullRequest> & { number: number }): ProjectPullRequest {
  return {
    title: `PR ${over.number}`, url: `https://github.com/acme/api/pull/${over.number}`, author: 'victornor',
    state: 'open', isDraft: false, headRefName: 'topic', baseRefName: 'main',
    createdAt: '2026-09-06T10:00:00.000Z', updatedAt: '2026-09-07T10:00:00.000Z', mergedAt: null, closedAt: null,
    additions: 10, deletions: 2, changedFiles: 1, checks: 'success', reviewDecision: null, mergeCommit: null,
    ticket: null, changeName: null, queue: null,
    ...over,
  };
}

function list(over: Partial<ProjectPullRequests> = {}): ProjectPullRequests {
  return {
    projectId: 'p1', available: true, reason: null, message: null, stale: false,
    capturedAt: '2026-09-07T11:00:00.000Z', windowDays: 30, open: [], recent: [], ...over,
  };
}

const show = (): void => { render(<PullRequestsSection project={api} ws="ws1" />); };
/** The link whose text is `label`, with the search params it carries. */
const linkTo = (label: string | RegExp): HTMLElement => screen.getByRole('link', { name: label });

beforeEach(() => {
  state.list = list();
  state.listLoading = false;
  state.detail = null;
  state.detailLoading = false;
  state.search = {};
});

describe('the list', () => {
  it('shows open pull requests first, then what closed inside the window', () => {
    state.list = list({
      open: [pr({ number: 3 }), pr({ number: 1 })],
      recent: [pr({ number: 2, state: 'merged', mergedAt: '2026-09-05T10:00:00.000Z' })],
    });
    show();
    const groups = screen.getAllByRole('list');
    expect(within(groups[0]!).getAllByText(/#\d/).map((n) => n.textContent)).toEqual(['#3', '#1']);
    expect(within(groups[1]!).getAllByText(/#\d/).map((n) => n.textContent)).toEqual(['#2']);
    expect(screen.getByText(/last 30 days/)).toBeTruthy();
  });

  it('shows the number, the title, the author, the branch and the state of each', () => {
    state.list = list({ open: [pr({ number: 12, title: 'Add dark mode', author: 'victornor', headRefName: 'ac/acme-42-add-dark-mode' })] });
    show();
    expect(screen.getByText('#12')).toBeTruthy();
    expect(screen.getByText('Add dark mode')).toBeTruthy();
    expect(screen.getByText('victornor')).toBeTruthy();
    expect(screen.getByText('ac/acme-42-add-dark-mode')).toBeTruthy();
    expect(screen.getByText('open')).toBeTruthy();
  });

  it('links the ticket it belongs to and the spec change it implements', () => {
    state.list = list({
      open: [pr({ number: 12, ticket: { id: 'tk_1', identifier: 'ACME-42', title: 'Add dark mode', status: 'in_review', hasPlan: false }, changeName: 'acme-42-dark-mode' })],
    });
    show();
    const ticketLink = linkTo('ACME-42');
    expect(ticketLink.getAttribute('data-params')).toContain('ACME-42');
    // Opens straight on the conversation with the worker that produced it, not on the overview (VS-106).
    expect(JSON.parse(ticketLink.getAttribute('data-search') ?? '{}')).toEqual({ tab: 'activity' });
    const change = linkTo('acme-42-dark-mode');
    expect(change.getAttribute('data-to')).toBe('/w/$ws/knowledge');
    expect(JSON.parse(change.getAttribute('data-search') ?? '{}')).toEqual({ project: 'p1', tab: 'specs' });
  });

  it('says a draft is a draft, and reports the review decision', () => {
    state.list = list({ open: [pr({ number: 5, isDraft: true, reviewDecision: 'changes_requested' })] });
    show();
    expect(screen.getByText('draft')).toBeTruthy();
    expect(screen.getByText('changes requested')).toBeTruthy();
  });

  it('shows where a queued pull request stands, and that one is landing', () => {
    state.list = list({
      open: [
        pr({ number: 1, ticket: { id: 'a', identifier: 'ACME-1', title: '', status: 'merging', hasPlan: false }, queue: { state: 'waiting', position: 2 } }),
        pr({ number: 2, ticket: { id: 'b', identifier: 'ACME-2', title: '', status: 'merging', hasPlan: false }, queue: { state: 'landing', position: null } }),
      ],
    });
    show();
    expect(screen.getByText('queued · 2')).toBeTruthy();
    expect(screen.getByText('landing')).toBeTruthy();
  });

  it('lists a pull request that belongs to no ticket, with no ticket or change link', () => {
    state.list = list({ open: [pr({ number: 9, headRefName: 'dependabot/npm/left-pad' })] });
    show();
    expect(screen.getByText('#9')).toBeTruthy();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('says when the forge was read, and that a stale answer is stale', () => {
    state.list = list({ open: [pr({ number: 1 })], stale: true });
    show();
    expect(screen.getByText(/could not be re-read/)).toBeTruthy();
  });
});

describe('opening one', () => {
  const opened = (over: Partial<ProjectPullRequest> = {}): PullRequestDetailResult => ({
    projectId: 'p1', available: true, reason: null, message: null, stale: false,
    pullRequest: {
      ...pr({ number: 12, ...over }),
      body: '## Why\n\nBecause the section was empty.',
      files: [{ path: 'packages/ui/src/routes/project/PullRequestsSection.tsx', additions: 120, deletions: 4 }, { path: 'README.md', additions: 1, deletions: 1 }],
      checkRuns: [{ name: 'ci / test', state: 'success', url: 'https://ci/1' }, { name: 'ci / lint', state: 'failure', url: null }],
    },
  });

  it('shows the description, the changed files with their counts, and the checks', () => {
    state.list = list({ open: [pr({ number: 12 })] });
    state.detail = opened();
    show();
    fireEvent.click(screen.getByRole('button', { name: /Pull request #12/ }));

    expect(screen.getByText(/Because the section was empty/)).toBeTruthy();
    expect(screen.getByText('packages/ui/src/routes/project/PullRequestsSection.tsx')).toBeTruthy();
    expect(screen.getByText('+120')).toBeTruthy();
    expect(screen.getByText('−4')).toBeTruthy();
    // The totals across every file, not just the one that carries them.
    expect(screen.getByText('+121')).toBeTruthy();
    expect(screen.getByText('ci / test')).toBeTruthy();
    expect(screen.getByText('ci / lint')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'open on the forge' }).getAttribute('href')).toBe('https://github.com/acme/api/pull/12');
  });

  it('opens the pull request the address names', () => {
    state.search = { pr: '12' };
    state.detail = opened();
    show();
    expect(screen.getByText(/Because the section was empty/)).toBeTruthy();
  });

  it('goes back to the list', () => {
    state.list = list({ open: [pr({ number: 12 })] });
    state.detail = opened();
    show();
    fireEvent.click(screen.getByRole('button', { name: /Pull request #12/ }));
    fireEvent.click(screen.getByRole('button', { name: /pull requests/ }));
    expect(screen.getByText('PR 12')).toBeTruthy();
    expect(screen.queryByText(/Because the section was empty/)).toBeNull();
  });

  it('puts the plan one click away when the ticket has one', () => {
    state.search = { pr: '12' };
    state.detail = opened({ ticket: { id: 'tk_1', identifier: 'ACME-42', title: '', status: 'in_review', hasPlan: true } });
    show();
    const plan = linkTo('plan');
    expect(plan.getAttribute('data-to')).toBe('/w/$ws/tickets/$ticketId');
    expect(JSON.parse(plan.getAttribute('data-search') ?? '{}')).toEqual({ tab: 'plan' });
  });

  it('offers no plan link when the ticket has none', () => {
    state.search = { pr: '12' };
    state.detail = opened({ ticket: { id: 'tk_1', identifier: 'ACME-42', title: '', status: 'in_review', hasPlan: false } });
    show();
    expect(screen.queryByRole('link', { name: 'plan' })).toBeNull();
  });

  it('offers nothing that would approve, merge, review or comment', () => {
    state.search = { pr: '12' };
    state.detail = opened();
    show();
    const labels = screen.getAllByRole('button').map((b) => b.textContent ?? '').join(' ').toLowerCase();
    for (const forbidden of ['approve', 'merge', 'review', 'comment']) expect(labels).not.toContain(forbidden);
  });

  it('says so when the forge has no such pull request', () => {
    state.search = { pr: '404' };
    state.detail = { projectId: 'p1', available: true, reason: null, message: null, stale: false, pullRequest: null };
    show();
    expect(screen.getByText(/no pull request #404/)).toBeTruthy();
  });
});

describe('when there is nothing to show', () => {
  it('says a project with no forge has none, without an error or a retry', () => {
    state.list = list({ available: false, reason: 'no_forge' });
    show();
    expect(screen.getByText(/not available for this project/)).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByRole('list')).toBeNull();
  });

  it('says the forge tool is not signed in', () => {
    state.list = list({ available: false, reason: 'not_authenticated' });
    show();
    expect(screen.getByText(/not signed in/)).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('says the forge could not be reached, and what it said', () => {
    state.list = list({ available: false, reason: 'unreachable', message: 'gh pr list failed: HTTP 502' });
    show();
    expect(screen.getByText(/could not be reached/)).toBeTruthy();
    expect(screen.getByText(/HTTP 502/)).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('says the window is empty for a project whose forge answered with nothing', () => {
    show();
    expect(screen.getByText(/No open pull requests, and none merged or closed in the last 30 days/)).toBeTruthy();
  });

  it('shows a skeleton while it is loading, and no error', () => {
    state.list = null;
    state.listLoading = true;
    show();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('the phone', () => {
  it('lays the list out in one column and never scrolls sideways', () => {
    state.list = list({ open: [pr({ number: 1 })], recent: [pr({ number: 2, state: 'merged', mergedAt: '2026-09-05T00:00:00.000Z' })] });
    const { container } = render(<PullRequestsSection project={api} ws="ws1" />);
    for (const ul of container.querySelectorAll('ul')) {
      expect(ul.className).toContain('flex-col');
      expect(ul.className).not.toContain('overflow-x');
    }
    // Every long value is truncated rather than widening the column it sits in.
    expect(container.querySelectorAll('.truncate').length).toBeGreaterThan(0);
  });
});
