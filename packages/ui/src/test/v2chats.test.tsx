/**
 * VS-352: the V2 Global Chats screen (`/chats`) — one pane per workspace, each the V2 Chat screen,
 * with V1's resize / collapse / reorder behaviour and a layout remembered under V2's own key.
 *
 * The per-pane run-stream gate is unit-tested in `v2chat.test.tsx` (a `focused={false}` ChatPage does
 * not open a live run stream). This file proves the other half: only one pane is passed `focused`, so
 * with two panes whose weavers are both running exactly one run stream can be live (VS-199).
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render as rtlRender, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';

const providers = vi.hoisted(() => ({ calls: [] as Array<{ ws: string; remember: boolean; live: boolean }> }));
const chatPanes = vi.hoisted(() => ({ calls: [] as Array<{ focused: boolean }> }));
const workspacesState = vi.hoisted(() => ({
  list: [
    { id: 'alpha', name: 'Alpha', needsYou: 0 },
    { id: 'beta', name: 'Beta', needsYou: 0 },
  ] as Array<{ id: string; name: string; needsYou: number }>,
}));

vi.mock('@tanstack/react-router', () => ({
  useRouterState: () => '/chats',
  useParams: () => ({}),
}));

vi.mock('../api/hooks', () => ({
  useWorkspaces: () => ({ data: workspacesState.list, isError: false, refetch: vi.fn() }),
  useWorkers: () => ({ data: [] }),
  useWorkersMany: (ids: readonly string[]) => ids.map(() => ({ data: [] })),
  useDecisionsMany: (ids: readonly string[]) => ids.map(() => ({ data: [] })),
  useIncidents: () => ({ data: { items: [] } }),
}));

vi.mock('../api/keys', () => ({
  qk: {
    threads: (ws: string) => ['w', ws, 'threads'],
    decisions: (ws: string) => ['w', ws, 'decisions'],
    weaver: (ws: string) => ['w', ws, 'weaver'],
  },
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
      children: ReactNode;
    }) => {
      providers.calls.push({ ws, remember, live });
      return <div data-ws={ws}>{React.cloneElement(children as React.ReactElement<{ ws?: string }>, { ws })}</div>;
    },
  };
});

vi.mock('../v2/ChatPage', () => ({
  V2ChatPage: ({ focused = true }: { focused?: boolean } = {}) => {
    chatPanes.calls.push({ focused });
    return <div>chat pane</div>;
  },
}));

const { V2ChatsScreen } = await import('../v2/chats/ChatsPage');

const KEY = 'weave.v2.chats.layout';
const V1_KEY = 'conductor.globalChats.layout';

function render(): { qc: QueryClient } & ReturnType<typeof rtlRender> {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const result = rtlRender(
    <QueryClientProvider client={qc}>
      <V2ChatsScreen />
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
  providers.calls = [];
  chatPanes.calls = [];
  workspacesState.list = [
    { id: 'alpha', name: 'Alpha', needsYou: 0 },
    { id: 'beta', name: 'Beta', needsYou: 0 },
  ];
  localStorage.clear();
  realMatchMedia = window.matchMedia;
  window.matchMedia = media(false);
});

afterEach(() => {
  window.matchMedia = realMatchMedia;
});

describe('the V2 Chats screen', () => {
  it('shows a labelled pane per workspace in a horizontal row, all under the V2 header', () => {
    const { container } = render();
    expect(screen.getByRole('heading', { name: 'Chats' })).toBeInTheDocument();
    expect(screen.getByLabelText('Alpha')).toBeInTheDocument();
    expect(screen.getByLabelText('Beta')).toBeInTheDocument();
    expect(screen.getAllByText('chat pane')).toHaveLength(2);
    expect(container.querySelector('.overflow-x-auto')).not.toBeNull();
  });

  it('renders nothing but an empty state when there are no workspaces', () => {
    workspacesState.list = [];
    render();
    expect(screen.getByText('No workspaces.')).toBeInTheDocument();
  });

  it('does not rewrite the remembered workspace', () => {
    render();
    expect(providers.calls).toEqual([
      { ws: 'alpha', remember: false, live: true },
      { ws: 'beta', remember: false, live: false },
    ]);
  });

  it('holds exactly one live pane and one run stream however many workspaces are listed (VS-199)', () => {
    workspacesState.list = Array.from({ length: 6 }, (_, i) => ({ id: `ws${i}`, name: `W${i}`, needsYou: 0 }));
    render();
    expect(providers.calls).toHaveLength(6);
    expect(providers.calls.filter((c) => c.live)).toHaveLength(1);
    expect(chatPanes.calls.filter((c) => c.focused)).toHaveLength(1);
  });

  it('moves the live pane when the human chooses a different one', () => {
    render();
    fireEvent.click(screen.getByRole('button', { name: 'Beta' }));
    expect(providers.calls.slice(-2)).toEqual([
      { ws: 'alpha', remember: false, live: false },
      { ws: 'beta', remember: false, live: true },
    ]);
  });

  it('catches the newly-focused pane up by refreshing its queries', () => {
    const { qc } = render();
    const spy = vi.spyOn(qc, 'invalidateQueries');
    fireEvent.click(screen.getByRole('button', { name: 'Beta' }));
    const invalidated = spy.mock.calls.map((c) => (c[0] as { queryKey: unknown[] }).queryKey);
    expect(invalidated).toContainEqual(['w', 'beta', 'threads']);
    expect(invalidated).toContainEqual(['w', 'beta', 'decisions']);
    expect(invalidated).toContainEqual(['w', 'beta', 'weaver']);
  });
});

describe('V2 Chats resize', () => {
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
  });

  it('double-click resets the pair to equal widths', () => {
    render();
    fireEvent.keyDown(screen.getByTestId('separator-alpha-beta'), { key: 'ArrowRight' });
    expect(grip('Alpha')).not.toBeCloseTo(grip('Beta'));
    fireEvent.doubleClick(screen.getByTestId('separator-alpha-beta'));
    expect(grip('Alpha')).toBeCloseTo(grip('Beta'));
  });
});

describe('V2 Chats collapse', () => {
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
    expect(providers.calls.slice(before)).toEqual([{ ws: 'beta', remember: false, live: true }]);
    expect(chatPanes.calls.filter((c) => c.focused).at(-1)).toEqual({ focused: true });
  });
});

describe('V2 Chats reorder', () => {
  it('moves a pane with the menu, bounds the ends and persists across a remount', () => {
    const { unmount } = render();
    fireEvent.click(screen.getByRole('button', { name: 'Reorder Beta' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Move left' }));
    expect(JSON.parse(localStorage.getItem(KEY) ?? '{}').order).toEqual(['beta', 'alpha']);
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

describe('V2 Chats persistence and narrow screens', () => {
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

  it('leaves V1\'s stored layout untouched', () => {
    localStorage.setItem(V1_KEY, JSON.stringify({ order: ['alpha'], widths: { alpha: 9 }, collapsed: {} }));
    render();
    fireEvent.click(screen.getByRole('button', { name: 'Reorder Beta' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Move left' }));
    expect(localStorage.getItem(V1_KEY)).toBe(JSON.stringify({ order: ['alpha'], widths: { alpha: 9 }, collapsed: {} }));
    expect(JSON.parse(localStorage.getItem(KEY) ?? '{}').order).toEqual(['beta', 'alpha']);
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
