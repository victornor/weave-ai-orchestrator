/** VS-769: the shell banner for an expired runtime login — text, fix, re-check, and gone when restored. */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  credentials: [] as Array<Record<string, unknown>>,
  mutate: vi.fn(),
  recheck: { isPending: false, isSuccess: false, data: undefined as unknown, variables: undefined as unknown },
}));

vi.mock('../api/hooks', () => ({
  useRuntimeCredentialsMany: (ids: readonly string[]) => ids.map(() => ({ data: state.credentials })),
  useRecheckRuntimeLogin: () => ({ mutate: state.mutate, ...state.recheck }),
}));

import { LoginBanner } from '../v2/LoginBanner';

const cred = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  workspaceId: 'ws1', runtimeId: 'claude', displayName: 'Claude Code', present: true, expiresAt: null,
  lastVerifiedAt: null, refreshFailedAt: '2026-10-03T14:45:00.000Z', needsLogin: true, detail: null, updatedAt: '', ...over,
});

beforeEach(() => { state.credentials = []; state.mutate.mockReset(); state.recheck = { isPending: false, isSuccess: false, data: undefined, variables: undefined }; });
afterEach(cleanup);

describe('LoginBanner', () => {
  it('shows nothing while every login works', () => {
    state.credentials = [cred({ needsLogin: false })];
    render(<LoginBanner workspaceIds={['ws1']} />);
    expect(screen.queryByTestId('login-banner')).toBeNull();
  });

  it('names the runtime and gives its exact command', () => {
    state.credentials = [cred()];
    render(<LoginBanner workspaceIds={['ws1']} />);
    const banner = screen.getByTestId('login-banner');
    expect(banner.textContent).toContain('Claude Code login expired');
    expect(banner.textContent).toContain('weave runtime login claude');
  });

  it('gives another runtime its own command', () => {
    state.credentials = [cred({ runtimeId: 'codex', displayName: 'Codex' })];
    render(<LoginBanner workspaceIds={['ws1']} />);
    expect(screen.getByTestId('login-banner').textContent).toContain('weave runtime login codex');
  });

  it('re-checks the runtime in its workspace when asked', () => {
    state.credentials = [cred()];
    render(<LoginBanner workspaceIds={['ws1']} />);
    fireEvent.click(screen.getByRole('button', { name: /re-check/ }));
    expect(state.mutate).toHaveBeenCalledWith({ ws: 'ws1', runtimeId: 'claude' });
  });

  it('says it is still down, and why, after a re-check that did not release', () => {
    state.credentials = [cred()];
    state.recheck = { isPending: false, isSuccess: true, data: { released: false, reason: 'the claude probe could not describe the account' }, variables: { ws: 'ws1', runtimeId: 'claude' } };
    render(<LoginBanner workspaceIds={['ws1']} />);
    expect(screen.getByTestId('login-banner').textContent).toContain('Still down: the claude probe could not describe the account');
  });
});
