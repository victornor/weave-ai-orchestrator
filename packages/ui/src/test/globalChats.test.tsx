/**
 * VS-168: daemon-wide Chats page. VS-199: exactly one pane is live at a time.
 * VS-336: resizable separators, collapse to a sliver, reorder and per-browser persistence.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render as rtlRender, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const remembered = vi.hoisted(() => ({ ws: 'kept' as string | null }));
/** Every render of the mocked `WorkspaceProvider`, in order — captures `live` so a test can tell
 *  how many panes hold a subscription at once, regardless of how many workspaces are listed. */
const providers = vi.hoisted(() => ({ calls: [] as Array<{ ws: string; remember: boolean; live: boolean }> }));
const chatPanes = vi.hoisted(() => ({ calls: [] as Array<{ focused: boolean }> }));
const workspacesState = vi.hoisted(() => ({
  list: [
    { id: 'alpha', name: 'Alpha', needsYou: 0 },
    { id: 'beta', name: 'Beta', needsYou: 0 },
  ] as Array<{ id: string; name: string; needsYou: number }>,
}));

vi.mock('../api/hooks', () => ({
  useWorkspaces: () => ({
    data: workspacesState.list,
    isError: false,
    refetch: vi.fn(),
  }),
}));

vi.mock('../api/client', () => ({
  getWorkspaceId: () => remembered.ws,
  setWorkspaceId: (id: string) => { remembered.ws = id; },
}));

vi.mock('../api/context', async () => {
  const actual = await vi.importActual<typeof import('../api/context')>('../api/context');
  const React = await vi.importActual<typeof import('react')>('react');
  return {
    ...actual,
    WorkspaceProvider: ({
      ws,
      remember = true,
      live = true,
      children,
    }: {
      ws: string;
      remember?: boolean;
      live?: boolean;
      children: React.ReactNode;
    }) => {
      providers.calls.push({ ws, remember, live });
      // Hand the pane's own id to the stubbed ChatPage as a prop so it does not have to read a
      // module-level "current workspace" (which a child-only re-render would stale).
      return <div data-ws={ws}>{React.cloneElement(children as React.ReactElement<{ ws?: string }>, { ws })}</div>;
    },
  };
});

vi.mock('../routes/Chat', async () => {
  const { useDraft, draftKey } = await vi.importActual<typeof import('../lib/drafts')>('../lib/drafts');
  return {
    ChatPage: ({ focused = true, ws = 'alpha' }: { focused?: boolean; ws?: string } = {}) => {
      chatPanes.calls.push({ focused });
      const { draft, patch } = useDraft(draftKey(ws, 'thread:t'));
      return (
        <div>
          chat pane
          <input
            aria-label={`draft-${ws}`}
            value={draft.text}
            onChange={(e) => patch({ text: e.target.value })}
          />
        </div>
      );
    },
  };
});

const { GlobalChatsRoute } = await import('../routes/GlobalChats');

const KEY = 'conductor.globalChats.layout';

function render(): { qc: QueryClient } & ReturnType<typeof rtlRender> {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const result = rtlRender(
    <QueryClientProvider client={qc}>
      <GlobalChatsRoute />
    </QueryClientProvider>,
  );
  return { qc, ...result };
}

function media(matches: boolean): typeof window.matchMedia {
  return ((query: string) => ({
    matches,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

function layout(el: HTMLElement, width: number): void {
  Object.defineProperty(el, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({ top: 0, left: 0, bottom: 100, right: width, width, height: 100, x: 0, y: 0, toJSON: () => ({}) }),
  });
}

function grip(name: string): number {
  return Number((screen.getByLabelText(name) as HTMLElement).style.flexGrow);
}

function dataTransfer(): DataTransfer {
  return { setData: vi.fn(), getData: vi.fn(), effectAllowed: 'move', dropEffect: 'move', files: [], types: [] } as unknown as DataTransfer;
}

let realMatchMedia: typeof window.matchMedia;

beforeEach(() => {
  remembered.ws = 'kept';
  providers.calls = [];
  chatPanes.calls = [];
  workspacesState.list = [
    { id: 'alpha', name: 'Alpha', needsYou: 0 },
    { id: 'beta', name: 'Beta', needsYou: 0 },
  ];
  localStorage.clear();
  sessionStorage.clear();
  realMatchMedia = window.matchMedia;
  window.matchMedia = media(false);
});

afterEach(() => {
  window.matchMedia = realMatchMedia;
});

describe('GlobalChatsRoute', () => {
  it('shows a labelled pane per workspace in a horizontal row', () => {
    const { container } = render();
    expect(screen.getByLabelText('Alpha')).toBeInTheDocument();
    expect(screen.getByLabelText('Beta')).toBeInTheDocument();
    expect(screen.getAllByText('chat pane')).toHaveLength(2);
    expect(container.querySelector('.overflow-x-auto')).not.toBeNull();
  });

  it('does not rewrite the remembered workspace', () => {
    render();
    expect(providers.calls).toEqual([
      { ws: 'alpha', remember: false, live: true },
      { ws: 'beta', remember: false, live: false },
    ]);
    expect(remembered.ws).toBe('kept');
  });

  it('defaults the first workspace to the focused (live) pane', () => {
    render();
    expect(chatPanes.calls).toEqual([{ focused: true }, { focused: false }]);
  });

  it('holds exactly one live pane no matter how many workspaces are listed', () => {
    workspacesState.list = Array.from({ length: 10 }, (_, i) => ({ id: `ws${i}`, name: `W${i}`, needsYou: 0 }));
    render();
    // Ten panes, but only the focused one's WorkspaceProvider — and its ChatPage — is live: this
    // is the assertion that fails against the old one-stream-per-pane behaviour (which would have
    // reported ten) and holds regardless of workspace count (VS-199).
    expect(providers.calls).toHaveLength(10);
    expect(providers.calls.filter((c) => c.live)).toHaveLength(1);
    expect(chatPanes.calls.filter((c) => c.focused)).toHaveLength(1);
  });

  it('moves the live pane when the human chooses a different one', () => {
    render();
    fireEvent.click(screen.getByRole('button', { name: 'Beta' }));
    // The click triggers a re-render; the most recent render for each pane is what the live state
    // settled to.
    const lastRender = providers.calls.slice(-2);
    expect(lastRender).toEqual([
      { ws: 'alpha', remember: false, live: false },
      { ws: 'beta', remember: false, live: true },
    ]);
  });

  it('does not stop showing the pane that lost focus', () => {
    render();
    fireEvent.click(screen.getByRole('button', { name: 'Beta' }));
    expect(screen.getByLabelText('Alpha')).toBeInTheDocument();
    expect(screen.getAllByText('chat pane')).toHaveLength(2);
  });

  it('catches the newly-focused pane up by refreshing its messages, decisions and conductor queries', () => {
    const { qc } = render();
    const spy = vi.spyOn(qc, 'invalidateQueries');
    fireEvent.click(screen.getByRole('button', { name: 'Beta' }));
    const invalidated = spy.mock.calls.map((c) => (c[0] as { queryKey: unknown[] }).queryKey);
    expect(invalidated).toContainEqual(['w', 'beta', 'threads']);
    expect(invalidated).toContainEqual(['w', 'beta', 'decisions']);
    expect(invalidated).toContainEqual(['w', 'beta', 'weaver']);
  });
});

describe('GlobalChatsRoute resize (VS-336)', () => {
  it('keyboard-resizes the two neighbours and leaves a third pane unchanged', () => {
    workspacesState.list = [
      { id: 'alpha', name: 'Alpha', needsYou: 0 },
      { id: 'beta', name: 'Beta', needsYou: 0 },
      { id: 'gamma', name: 'Gamma', needsYou: 0 },
    ];
    render();
    fireEvent.keyDown(screen.getByTestId('separator-alpha-beta'), { key: 'ArrowRight' });
    expect(grip('Alpha')).toBeGreaterThan(grip('Beta'));
    expect(grip('Gamma')).toBe(1);
    expect(Number(screen.getByTestId('separator-alpha-beta').getAttribute('aria-valuenow'))).toBeGreaterThan(50);
  });

  it('dragging a separator moves width between the two neighbours only', () => {
    workspacesState.list = [
      { id: 'alpha', name: 'Alpha', needsYou: 0 },
      { id: 'beta', name: 'Beta', needsYou: 0 },
      { id: 'gamma', name: 'Gamma', needsYou: 0 },
    ];
    render();
    const sep = screen.getByTestId('separator-alpha-beta');
    layout(sep.parentElement as HTMLElement, 1000);
    fireEvent.pointerDown(sep, { pointerId: 1, clientX: 500 });
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 700 });
    fireEvent.pointerUp(window, { pointerId: 1 });
    expect(grip('Alpha')).toBeCloseTo(1.6);
    expect(grip('Beta')).toBeCloseTo(0.4);
    expect(grip('Gamma')).toBe(1);
  });

  it('double-click resets the pair to equal widths', () => {
    render();
    fireEvent.keyDown(screen.getByTestId('separator-alpha-beta'), { key: 'ArrowRight' });
    expect(grip('Alpha')).not.toBeCloseTo(grip('Beta'));
    fireEvent.doubleClick(screen.getByTestId('separator-alpha-beta'));
    expect(grip('Alpha')).toBeCloseTo(grip('Beta'));
  });
});

describe('GlobalChatsRoute collapse (VS-336)', () => {
  it('renders a sliver on collapse and restores the width on expand', () => {
    render();
    fireEvent.keyDown(screen.getByTestId('separator-alpha-beta'), { key: 'ArrowRight' });
    const widened = grip('Alpha');
    fireEvent.click(screen.getByRole('button', { name: 'Collapse Alpha' }));
    expect(screen.getByRole('button', { name: 'Expand Alpha' })).toBeInTheDocument();
    expect(screen.getAllByText('chat pane')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Expand Alpha' }));
    expect(screen.getAllByText('chat pane')).toHaveLength(2);
    expect(grip('Alpha')).toBeCloseTo(widened);
  });

  it('does not offer collapse on the only expanded pane', () => {
    render();
    fireEvent.click(screen.getByRole('button', { name: 'Collapse Alpha' }));
    expect(screen.getByRole('button', { name: 'Collapse Beta' })).toBeDisabled();
  });

  it('shows the needs-you count on a collapsed sliver', () => {
    workspacesState.list = [
      { id: 'alpha', name: 'Alpha', needsYou: 3 },
      { id: 'beta', name: 'Beta', needsYou: 0 },
    ];
    render();
    fireEvent.click(screen.getByRole('button', { name: 'Collapse Alpha' }));
    expect(screen.getByLabelText('3 waiting for you')).toBeInTheDocument();
  });

  it('moves focus to the nearest expanded pane and keeps one live when the focused pane collapses', () => {
    render();
    const before = providers.calls.length;
    fireEvent.click(screen.getByRole('button', { name: 'Collapse Alpha' }));
    // The collapsed pane renders no provider at all; the one render that followed is Beta's, live.
    expect(providers.calls.slice(before)).toEqual([{ ws: 'beta', remember: false, live: true }]);
    expect(chatPanes.calls.filter((c) => c.focused).at(-1)).toEqual({ focused: true });
  });

  it('preserves a composer draft across collapse and expand', () => {
    render();
    fireEvent.change(screen.getByLabelText('draft-alpha'), { target: { value: 'hold this' } });
    fireEvent.click(screen.getByRole('button', { name: 'Collapse Alpha' }));
    fireEvent.click(screen.getByRole('button', { name: 'Expand Alpha' }));
    expect((screen.getByLabelText('draft-alpha') as HTMLInputElement).value).toBe('hold this');
  });
});

describe('GlobalChatsRoute reorder (VS-336)', () => {
  it('moves a pane with the menu, bounds the ends and persists across a remount', () => {
    const { unmount } = render();
    fireEvent.click(screen.getByRole('button', { name: 'Reorder Beta' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Move left' }));
    expect(JSON.parse(localStorage.getItem(KEY) ?? '{}').order).toEqual(['beta', 'alpha']);
    // Move left on the first pane is unavailable.
    fireEvent.click(screen.getByRole('button', { name: 'Reorder Beta' }));
    expect(screen.getByRole('menuitem', { name: 'Move left' })).toBeDisabled();
    unmount();
    render();
    expect(screen.getAllByLabelText(/^(Alpha|Beta)$/).map((el) => el.getAttribute('aria-label'))).toEqual(['Beta', 'Alpha']);
  });

  it('reorders by dragging a pane header, showing a drop indicator', () => {
    render();
    const header = screen.getByRole('button', { name: 'Alpha' }).parentElement as HTMLElement;
    fireEvent.dragStart(header, { dataTransfer: dataTransfer() });
    fireEvent.dragOver(screen.getByLabelText('Beta'), { dataTransfer: dataTransfer(), clientX: 10 });
    expect(screen.getByTestId('drop-indicator')).toBeInTheDocument();
    fireEvent.drop(screen.getByLabelText('Beta'), { dataTransfer: dataTransfer() });
    expect(JSON.parse(localStorage.getItem(KEY) ?? '{}').order).toEqual(['beta', 'alpha']);
  });
});

describe('GlobalChatsRoute persistence and narrow screens (VS-336)', () => {
  it('drops a removed workspace and appends a new one expanded at the default weight', () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({ order: ['gone', 'beta'], widths: { gone: 5, beta: 2 }, collapsed: { gone: true } }),
    );
    workspacesState.list = [
      { id: 'alpha', name: 'Alpha', needsYou: 0 },
      { id: 'beta', name: 'Beta', needsYou: 0 },
      { id: 'gamma', name: 'Gamma', needsYou: 0 },
    ];
    render();
    expect(screen.getAllByLabelText(/^(Alpha|Beta|Gamma)$/).map((el) => el.getAttribute('aria-label'))).toEqual([
      'Beta',
      'Alpha',
      'Gamma',
    ]);
    expect(grip('Beta')).toBe(2);
    expect(grip('Alpha')).toBe(1);
  });

  it('on a phone-width viewport drops the separators but keeps panes, collapse and the menu', () => {
    window.matchMedia = media(true);
    render();
    expect(screen.queryByTestId('separator-alpha-beta')).toBeNull();
    expect(screen.getByLabelText('Alpha').className).toContain('flex-1');
    expect(screen.getByRole('button', { name: 'Reorder Alpha' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Collapse Alpha' }));
    expect(screen.getByRole('button', { name: 'Expand Alpha' })).toBeInTheDocument();
  });
});
