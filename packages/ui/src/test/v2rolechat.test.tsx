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
  usePersistentSession: () => ({
    mutate: state.persistentSession,
    isPending: state.pending,
    isError: state.error !== null,
    error: state.error ? new Error(state.error) : null,
  }),
}));

const { RoleChatControl, roleChatActionLabel, roleChatStateLabel, roleChatBlockedReason, sessionForRole } =
  await import('../v2/roleChat');

beforeEach(() => {
  state.pending = false;
  state.error = null;
  state.go.mockClear();
  state.persistentSession.mockReset();
  state.persistentSession.mockImplementation((_body: unknown, opts?: { onSuccess?: (r: { agent: { id: string } }) => void }) =>
    opts?.onSuccess?.({ agent: { id: 'a_new' } }),
  );
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
    expect(state.persistentSession).toHaveBeenCalledWith({ projectId: 'p1', roleId: 'r1' }, expect.objectContaining({ onSuccess: expect.any(Function) }));
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
