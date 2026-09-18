/**
 * VS-549: the block-title fan-out behind a sent message's roadmap block marker. A thread spans
 * projects, so the hook merges each referenced project's blocks into one `blockId → title` map,
 * reusing the existing `roadmapBlocks` query key so it shares the composer's cache.
 */
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  calls: [] as Array<{ ws: string; path: string }>,
  blocks: {} as Record<string, Array<{ id: string; title: string }>>,
}));

vi.mock('../api/context', () => ({
  useWs: () => 'ws1',
  useHookWs: () => 'ws1',
}));

vi.mock('../api/client', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../api/client');
  return {
    ...actual,
    api: {
      ws: (ws: string, path: string) => {
        state.calls.push({ ws, path });
        const projectId = path.split('/')[2] ?? '';
        return Promise.resolve({ blocks: state.blocks[projectId] ?? [] });
      },
    },
  };
});

const { useRoadmapBlockTitles } = await import('../api/hooks');

function client(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function wrapper(qc: QueryClient) {
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

beforeEach(() => {
  state.calls = [];
  state.blocks = {};
});

describe('useRoadmapBlockTitles (VS-549)', () => {
  it('merges every referenced project’s blocks into one title map', async () => {
    state.blocks = {
      p1: [{ id: 'b1', title: 'UI polish' }, { id: 'b2', title: 'Chat' }],
      p2: [{ id: 'b3', title: 'API' }],
    };
    const { result } = renderHook(() => useRoadmapBlockTitles(['p1', 'p2']), { wrapper: wrapper(client()) });

    await waitFor(() => expect(result.current.get('b3')).toBe('API'));
    expect(result.current.get('b1')).toBe('UI polish');
    expect(result.current.get('b2')).toBe('Chat');
    expect(state.calls.map((c) => `${c.ws}${c.path}`)).toEqual(expect.arrayContaining([
      'ws1/projects/p1/roadmap/blocks',
      'ws1/projects/p2/roadmap/blocks',
    ]));
  });

  it('issues no request when no project is referenced', async () => {
    const { result } = renderHook(() => useRoadmapBlockTitles([]), { wrapper: wrapper(client()) });
    await waitFor(() => expect(result.current.size).toBe(0));
    expect(state.calls).toEqual([]);
  });
});
