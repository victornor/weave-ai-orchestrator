/** VS-350: the V2 Runs table — cross-workspace merge, state filter and load-more. */
import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Run } from '@weave-ai/shared';
import { run as makeRun } from './factories';

const state = vi.hoisted(() => ({
  search: {} as Record<string, string | undefined>,
  runsByWs: {} as Record<string, Run[]>,
  go: vi.fn() as unknown as ReturnType<typeof vi.fn>,
  calls: [] as Array<{ ids: string[]; params: { status?: string; sort?: string; dir?: string; limit?: number } }>,
}));

/** The server's ordering, so a test proves the query reaches it rather than the loaded rows. */
function serverValue(r: Run, sort: string): number | null {
  if (sort === 'cost') return r.costCents;
  if (sort === 'tokens') return r.usage ? r.usage.inputTokens + r.usage.outputTokens : null;
  return null;
}
function serverSort(runs: Run[], sort: string, dir: string): Run[] {
  const sign = dir === 'asc' ? 1 : -1;
  return [...runs].sort((a, b) => {
    const av = serverValue(a, sort);
    const bv = serverValue(b, sort);
    if (av === null || bv === null) return av === null ? (bv === null ? 0 : 1) : -1;
    return av === bv ? 0 : av < bv ? -sign : sign;
  });
}

vi.mock('@tanstack/react-router', () => ({
  useRouterState: (o?: { select?: (s: { location: { pathname: string } }) => unknown }) => (o?.select ? o.select({ location: { pathname: '/runs' } }) : '/runs'),
  useParams: () => ({}),
}));
vi.mock('../app/link', () => ({ useSearchParams: () => state.search, useGo: () => state.go }));
vi.mock('../api/hooks', () => ({
  useWorkspaces: () => ({ data: [{ id: 'ws1', name: 'Acme' }, { id: 'ws2', name: 'Fernwood' }], isError: false, refetch: vi.fn() }),
  useWorkersMany: (ids: string[]) =>
    ids.map((id) => ({ data: id === 'ws1' ? [{ id: 'a1', name: 'Backend Engineer #7' }] : [{ id: 'a2', name: 'Web Engineer #1' }] })),
  useWeaverMany: (ids: string[]) =>
    ids.map((id) => ({ data: { agent: { id: id === 'ws1' ? 'wv1' : 'wv2', name: id === 'ws1' ? 'Acme Weaver' : 'Fernwood Weaver' } } })),
  useRunPagesMany: (ids: string[], params: { status?: string; sort?: string; dir?: string; limit?: number } = {}) => {
    state.calls.push({ ids, params });
    return ids.map((id) => {
      let all = (state.runsByWs[id] ?? []).filter((r) => !params.status || r.status === params.status);
      if (params.sort) all = serverSort(all, params.sort, params.dir ?? 'desc');
      const limit = params.limit ?? 50;
      return { data: { runs: all.slice(0, limit), total: all.length }, isError: false, refetch: vi.fn() };
    });
  },
  useWorkers: () => ({ data: [] }),
  useIncidents: () => ({ data: { items: [], total: 0 } }),
}));

const { RunsBody, mergeRuns } = await import('../v2/RunsPage');

const tableRows = (): number => document.querySelectorAll('[data-v2-runs-table] tbody tr').length;

beforeEach(() => {
  state.search = {};
  state.go = vi.fn();
  state.runsByWs = {};
  state.calls = [];
});

describe('mergeRuns', () => {
  it('orders across workspaces by createdAt, newest first', () => {
    const merged = mergeRuns([
      makeRun({ id: 'a', createdAt: '2026-09-01T08:00:00.000Z' }),
      makeRun({ id: 'b', createdAt: '2026-09-01T11:00:00.000Z' }),
      makeRun({ id: 'c', createdAt: '2026-09-01T09:00:00.000Z' }),
    ]);
    expect(merged.map((r) => r.id)).toEqual(['b', 'c', 'a']);
  });

  it('orders by a measure and puts runs missing it last, in both directions', () => {
    const runs = [
      makeRun({ id: 'cheap', costCents: 5 }),
      makeRun({ id: 'dear', costCents: 500 }),
      makeRun({ id: 'unknown', costCents: null }),
    ];
    expect(mergeRuns(runs, 'cost', 'desc').map((r) => r.id)).toEqual(['dear', 'cheap', 'unknown']);
    expect(mergeRuns(runs, 'cost', 'asc').map((r) => r.id)).toEqual(['cheap', 'dear', 'unknown']);
  });
});

describe('V2 Runs', () => {
  it('merges two workspaces and shows each agent', () => {
    state.runsByWs = {
      ws1: [makeRun({ id: 'r1', agentId: 'a1', status: 'succeeded', createdAt: '2026-09-01T09:00:00.000Z' })],
      ws2: [makeRun({ id: 'r2', agentId: 'a2', status: 'running', createdAt: '2026-09-01T10:00:00.000Z' })],
    };
    render(<RunsBody />);
    expect(screen.getByText('2 shown')).toBeInTheDocument();
    const rows = document.querySelectorAll('[data-v2-runs-table] tbody tr');
    expect(rows).toHaveLength(2);
    expect(within(rows[0] as HTMLElement).getByText('Web Engineer #1')).toBeInTheDocument();
  });

  it('names a weaver run, and a neutral label instead of an unknown agent id', () => {
    state.runsByWs = {
      ws1: [makeRun({ id: 'r1', agentId: 'wv1', status: 'succeeded', createdAt: '2026-09-01T09:00:00.000Z' })],
      ws2: [makeRun({ id: 'r2', agentId: 'ghost', status: 'succeeded', createdAt: '2026-09-01T10:00:00.000Z' })],
    };
    render(<RunsBody />);
    const rows = document.querySelectorAll('[data-v2-runs-table] tbody tr');
    expect(within(rows[1] as HTMLElement).getByText('Acme Weaver')).toBeInTheDocument();
    expect(within(rows[0] as HTMLElement).getByText('Unknown agent')).toBeInTheDocument();
    expect(screen.queryByText(/ghost/)).toBeNull();
  });

  it('filters by state chip', () => {
    state.runsByWs = {
      ws1: [
        makeRun({ id: 'r1', agentId: 'a1', status: 'succeeded', createdAt: '2026-09-01T09:00:00.000Z' }),
        makeRun({ id: 'r2', agentId: 'a1', status: 'failed', createdAt: '2026-09-01T10:00:00.000Z' }),
      ],
      ws2: [],
    };
    render(<RunsBody />);
    fireEvent.click(screen.getByRole('radio', { name: 'failed' }));
    expect(screen.getByText('1 shown')).toBeInTheDocument();
    expect(tableRows()).toBe(1);
  });

  it('loads more older turns without dropping what is shown', () => {
    state.runsByWs = {
      ws1: Array.from({ length: 55 }, (_, i) =>
        makeRun({ id: `r${i}`, agentId: 'a1', status: 'succeeded', createdAt: new Date(Date.UTC(2026, 8, 1, 12, 0, i)).toISOString() }),
      ),
      ws2: [],
    };
    render(<RunsBody />);
    expect(tableRows()).toBe(50);
    expect(screen.getByText('50 of 55')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
    expect(tableRows()).toBe(55);
    expect(screen.getByText('55 shown')).toBeInTheDocument();
  });

  it('opens a run from its row', () => {
    state.runsByWs = { ws1: [makeRun({ id: 'r1', agentId: 'a1', status: 'succeeded', createdAt: '2026-09-01T09:00:00.000Z' })], ws2: [] };
    render(<RunsBody />);
    fireEvent.click(document.querySelector('[data-v2-runs-table] tbody tr') as HTMLElement);
    expect(state.go).toHaveBeenCalledWith('/runs/$runId', expect.objectContaining({ params: { runId: 'r1' } }));
  });
});

describe('the V2 Runs workspace filter and sort (VS-410)', () => {
  it('narrows to one workspace by name and queries only it', () => {
    state.runsByWs = {
      ws1: [makeRun({ id: 'r1', agentId: 'a1', createdAt: '2026-09-01T09:00:00.000Z' })],
      ws2: [makeRun({ id: 'r2', agentId: 'a2', createdAt: '2026-09-01T10:00:00.000Z' })],
    };
    render(<RunsBody />);
    fireEvent.change(screen.getByLabelText('Workspace'), { target: { value: 'ws2' } });

    expect(state.calls.at(-1)?.ids).toEqual(['ws2']);
    expect(tableRows()).toBe(1);
    expect(within(document.querySelector('[data-v2-runs-table] tbody tr') as HTMLElement).getByText('Web Engineer #1')).toBeInTheDocument();
    // The options carry names, never the internal ids.
    expect(screen.getByRole('option', { name: 'Acme' })).toBeInTheDocument();
    expect(screen.queryByText('ws1')).toBeNull();
  });

  it('orders by cost through the server, so the most expensive run beyond the first page is first', () => {
    state.runsByWs = {
      ws1: Array.from({ length: 60 }, (_, i) =>
        makeRun({ id: `a${i}`, agentId: 'a1', costCents: i + 1, createdAt: new Date(Date.UTC(2026, 8, 1, 10, 0, i)).toISOString() }),
      ),
      ws2: [makeRun({ id: 'big', agentId: 'a2', costCents: 10_000, createdAt: '2026-09-01T09:00:00.000Z' })],
    };
    render(<RunsBody />);
    fireEvent.change(screen.getByLabelText('Sort runs'), { target: { value: 'cost:desc' } });

    expect(state.calls.at(-1)?.params).toMatchObject({ sort: 'cost', dir: 'desc' });
    const first = document.querySelector('[data-v2-runs-table] tbody tr') as HTMLElement;
    expect(within(first).getByText('Web Engineer #1')).toBeInTheDocument();
  });

  it('initialises the workspace, sort and direction from the URL', () => {
    state.search = { ws: 'ws2', sort: 'cost', dir: 'asc' };
    state.runsByWs = {
      ws1: [makeRun({ id: 'r1', agentId: 'a1', costCents: 1 })],
      ws2: [makeRun({ id: 'r2', agentId: 'a2', costCents: 2 })],
    };
    render(<RunsBody />);

    expect(state.calls.at(-1)?.ids).toEqual(['ws2']);
    expect((screen.getByLabelText('Workspace') as HTMLSelectElement).value).toBe('ws2');
    expect((screen.getByLabelText('Sort runs') as HTMLSelectElement).value).toBe('cost:asc');
  });

  it('writes the sort and the workspace filter back to the URL', () => {
    state.runsByWs = { ws1: [], ws2: [] };
    render(<RunsBody />);

    fireEvent.change(screen.getByLabelText('Sort runs'), { target: { value: 'tokens:asc' } });
    expect(state.go).toHaveBeenCalledWith('/runs', { search: { sort: 'tokens', dir: 'asc' }, replace: true });

    fireEvent.change(screen.getByLabelText('Workspace'), { target: { value: 'ws2' } });
    expect(state.go).toHaveBeenCalledWith('/runs', { search: { ws: 'ws2' }, replace: true });
  });

  it('keeps the default recency order in the query until a measure is chosen', () => {
    state.runsByWs = { ws1: [makeRun({ id: 'r1', agentId: 'a1' })], ws2: [] };
    render(<RunsBody />);

    expect(state.calls.at(-1)?.params.sort).toBeUndefined();
    expect(state.calls.at(-1)?.params.dir).toBeUndefined();
  });
});
