/**
 * VS-617 regression: the role row's open must survive the surface that owns it unmounting before the
 * open-or-resume request resolves — the phone **More** sheet closes on success and unmounts the row,
 * and TanStack Query drops a per-call `mutate(vars, { onSuccess })` callback once the observer is
 * gone. These use the real `usePersistentSession`/`useMutation` with a deferred fetch so the unmount
 * genuinely happens mid-request.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { role } from './factories';

const state = vi.hoisted(() => ({ go: vi.fn() }));

vi.mock('../app/link', () => ({
  A: ({ to, children, ...rest }: { to: string; children?: ReactNode }) => (
    <a href={to} {...rest}>{children}</a>
  ),
  useGo: () => state.go,
}));

const { RoleChatRow } = await import('../v2/roleChat');

function jsonResponse(body: unknown): Response {
  return { status: 200, ok: true, text: async () => JSON.stringify(body) } as unknown as Response;
}

function deferred(): { promise: Promise<Response>; resolve: (r: Response) => void } {
  let resolve!: (r: Response) => void;
  const promise = new Promise<Response>((res) => { resolve = res; });
  return { promise, resolve };
}

function mount(ui: React.ReactElement): ReturnType<typeof render> {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

const activeRole = (): ReturnType<typeof role> => role({ id: 'r1', projectId: 'p1', name: 'Backend Engineer', status: 'active' });

describe('VS-617 role-row open vs. unmount', () => {
  beforeEach(() => {
    state.go.mockClear();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('navigates when the surface unmounts the row before the open resolves', async () => {
    const { promise, resolve } = deferred();
    globalThis.fetch = vi.fn(() => promise) as unknown as typeof fetch;

    const view = mount(<RoleChatRow role={activeRole()} session={null} ws="acme" onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Backend Engineer' }));
    // The phone More sheet unmounts the row when it closes, before the request settles.
    view.unmount();

    resolve(jsonResponse({ agent: { id: 'a_new' }, thread: { id: 't1' } }));
    await waitFor(() => expect(state.go).toHaveBeenCalledWith('/w/$ws/workers/$workerId', { params: { ws: 'acme', workerId: 'a_new' } }));
  });

  it('navigates from the desktop rail where the row stays mounted', async () => {
    globalThis.fetch = vi.fn(async () => jsonResponse({ agent: { id: 'a_new' }, thread: { id: 't1' } })) as unknown as typeof fetch;
    mount(<RoleChatRow role={activeRole()} session={null} ws="acme" />);
    fireEvent.click(screen.getByRole('button', { name: 'Backend Engineer' }));
    await waitFor(() => expect(state.go).toHaveBeenCalledWith('/w/$ws/workers/$workerId', { params: { ws: 'acme', workerId: 'a_new' } }));
  });

  it('opens and navigates against the row’s own workspace', async () => {
    const calls: string[] = [];
    globalThis.fetch = vi.fn((input: unknown) => {
      calls.push(String(input));
      return Promise.resolve(jsonResponse({ agent: { id: 'a_beta' }, thread: { id: 't1' } }));
    }) as unknown as typeof fetch;
    mount(<RoleChatRow role={activeRole()} session={null} ws="beta" />);
    fireEvent.click(screen.getByRole('button', { name: 'Backend Engineer' }));
    await waitFor(() => expect(state.go).toHaveBeenCalledWith('/w/$ws/workers/$workerId', { params: { ws: 'beta', workerId: 'a_beta' } }));
    expect(calls.some((c) => c.includes('/api/w/beta/workers/persistent-session'))).toBe(true);
  });
});
