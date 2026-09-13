/** The four ticket-action hooks VS-346 adds call the existing endpoint with the right method. */
import { renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  calls: [] as Array<{ ws: string; path: string; method?: string; body?: unknown }>,
}));

vi.mock('../api/context', () => ({ useWs: () => 'ws1' }));
vi.mock('../api/client', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../api/client');
  return {
    ...actual,
    api: {
      ws: (workspace: string, path: string, init?: { method?: string; body?: unknown }) => {
        state.calls.push({ ws: workspace, path, method: init?.method, body: init?.body });
        return Promise.resolve({ id: 'tk_1' });
      },
    },
  };
});

const { useCancelTicket, useDiscardTicket, useAssignTicket, useSetTicketBlockers } = await import('../api/hooks');

function wrapper({ children }: { children: React.ReactNode }): React.ReactElement {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  state.calls = [];
});

describe('the V2 ticket action hooks', () => {
  it('cancel posts a reason to /tickets/:id/cancel', async () => {
    const { result } = renderHook(() => useCancelTicket(), { wrapper });
    await result.current.mutateAsync({ id: 'tk_1', reason: 'stop' });
    expect(state.calls).toEqual([{ ws: 'ws1', path: '/tickets/tk_1/cancel', method: 'POST', body: { reason: 'stop' } }]);
  });

  it('discard force-posts to /tickets/:id/discard', async () => {
    const { result } = renderHook(() => useDiscardTicket(), { wrapper });
    await result.current.mutateAsync({ id: 'tk_1' });
    expect(state.calls).toEqual([{ ws: 'ws1', path: '/tickets/tk_1/discard', method: 'POST', body: { force: true } }]);
  });

  it('assign posts the role to /tickets/:id/assign', async () => {
    const { result } = renderHook(() => useAssignTicket(), { wrapper });
    await result.current.mutateAsync({ id: 'tk_1', roleId: 'r1' });
    expect(state.calls).toEqual([{ ws: 'ws1', path: '/tickets/tk_1/assign', method: 'POST', body: { roleId: 'r1' } }]);
  });

  it('blockers puts the full list to /tickets/:id/blockers', async () => {
    const { result } = renderHook(() => useSetTicketBlockers(), { wrapper });
    await result.current.mutateAsync({ id: 'tk_1', blockedBy: [] });
    expect(state.calls).toEqual([{ ws: 'ws1', path: '/tickets/tk_1/blockers', method: 'PUT', body: { blockedBy: [] } }]);
  });
});
