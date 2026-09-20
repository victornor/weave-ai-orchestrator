/**
 * VS-525: the shared role-chat control — its start/open wording, the reason it is withheld for a
 * role that cannot serve a session, and the open-or-resume call it makes.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { agent, role } from './factories';

const state = vi.hoisted(() => ({
  go: vi.fn(),
  persistentSession: vi.fn(),
  pending: false,
  error: null as string | null,
}));

vi.mock('../app/link', () => ({
  A: ({ to, children, ...rest }: { to: string; children?: ReactNode }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
  useGo: () => state.go,
}));

vi.mock('../api/hooks', () => ({
  usePersistentSession: (_ws?: string, options?: { onOpened?: (agent: { id: string }) => void }) => ({
    mutate: (body: unknown) => {
      state.persistentSession(body);
      if (state.error === null) options?.onOpened?.({ id: 'a_new' });
    },
    isPending: state.pending,
    isError: state.error !== null,
    error: state.error ? new Error(state.error) : null,
  }),
}));

const { RoleChatControl, RoleChatRow, roleChatActionLabel, roleChatStateLabel, roleChatBlockedReason, sessionForRole, roleNavRows, workerFromRoleChatPath } =
  await import('../v2/roleChat');

beforeEach(() => {
  state.pending = false;
  state.error = null;
  state.go.mockClear();
  state.persistentSession.mockClear();
});

describe('the role-chat helpers', () => {
  it('names starting and opening apart', () => {
    expect(roleChatActionLabel(false)).toBe('Start chat');
    expect(roleChatActionLabel(true)).toBe('Open chat');
    expect(roleChatStateLabel(false)).toBe('No conversation yet');
    expect(roleChatStateLabel(true)).toBe('Conversation ready');
  });

  it('withholds the chat for a role that cannot serve one, with the reason', () => {
    expect(roleChatBlockedReason(role({ status: 'active' }))).toBeNull();
    expect(roleChatBlockedReason(role({ status: 'paused' }))).toMatch(/paused/i);
    expect(roleChatBlockedReason(role({ status: 'retired' }))).toMatch(/retired/i);
    expect(roleChatBlockedReason(role({ status: 'pending_activation' }))).toMatch(/hire approval/i);
  });

  it('finds the role’s session among the session agents', () => {
    const mine = agent({ id: 'a1', kind: 'session', roleId: 'r1' });
    const other = agent({ id: 'a2', kind: 'session', roleId: 'r2' });
    expect(sessionForRole([other, mine], 'r1')?.id).toBe('a1');
    expect(sessionForRole([agent({ id: 'w1', kind: 'worker', roleId: 'r1' })], 'r1')).toBeNull();
    expect(sessionForRole([], 'r1')).toBeNull();
  });
});

describe('the shared role-chat control', () => {
  it('offers to start a conversation and opens it on click', () => {
    const active = role({ id: 'r1', projectId: 'p1', name: 'Backend Engineer', status: 'active' });
    render(<RoleChatControl role={active} session={null} ws="ws1" />);
    const button = screen.getByRole('button', { name: 'Start chat' });
    expect(button).toHaveAttribute('title', 'No conversation yet');
    fireEvent.click(button);
    expect(state.persistentSession).toHaveBeenCalledWith({ projectId: 'p1', roleId: 'r1' });
    expect(state.go).toHaveBeenCalledWith('/w/$ws/workers/$workerId', { params: { ws: 'ws1', workerId: 'a_new' } });
  });

  it('offers to open an existing conversation when the session exists', () => {
    const active = role({ id: 'r1', projectId: 'p1', name: 'Backend Engineer', status: 'active' });
    const session = agent({ id: 'a1', kind: 'session', roleId: 'r1' });
    render(<RoleChatControl role={active} session={session} ws="ws1" />);
    expect(screen.getByRole('button', { name: 'Open chat' })).toHaveAttribute('title', 'Conversation ready');
  });

  it('offers no control for a paused role, only the reason', () => {
    render(<RoleChatControl role={role({ id: 'r1', projectId: 'p1', name: 'Backend Engineer', status: 'paused' })} session={null} ws="ws1" />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText(/paused/i)).toBeInTheDocument();
    expect(state.persistentSession).not.toHaveBeenCalled();
  });

  it('shows a failed open instead of swallowing it', () => {
    state.error = 'nope';
    render(<RoleChatControl role={role({ id: 'r1', projectId: 'p1', name: 'Backend Engineer', status: 'active' })} session={null} ws="ws1" />);
    expect(screen.getByText('The chat was not opened: nope')).toBeInTheDocument();
  });
});

describe('the sidebar role row list (VS-581)', () => {
  const roles = (n: number): ReturnType<typeof role>[] =>
    Array.from({ length: n }, (_v, i) => role({ id: `r${i}`, name: `Role ${i}`, status: 'active' }));

  it('shows nothing for a project with no roles', () => {
    expect(roleNavRows([])).toEqual({ shown: [], hiddenCount: 0 });
  });

  it('caps the shown rows and counts the rest', () => {
    const { shown, hiddenCount } = roleNavRows(roles(7));
    expect(shown).toHaveLength(5);
    expect(hiddenCount).toBe(2);
  });

  it('always includes the role whose conversation is open, even past the cap', () => {
    const list = roles(4);
    const { shown, hiddenCount } = roleNavRows(list, { cap: 2, activeRoleId: 'r3' });
    expect(shown.map((r) => r.id)).toEqual(['r0', 'r1', 'r3']);
    expect(hiddenCount).toBe(1);
  });

  it('reads the worker id from a session address and nothing from another address', () => {
    expect(workerFromRoleChatPath('/w/acme/workers/a1')).toBe('a1');
    expect(workerFromRoleChatPath('/w/acme/workers/a1/')).toBe('a1');
    expect(workerFromRoleChatPath('/w/acme/roles')).toBeNull();
    expect(workerFromRoleChatPath('/w/acme/workers/a1/extra')).toBeNull();
  });
});

describe('the sidebar role row (VS-581)', () => {
  it('opens an active role’s conversation in the row’s own workspace', () => {
    render(<RoleChatRow role={role({ id: 'r1', projectId: 'p1', name: 'Backend Engineer', status: 'active' })} session={null} ws="acme" />);
    const row = screen.getByRole('button', { name: 'Backend Engineer' });
    expect(row).toHaveAttribute('data-role-chat-row', 'r1');
    expect(row).toHaveAttribute('title', 'No conversation yet');
    fireEvent.click(row);
    expect(state.persistentSession).toHaveBeenCalledWith({ projectId: 'p1', roleId: 'r1' });
    expect(state.go).toHaveBeenCalledWith('/w/$ws/workers/$workerId', { params: { ws: 'acme', workerId: 'a_new' } });
  });

  it('closes its surface only once the session has opened (VS-617)', () => {
    const onNavigate = vi.fn();
    render(<RoleChatRow role={role({ id: 'r1', projectId: 'p1', name: 'Backend Engineer', status: 'active' })} session={null} ws="acme" onNavigate={onNavigate} />);
    expect(onNavigate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Backend Engineer' }));
    expect(onNavigate).toHaveBeenCalledTimes(1);
    expect(state.go).toHaveBeenCalledWith('/w/$ws/workers/$workerId', { params: { ws: 'acme', workerId: 'a_new' } });
  });

  it('does not close its surface and keeps the not-opened state when the open fails (VS-617)', () => {
    state.error = 'nope';
    const onNavigate = vi.fn();
    render(<RoleChatRow role={role({ id: 'r1', projectId: 'p1', name: 'Backend Engineer', status: 'active' })} session={null} ws="acme" onNavigate={onNavigate} />);
    fireEvent.click(screen.getByRole('button', { name: /Backend Engineer/ }));
    expect(onNavigate).not.toHaveBeenCalled();
    expect(state.go).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent('not opened');
  });

  it('marks the role whose session is the page shown', () => {
    render(<RoleChatRow role={role({ id: 'r1', projectId: 'p1', name: 'Backend Engineer', status: 'active' })} session={agent({ id: 'a1', kind: 'session', roleId: 'r1' })} ws="acme" current />);
    expect(screen.getByRole('button', { name: 'Backend Engineer' })).toHaveAttribute('data-role-chat-current', 'true');
  });

  it('renders a paused role as a non-actionable row carrying its reason', () => {
    render(<RoleChatRow role={role({ id: 'r1', projectId: 'p1', name: 'Backend Engineer', status: 'paused' })} session={null} ws="acme" />);
    expect(screen.queryByRole('button')).toBeNull();
    const row = screen.getByTitle(/paused/i);
    expect(row).toHaveAttribute('data-role-chat-blocked', 'r1');
    expect(row).toHaveTextContent('Backend Engineer');
    expect(state.persistentSession).not.toHaveBeenCalled();
  });
});
