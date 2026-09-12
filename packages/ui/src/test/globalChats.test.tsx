/** VS-168: daemon-wide Chats page. VS-199: exactly one pane is live at a time. */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render as rtlRender, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const remembered = vi.hoisted(() => ({ ws: 'kept' as string | null }));
/** Every render of the mocked `WorkspaceProvider`, in order — captures `live` so a test can tell
 *  how many panes hold a subscription at once, regardless of how many workspaces are listed. */
const providers = vi.hoisted(() => ({ calls: [] as Array<{ ws: string; remember: boolean; live: boolean }> }));
const chatPanes = vi.hoisted(() => ({ calls: [] as Array<{ focused: boolean }> }));
const workspacesState = vi.hoisted(() => ({
  list: [
    { id: 'alpha', name: 'Alpha' },
    { id: 'beta', name: 'Beta' },
  ] as Array<{ id: string; name: string }>,
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
      return <div data-ws={ws}>{children}</div>;
    },
  };
});

vi.mock('../routes/Chat', () => ({
  ChatPage: ({ focused = true }: { focused?: boolean } = {}) => {
    chatPanes.calls.push({ focused });
    return <div>chat pane</div>;
  },
}));

const { GlobalChatsRoute } = await import('../routes/GlobalChats');

function render(): { qc: QueryClient } & ReturnType<typeof rtlRender> {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const result = rtlRender(
    <QueryClientProvider client={qc}>
      <GlobalChatsRoute />
    </QueryClientProvider>,
  );
  return { qc, ...result };
}

beforeEach(() => {
  remembered.ws = 'kept';
  providers.calls = [];
  chatPanes.calls = [];
  workspacesState.list = [
    { id: 'alpha', name: 'Alpha' },
    { id: 'beta', name: 'Beta' },
  ];
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
    workspacesState.list = Array.from({ length: 10 }, (_, i) => ({ id: `ws${i}`, name: `W${i}` }));
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
