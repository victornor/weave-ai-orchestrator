/** VS-350: the V2 Runs table — cross-workspace merge, state filter and load-more. */
import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Run } from '@weave-ai/shared';
import { run as makeRun } from './factories';

const state = vi.hoisted(() => ({
  search: {} as Record<string, string | undefined>,
  runsByWs: {} as Record<string, Run[]>,
  go: vi.fn() as unknown as ReturnType<typeof vi.fn>,
}));

vi.mock('@tanstack/react-router', () => ({
  useRouterState: (o?: { select?: (s: { location: { pathname: string } }) => unknown }) => (o?.select ? o.select({ location: { pathname: '/v2/runs' } }) : '/v2/runs'),
  useParams: () => ({}),
}));
vi.mock('../app/link', () => ({ useSearchParams: () => state.search, useGo: () => state.go }));
vi.mock('../api/hooks', () => ({
  useWorkspaces: () => ({ data: [{ id: 'ws1', name: 'Acme' }, { id: 'ws2', name: 'Fernwood' }], isError: false, refetch: vi.fn() }),
  useWorkersMany: (ids: string[]) =>
    ids.map((id) => ({ data: id === 'ws1' ? [{ id: 'a1', name: 'Backend Engineer #7' }] : [{ id: 'a2', name: 'Web Engineer #1' }] })),
  useWeaverMany: (ids: string[]) =>
    ids.map((id) => ({ data: { agent: { id: id === 'ws1' ? 'wv1' : 'wv2', name: id === 'ws1' ? 'Acme Weaver' : 'Fernwood Weaver' } } })),
  useRunPagesMany: (ids: string[], params: { status?: string; limit?: number } = {}) =>
    ids.map((id) => {
      const all = (state.runsByWs[id] ?? []).filter((r) => !params.status || r.status === params.status);
      const limit = params.limit ?? 50;
      return { data: { runs: all.slice(0, limit), total: all.length }, isError: false, refetch: vi.fn() };
    }),
  useWorkers: () => ({ data: [] }),
  useIncidents: () => ({ data: { items: [], total: 0 } }),
}));

const { RunsBody, mergeRuns } = await import('../v2/RunsPage');

const tableRows = (): number => document.querySelectorAll('[data-v2-runs-table] tbody tr').length;

beforeEach(() => {
  state.search = {};
  state.go = vi.fn();
  state.runsByWs = {};
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
    expect(state.go).toHaveBeenCalledWith('/v2/runs/$runId', expect.objectContaining({ params: { runId: 'r1' } }));
  });
});
