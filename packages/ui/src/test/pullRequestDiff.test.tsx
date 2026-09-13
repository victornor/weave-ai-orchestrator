/**
 * The pull request diff view (VS-107): the file tree, per-file lazy loading, unified and side-by-side
 * layouts, binary/too-large handling, and the collapsed-region expand control. `../api/hooks` is
 * mocked wholesale, as every route test here does; `../lib/highlight` is mocked too, so a test here
 * exercises this view's own rendering, not `highlight.js`'s grammars — those are `lib/highlight.test.ts`'s
 * job (ADR 0013).
 */
import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import type { DiffFileContent, DiffFileSummary, PullRequestDiffContextResult, PullRequestDiffFileResult, PullRequestDiffFilesResult } from '../api/types';

const state = vi.hoisted(() => ({
  files: null as PullRequestDiffFilesResult | null,
  fileByPath: {} as Record<string, PullRequestDiffFileResult>,
  fileCalls: [] as string[],
  context: null as PullRequestDiffContextResult | null,
}));

vi.mock('../api/hooks', () => ({
  usePullRequestDiffFiles: () => ({ data: state.files, isLoading: false }),
  usePullRequestDiffFile: (_p: unknown, _n: unknown, path: string | null) => {
    if (path === null) return { data: undefined, isLoading: false };
    state.fileCalls.push(path);
    return { data: state.fileByPath[path], isLoading: state.fileByPath[path] === undefined };
  },
  usePullRequestDiffContext: (_p: unknown, _n: unknown, path: string | null, range: { start: number; end: number } | null) => ({
    data: path && range ? state.context : undefined,
    isLoading: false,
  }),
}));
vi.mock('../lib/highlight', () => ({
  languageForPath: () => null,
  useHighlighter: () => null,
  highlightLine: (_hljs: unknown, text: string) => text,
}));

const { PullRequestDiff } = await import('../routes/project/PullRequestDiff');

function summary(over: Partial<DiffFileSummary> & { path: string }): DiffFileSummary {
  return { previousPath: null, status: 'modified', additions: 1, deletions: 1, binary: false, tooLarge: false, ...over };
}

function filesResult(files: DiffFileSummary[]): PullRequestDiffFilesResult {
  return { projectId: 'p1', number: 12, available: true, reason: null, message: null, stale: false, files };
}

function fileResult(over: Partial<DiffFileContent> & { path: string }): PullRequestDiffFileResult {
  const content: DiffFileContent = { previousPath: null, status: 'modified', additions: 1, deletions: 1, binary: false, tooLarge: false, hunks: [], ...over };
  return { projectId: 'p1', number: 12, available: true, reason: null, message: null, file: content };
}

beforeEach(() => {
  state.files = null;
  state.fileByPath = {};
  state.fileCalls = [];
  state.context = null;
  localStorage.removeItem('conductor.diffLayout');
});
afterEach(() => vi.clearAllMocks());

/** jsdom answers every media query `false`, which is the desk; a phone case has to say so (mirrors Composer's `hoverNone`). */
function phoneWidth(isPhone: boolean): void {
  const real = window.matchMedia;
  window.matchMedia = ((q: string) => ({
    matches: q.includes('max-width: 767px') ? isPhone : false,
    media: q, onchange: null,
    addEventListener: () => undefined, removeEventListener: () => undefined,
    addListener: () => undefined, removeListener: () => undefined, dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
  onTestFinished(() => { window.matchMedia = real; });
}

describe('the file tree', () => {
  it('lists every changed file with its status and counts, with no content requested yet', () => {
    state.files = filesResult([summary({ path: 'src/a.ts', additions: 5, deletions: 2, status: 'added' })]);
    render(<PullRequestDiff projectId="p1" number={12} />);
    expect(screen.getByText('src/a.ts')).toBeTruthy();
    expect(screen.getByText('added')).toBeTruthy();
    expect(screen.getByText('+5')).toBeTruthy();
    expect(screen.getByText('−2')).toBeTruthy();
    expect(state.fileCalls).toEqual([]);
  });

  it('shows a rename as from and to', () => {
    state.files = filesResult([summary({ path: 'src/b.ts', previousPath: 'src/a.ts', status: 'renamed' })]);
    render(<PullRequestDiff projectId="p1" number={12} />);
    expect(screen.getByText('src/a.ts → src/b.ts')).toBeTruthy();
  });

  it('says so when the forge reported no changed files', () => {
    state.files = filesResult([]);
    render(<PullRequestDiff projectId="p1" number={12} />);
    expect(screen.getByText(/no changed files/)).toBeTruthy();
  });
});

describe('opening a file', () => {
  it("requests that file's content only once it is opened", () => {
    state.files = filesResult([summary({ path: 'src/a.ts' })]);
    state.fileByPath['src/a.ts'] = fileResult({
      path: 'src/a.ts',
      hunks: [{
        oldStart: 1, oldLines: 2, newStart: 1, newLines: 2, header: '@@ -1,2 +1,2 @@',
        lines: [
          { kind: 'context', oldLine: 1, newLine: 1, text: 'unchanged' },
          { kind: 'remove', oldLine: 2, newLine: null, text: 'const x = 1;' },
          { kind: 'add', oldLine: null, newLine: 2, text: 'const x = 2;' },
        ],
      }],
    });
    render(<PullRequestDiff projectId="p1" number={12} />);
    expect(state.fileCalls).toEqual([]);

    fireEvent.click(screen.getByRole('button', { expanded: false }));
    expect(state.fileCalls).toContain('src/a.ts');
    expect(screen.getByText('unchanged')).toBeTruthy();
    // Syntax highlighting splits a line into several spans, so the line is asserted as a whole
    // rather than as one exact text node.
    expect(document.body.textContent).toContain('const x = 1;');
    expect(document.body.textContent).toContain('const x = 2;');
  });

  it('collapsing and reopening does not lose what was already loaded', () => {
    state.files = filesResult([summary({ path: 'src/a.ts' })]);
    state.fileByPath['src/a.ts'] = fileResult({
      path: 'src/a.ts',
      hunks: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, header: '@@ -1 +1 @@', lines: [{ kind: 'context', oldLine: 1, newLine: 1, text: 'x' }] }],
    });
    render(<PullRequestDiff projectId="p1" number={12} />);
    const row = screen.getByRole('button', { expanded: false });
    fireEvent.click(row);
    expect(screen.getByText('x')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { expanded: true }));
    expect(screen.queryByText('x')).toBeNull();
    fireEvent.click(screen.getByRole('button', { expanded: false }));
    expect(screen.getByText('x')).toBeTruthy();
  });

  it('states a binary file rather than rendering it, and asks for no content', () => {
    state.files = filesResult([summary({ path: 'assets/logo.png', binary: true, additions: 0, deletions: 0 })]);
    render(<PullRequestDiff projectId="p1" number={12} />);
    fireEvent.click(screen.getByRole('button', { expanded: false }));
    expect(screen.getByText(/binary/)).toBeTruthy();
    expect(state.fileCalls).toEqual([]);
  });

  it('states a too-large file rather than rendering it, with its header still shown', () => {
    state.files = filesResult([summary({ path: 'src/huge.ts', tooLarge: true, additions: 9000, deletions: 1000 })]);
    render(<PullRequestDiff projectId="p1" number={12} />);
    expect(screen.getByText('+9000')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { expanded: false }));
    expect(screen.getByText(/too large/)).toBeTruthy();
    expect(state.fileCalls).toEqual([]);
  });
});

describe('a collapsed region between hunks', () => {
  beforeEach(() => {
    state.files = filesResult([summary({ path: 'src/a.ts' })]);
    state.fileByPath['src/a.ts'] = fileResult({
      path: 'src/a.ts',
      hunks: [
        { oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, header: '@@ -1 +1 @@', lines: [{ kind: 'context', oldLine: 1, newLine: 1, text: 'one' }] },
        { oldStart: 5, oldLines: 1, newStart: 5, newLines: 1, header: '@@ -5 +5 @@', lines: [{ kind: 'context', oldLine: 5, newLine: 5, text: 'five' }] },
      ],
    });
  });

  it('is shown collapsed with a control that expands it', () => {
    render(<PullRequestDiff projectId="p1" number={12} />);
    fireEvent.click(screen.getByRole('button', { expanded: false }));
    expect(screen.getByText(/Expand 3 lines/)).toBeTruthy();
  });

  it('expanding shows the fetched content in place of the control', () => {
    state.context = { projectId: 'p1', number: 12, available: true, reason: null, lines: ['two', 'three', 'four'] };
    render(<PullRequestDiff projectId="p1" number={12} />);
    fireEvent.click(screen.getByRole('button', { expanded: false }));
    fireEvent.click(screen.getByText(/Expand 3 lines/));
    expect(screen.getByText('two')).toBeTruthy();
    expect(screen.getByText('three')).toBeTruthy();
    expect(screen.getByText('four')).toBeTruthy();
    expect(screen.queryByText(/Expand 3 lines/)).toBeNull();
  });

  it('a single hunk offers no expand control', () => {
    state.fileByPath['src/a.ts'] = fileResult({
      path: 'src/a.ts',
      hunks: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, header: '@@ -1 +1 @@', lines: [{ kind: 'context', oldLine: 1, newLine: 1, text: 'one' }] }],
    });
    render(<PullRequestDiff projectId="p1" number={12} />);
    fireEvent.click(screen.getByRole('button', { expanded: false }));
    expect(screen.queryByText(/Expand/)).toBeNull();
  });
});

describe('unified vs. side-by-side', () => {
  beforeEach(() => {
    state.files = filesResult([summary({ path: 'src/a.ts' })]);
    state.fileByPath['src/a.ts'] = fileResult({
      path: 'src/a.ts',
      hunks: [{
        oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, header: '@@ -1 +1 @@',
        lines: [{ kind: 'remove', oldLine: 1, newLine: null, text: 'old' }, { kind: 'add', oldLine: null, newLine: 1, text: 'new' }],
      }],
    });
  });

  it('renders unified by default, on desktop, with one column of code', () => {
    const { container } = render(<PullRequestDiff projectId="p1" number={12} />);
    fireEvent.click(screen.getByRole('button', { expanded: false }));
    expect(container.querySelector('.grid-cols-2')).toBeNull();
  });

  it('switches to side-by-side, remembered for the device', () => {
    const { container } = render(<PullRequestDiff projectId="p1" number={12} />);
    fireEvent.click(screen.getByRole('button', { name: 'Side-by-side' }));
    fireEvent.click(screen.getByRole('button', { expanded: false }));
    expect(container.querySelector('.grid-cols-2')).toBeTruthy();
    expect(localStorage.getItem('conductor.diffLayout')).toBe('split');
  });

  it('is always unified at a phone width, with no layout control offered', () => {
    phoneWidth(true);
    localStorage.setItem('conductor.diffLayout', 'split');
    const { container } = render(<PullRequestDiff projectId="p1" number={12} />);
    expect(screen.queryByRole('button', { name: 'Side-by-side' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { expanded: false }));
    expect(container.querySelector('.grid-cols-2')).toBeNull();
  });
});

describe('a re-render of the diff', () => {
  it('does not rebuild a line whose content is unchanged, so the text node and its selection survive', () => {
    state.files = filesResult([summary({ path: 'src/a.ts' })]);
    state.fileByPath['src/a.ts'] = fileResult({
      path: 'src/a.ts',
      hunks: [{
        oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, header: '@@ -1 +1 @@',
        lines: [{ kind: 'context', oldLine: 1, newLine: 1, text: 'const keep = 1;' }],
      }],
    });

    // An unrelated parent re-render — a sibling's state, not the diff's — is enough to re-render the
    // diff; the line's `dangerouslySetInnerHTML` must not rewrite its DOM when the text is identical.
    function Harness() {
      const [n, setN] = useState(0);
      return (
        <>
          <button type="button" onClick={() => setN((v) => v + 1)}>re-render {n}</button>
          <PullRequestDiff projectId="p1" number={12} />
        </>
      );
    }
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { expanded: false }));

    const line = screen.getByText('const keep = 1;');
    const textNode = line.firstChild;
    expect(textNode).toBeTruthy();

    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(line);
    selection?.removeAllRanges();
    selection?.addRange(range);
    expect(selection?.toString()).toBe('const keep = 1;');

    fireEvent.click(screen.getByRole('button', { name: /re-render/ }));

    expect(screen.getByText('const keep = 1;').firstChild).toBe(textNode);
    expect(window.getSelection()?.toString()).toBe('const keep = 1;');
  });
});

describe('the phone layout', () => {
  it('has no horizontal-scroll-inducing width classes', () => {
    phoneWidth(true);
    state.files = filesResult([summary({ path: 'src/a.ts' })]);
    const { container } = render(<PullRequestDiff projectId="p1" number={12} />);
    expect(container.querySelector('[class*="min-w-["]')).toBeNull();
    expect(container.querySelector('[class*="w-screen"]')).toBeNull();
  });
});
