/** VS-168: daemon-wide Chats page. */
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const remembered = vi.hoisted(() => ({ ws: 'kept' as string | null }));
const providers = vi.hoisted(() => ({ calls: [] as Array<{ ws: string; remember: boolean }> }));

vi.mock('../api/hooks', () => ({
  useWorkspaces: () => ({
    data: [
      { id: 'alpha', name: 'Alpha' },
      { id: 'beta', name: 'Beta' },
    ],
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
    WorkspaceProvider: ({ ws, remember = true, children }: { ws: string; remember?: boolean; children: React.ReactNode }) => {
      providers.calls.push({ ws, remember });
      return <div data-ws={ws}>{children}</div>;
    },
  };
});

vi.mock('../routes/Chat', () => ({
  ChatPage: () => <div>chat pane</div>,
}));

const { GlobalChatsRoute } = await import('../routes/GlobalChats');

beforeEach(() => {
  remembered.ws = 'kept';
  providers.calls = [];
});

describe('GlobalChatsRoute', () => {
  it('shows a labelled pane per workspace in a horizontal row', () => {
    const { container } = render(<GlobalChatsRoute />);
    expect(screen.getByLabelText('Alpha')).toBeInTheDocument();
    expect(screen.getByLabelText('Beta')).toBeInTheDocument();
    expect(screen.getAllByText('chat pane')).toHaveLength(2);
    expect(container.querySelector('.overflow-x-auto')).not.toBeNull();
  });

  it('does not rewrite the remembered workspace', () => {
    render(<GlobalChatsRoute />);
    expect(providers.calls).toEqual([
      { ws: 'alpha', remember: false },
      { ws: 'beta', remember: false },
    ]);
    expect(remembered.ws).toBe('kept');
  });
});
