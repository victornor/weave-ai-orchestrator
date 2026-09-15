/**
 * VS-452: the V2 change explorer (`/v2/w/:ws/p/:project/changes/:number`) — the file tree, the
 * whole-file view assembled from hunks plus base context, the changes-only and unified/split toggles,
 * the binary and too-large states, the deep link and the keyboard. `../api/hooks` is mocked wholesale,
 * as every route test here does, and `../lib/highlight` too, so this exercises the view's own
 * rendering rather than highlight.js's grammars.
 */
import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DiffFileContent, DiffFileSummary, PullRequestDiffFileResult, PullRequestDiffFilesResult } from '../api/types';

const state = vi.hoisted(() => ({
  files: [] as DiffFileSummary[],
  fileByPath: {} as Record<string, DiffFileContent>,
  contextLines: [] as string[],
  fileCalls: [] as string[],
  search: {} as Record<string, string | undefined>,
  go: null as unknown as (to: string, opts?: Record<string, unknown>) => void,
}));

vi.mock('@tanstack/react-router', () => ({
  useRouterState: () => '/v2/w/ws1/p/web/changes/42',
  useParams: () => ({ ws: 'ws1', project: 'web', number: '42' }),
}));

vi.mock('../app/link', () => ({
  useSearchParams: () => state.search,
  useGo: () => state.go,
}));

vi.mock('../api/context', () => ({ useWs: () => 'ws1', useHookWs: (o?: string) => o ?? 'ws1' }));

vi.mock('../api/hooks', () => ({
  useWorkspaces: () => ({ data: [{ id: 'ws1', name: 'Acme', needsYou: 0 }] }),
  useWorkersMany: (ids: readonly string[]) => ids.map(() => ({ data: [] })),
  useDecisionsMany: (ids: readonly string[]) => ids.map(() => ({ data: [] })),
  useIncidents: () => ({ data: { items: [] } }),
  useProjects: () => ({ data: [{ id: 'p1', slug: 'web', name: 'Web' }], isLoading: false }),
  usePullRequest: () => ({
    isLoading: false,
    data: {
      projectId: 'p1', available: true, reason: null, message: null, stale: false,
      pullRequest: {
        number: 42, title: 'Add dark mode', url: 'https://github.com/acme/web/pull/42', author: 'victor',
        state: 'open', isDraft: false, headRefName: 'ac/dark', baseRefName: 'main', headSha: 'abcdef1234567890',
        createdAt: '2026-09-10T00:00:00.000Z', updatedAt: '2026-09-10T00:00:00.000Z', mergedAt: null, closedAt: null,
        additions: 2, deletions: 1, changedFiles: 3, checks: 'success', reviewDecision: null, mergeCommit: null,
        ticket: null, changeName: null, queue: null,
        body: '', files: [], checkRuns: [],
      },
    },
  }),
  usePullRequestDiffFiles: (): { isLoading: boolean; data: PullRequestDiffFilesResult } => ({
    isLoading: false,
    data: { projectId: 'p1', number: 42, available: true, reason: null, message: null, stale: false, files: state.files },
  }),
  usePullRequestDiffFile: (_p: unknown, _n: unknown, path: string | null): { isLoading: boolean; data: PullRequestDiffFileResult | undefined } => {
    if (path === null) return { isLoading: false, data: undefined };
    state.fileCalls.push(path);
    const found = state.fileByPath[path];
    return { isLoading: false, data: found ? { projectId: 'p1', number: 42, available: true, reason: null, message: null, file: found } : undefined };
  },
  usePullRequestDiffContext: (_p: unknown, _n: unknown, path: string | null, range: { start: number; end: number } | null) => ({
    isLoading: false,
    data: path && range ? { projectId: 'p1', number: 42, available: true, reason: null, lines: state.contextLines } : undefined,
  }),
}));

vi.mock('../lib/highlight', () => ({
  languageForPath: () => null,
  // VS-445: `useHighlighter(lang)` returns the line-highlighter itself.
  useHighlighter: () => (text: string) => text,
}));

const { V2ChangeExplorerScreen } = await import('../v2/project/ChangeExplorer');

function file(path: string, over: Partial<DiffFileSummary> = {}): DiffFileSummary {
  return { path, previousPath: null, status: 'modified', additions: 1, deletions: 1, binary: false, tooLarge: false, ...over };
}

function content(path: string, hunks: DiffFileContent['hunks'], over: Partial<DiffFileContent> = {}): DiffFileContent {
  return { path, previousPath: null, status: 'modified', additions: 1, deletions: 1, binary: false, tooLarge: false, hunks, ...over };
}

const show = (): void => { render(<V2ChangeExplorerScreen />); };

beforeEach(() => {
  state.files = [];
  state.fileByPath = {};
  state.contextLines = [];
  state.fileCalls = [];
  state.search = {};
  state.go = vi.fn();
  localStorage.removeItem('conductor.diffLayout');
});

describe('the file tree', () => {
  it('groups files into folders, with per-folder and per-file counts and a status badge', () => {
    state.files = [
      file('src/a.ts', { additions: 2, deletions: 1 }),
      file('src/b.ts', { additions: 3, deletions: 4, status: 'added' }),
      file('docs/c.md', { additions: 1, deletions: 9, status: 'deleted' }),
    ];
    show();
    const tree = screen.getByRole('tree');
    expect(within(tree).getByText('src')).toBeInTheDocument();
    expect(within(tree).getByText('docs')).toBeInTheDocument();
    // The folder's own totals are summed from its files.
    const srcRow = within(tree).getByText('src').closest('button')!;
    expect(srcRow.textContent).toContain('+5');
    expect(srcRow.textContent).toContain('−5');
    // A file's badge and its own counts.
    const b = within(tree).getByText('b.ts').closest('button')!;
    expect(b.textContent).toContain('added');
    expect(b.textContent).toContain('+3');
    expect(b.textContent).toContain('−4');
  });

  it('filters the tree to the matching paths', () => {
    state.files = [file('src/a.ts'), file('docs/c.md')];
    show();
    fireEvent.change(screen.getByLabelText('Filter files'), { target: { value: 'docs' } });
    const tree = screen.getByRole('tree');
    expect(within(tree).queryByText('a.ts')).toBeNull();
    expect(within(tree).getByText('c.md')).toBeInTheDocument();
  });

  it('shows a rename as from → to', () => {
    state.files = [file('src/new.ts', { previousPath: 'src/old.ts', status: 'renamed' })];
    show();
    expect(within(screen.getByRole('tree')).getByText('src/old.ts → src/new.ts')).toBeInTheDocument();
  });

  it('collapses a folder, hiding its files', () => {
    state.files = [file('src/a.ts')];
    show();
    fireEvent.click(screen.getByText('src'));
    expect(screen.queryByText('a.ts')).toBeNull();
  });
});

describe('the whole-file view', () => {
  beforeEach(() => {
    state.files = [file('src/a.ts', { additions: 1, deletions: 1 })];
    state.fileByPath['src/a.ts'] = content('src/a.ts', [
      { oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, header: '@@ -1 +1 @@', lines: [{ kind: 'remove', oldLine: 1, newLine: null, text: 'old one' }, { kind: 'add', oldLine: null, newLine: 1, text: 'new one' }] },
      { oldStart: 5, oldLines: 1, newStart: 5, newLines: 1, header: '@@ -5 +5 @@', lines: [{ kind: 'context', oldLine: 5, newLine: 5, text: 'five' }] },
    ]);
    state.contextLines = ['one', 'two', 'three', 'four', 'five', 'six'];
  });

  it('opens a file in whole-file view and fills the unchanged region from the base', () => {
    state.search = { file: 'src/a.ts' };
    show();
    expect(state.fileCalls).toContain('src/a.ts');
    // The changed lines…
    expect(document.body.textContent).toContain('old one');
    expect(document.body.textContent).toContain('new one');
    // …and the base lines the diff's own hunks did not carry, recovered from the context read.
    expect(document.body.textContent).toContain('three');
    expect(document.body.textContent).toContain('four');
  });

  it('switches to changes-only, which drops the base context and shows the hunk header', () => {
    state.search = { file: 'src/a.ts' };
    show();
    fireEvent.click(screen.getByRole('button', { name: 'Changes only' }));
    expect(document.body.textContent).toContain('@@ -1 +1 @@');
    expect(document.body.textContent).not.toContain('three');
  });

  it('switches to side-by-side and remembers it for the device', () => {
    state.search = { file: 'src/a.ts' };
    const { container } = render(<V2ChangeExplorerScreen />);
    fireEvent.click(screen.getByRole('button', { name: 'Side-by-side' }));
    expect(container.querySelector('.grid-cols-2')).not.toBeNull();
    expect(localStorage.getItem('conductor.diffLayout')).toBe('split');
  });
});

describe('graceful states', () => {
  it('states a binary file and asks for no content', () => {
    state.files = [file('assets/logo.png', { binary: true, additions: 0, deletions: 0 })];
    state.search = { file: 'assets/logo.png' };
    show();
    expect(screen.getByText('This file is binary.')).toBeInTheDocument();
    expect(state.fileCalls).toEqual([]);
  });

  it('states a too-large file and asks for no content', () => {
    state.files = [file('src/huge.ts', { tooLarge: true, additions: 9000, deletions: 1000 })];
    state.search = { file: 'src/huge.ts' };
    show();
    expect(screen.getByText(/too large/)).toBeInTheDocument();
    expect(state.fileCalls).toEqual([]);
  });
});

describe('the deep link', () => {
  it('selects the file named in the search and highlights it in the tree', () => {
    state.files = [file('src/a.ts'), file('src/b.ts')];
    state.fileByPath['src/b.ts'] = content('src/b.ts', [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, header: '@@ -1 +1 @@', lines: [{ kind: 'context', oldLine: 1, newLine: 1, text: 'b body' }] }]);
    state.search = { file: 'src/b.ts' };
    show();
    const row = screen.getByText('b.ts').closest('button')!;
    expect(row).toHaveAttribute('data-selected', 'true');
    expect(document.body.textContent).toContain('b body');
  });
});

describe('the keyboard', () => {
  it('moves the selection with the arrow keys and opens on enter', () => {
    state.files = [file('src/a.ts'), file('src/b.ts')];
    show();
    const tree = screen.getByRole('tree');
    fireEvent.keyDown(tree, { key: 'ArrowDown' });
    expect(state.go).toHaveBeenCalledWith(
      '/v2/w/$ws/p/$project/changes/$number',
      expect.objectContaining({ search: { file: 'src/b.ts' } }),
    );
    fireEvent.keyDown(tree, { key: 'Enter' });
    expect(state.go).toHaveBeenCalledTimes(2);
  });
});

describe('the header', () => {
  it('shows the pull request title, the branch pair, the head sha and the totals', () => {
    state.files = [file('src/a.ts', { additions: 2, deletions: 1 })];
    const { container } = render(<V2ChangeExplorerScreen />);
    expect(screen.getByRole('heading', { name: 'Add dark mode' })).toBeInTheDocument();
    const meta = within(container.querySelector('[data-change-meta]') as HTMLElement);
    expect(meta.getByText('ac/dark → main')).toBeInTheDocument();
    expect(meta.getByText('head abcdef1234')).toBeInTheDocument();
    expect(meta.getByText('+2')).toBeInTheDocument();
    expect(meta.getByText('−1')).toBeInTheDocument();
  });
});