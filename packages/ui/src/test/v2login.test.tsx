/**
 * The sign-in screen (VS-353, VS-456): it reuses V1's password → TOTP flow, and returns to the root
 * address it was sent from — and to no other.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { go, root } = vi.hoisted(() => ({ go: vi.fn(), root: vi.fn() }));
const { resetRefused } = vi.hoisted(() => ({ resetRefused: vi.fn() }));

vi.mock('../app/link', () => ({ useGo: () => go }));
vi.mock('../v2/auth', async (orig) => {
  const actual = await orig<typeof import('../v2/auth')>();
  return { ...actual, resetV2RefusedCache: resetRefused };
});
vi.mock('@tanstack/react-query', async (orig) => {
  const actual = await orig<typeof import('@tanstack/react-query')>();
  return {
    ...actual,
    useQueryClient: () => ({
      invalidateQueries: vi.fn(),
      fetchQuery: (o: { queryFn: () => Promise<unknown> }) => o.queryFn(),
    }),
  };
});
vi.mock('../api/client', async (orig) => {
  const actual = await orig<typeof import('../api/client')>();
  return { ...actual, api: { root, ws: vi.fn(), qs: actual.api.qs }, setToken: vi.fn(), setWorkspaceId: vi.fn() };
});
vi.mock('../api/hooks', () => ({
  useHealth: () => ({
    data: { version: 'abc1234def', tlsMode: 'none', operatorConfigured: true, workspaces: [] },
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  }),
  useMe: () => ({ isSuccess: false, data: undefined, isLoading: false }),
}));

const { V2Login } = await import('../v2/V2Login');

function signIn(): void {
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'secret-password' } });
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
}

beforeEach(() => {
  go.mockClear();
  root.mockReset();
  resetRefused.mockClear();
  window.history.replaceState({}, '', '/login');
});

describe('the V2 sign-in flow', () => {
  it('advances to the TOTP step when the daemon requires a code', async () => {
    root.mockImplementation(async (path: string) => (path === '/auth/login' ? { totpRequired: true } : {}));
    render(<V2Login />);
    signIn();
    expect(await screen.findByRole('heading', { name: 'Enter your code' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Six-digit authentication code' })).toBeInTheDocument();
  });

  it('returns to the remembered address after sign-in', async () => {
    window.history.replaceState({}, '', '/login?next=' + encodeURIComponent('/w/acme/work'));
    root.mockImplementation(async (path: string) => {
      if (path === '/auth/login') return { token: 'tok' };
      if (path === '/health') return { version: 'x', tlsMode: 'none', operatorConfigured: true, workspaces: [{ id: 'acme' }] };
      return {};
    });
    render(<V2Login />);
    signIn();
    await waitFor(() => expect(go).toHaveBeenCalledWith('/w/acme/work', { replace: true }));
  });

  it('ignores a next that is not a root path', async () => {
    window.history.replaceState({}, '', '/login?next=' + encodeURIComponent('w/acme/work'));
    root.mockImplementation(async (path: string) => {
      if (path === '/auth/login') return { token: 'tok' };
      if (path === '/health') return { version: 'x', tlsMode: 'none', operatorConfigured: true, workspaces: [{ id: 'acme' }] };
      return {};
    });
    render(<V2Login />);
    signIn();
    await waitFor(() => expect(go).toHaveBeenCalledWith('/w/acme/needs', { replace: true }));
  });

  it('forgets the guard’s cached refusal before landing, so a fresh sign-in is not bounced back', async () => {
    root.mockImplementation(async (path: string) => {
      if (path === '/auth/login') return { token: 'tok' };
      if (path === '/health') return { version: 'x', tlsMode: 'none', operatorConfigured: true, workspaces: [{ id: 'acme' }] };
      return {};
    });
    render(<V2Login />);
    signIn();
    await waitFor(() => expect(go).toHaveBeenCalledWith('/w/acme/needs', { replace: true }));
    expect(resetRefused).toHaveBeenCalled();
    expect(go.mock.calls[0]?.[0]).not.toBe('/login');
    // the cache is cleared before the landing navigation, not after it
    expect(resetRefused.mock.invocationCallOrder[0]).toBeLessThan(go.mock.invocationCallOrder[0]!);
  });
});
