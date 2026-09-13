/** VS-350: the V2 Live floor — grid, scope chips, one-source counts and the per-row control. */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Agent, Project, Run, Ticket } from '@weave-ai/shared';
import { agent, project, run as makeRun, ticket as makeTicket } from './factories';

const state = vi.hoisted(() => ({
  phone: false,
  search: {} as Record<string, string | undefined>,
  workspaces: [] as { id: string; name: string }[],
  workers: {} as Record<string, Agent[]>,
  tickets: {} as Record<string, Ticket[]>,
  runs: [] as Run[],
  options: [] as { id: string; description: string; runtime: string | null; model: string | null }[],
  projects: [] as Project[],
}));

vi.mock('@tanstack/react-router', () => ({
  useRouterState: (o?: { select?: (s: { location: { pathname: string } }) => unknown }) => (o?.select ? o.select({ location: { pathname: '/v2/live' } }) : '/v2/live'),
  useParams: () => ({}),
}));
vi.mock('../app/link', () => ({ useSearchParams: () => state.search, useGo: () => vi.fn() }));
vi.mock('../api/hooks', () => ({
  useWorkspaces: () => ({ data: state.workspaces, isError: false, refetch: vi.fn() }),
  useWorkersMany: (ids: string[]) => ids.map((id) => ({ data: state.workers[id] ?? [] })),
  useTicketsMany: (ids: string[]) => ids.map((id) => ({ data: state.tickets[id] ?? [] })),
  useModelsMany: (ids: string[]) => ids.map(() => ({ data: { workerOptions: state.options } })),
  useWorkspaceProjects: (ids: string[]) => Object.fromEntries(ids.map((id) => [id, { status: 'success', projects: state.projects }])),
  useRuntimeModels: () => ({ data: [] }),
  useRuns: (params: { status?: string } = {}) => ({ data: state.runs.filter((r) => !params.status || r.status === params.status) }),
}));
vi.mock('../api/runStream', () => ({
  useRunEventStream: () => ({ events: [], status: { state: 'connected' }, retryNow: vi.fn() }),
}));

const { LiveBody } = await import('../v2/LivePage');

function setMedia(phone: boolean): void {
  state.phone = phone;
  window.matchMedia = ((query: string) => ({
    matches: phone && query.includes('max-width'),
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

const grid = (): HTMLElement => document.querySelector('[data-v2-live-grid]') as HTMLElement;

beforeEach(() => {
  state.search = {};
  state.projects = [project({ id: 'p1', slug: 'web', name: 'web' })];
  state.options = [
    { id: 'standard', description: 'Standard', runtime: 'claude-code', model: 'sonnet-4.6' },
    { id: 'fast', description: 'Fast', runtime: 'claude-code', model: 'haiku-4' },
  ];
  state.workspaces = [
    { id: 'ws1', name: 'Acme' },
    { id: 'ws2', name: 'Fernwood' },
  ];
  state.workers = {
    ws1: [
      agent({ id: 'a1', name: 'Backend Engineer #7', ticketId: 'tk1', projectId: 'p1', status: 'running', createdAt: '2026-09-01T10:00:00.000Z' }),
      agent({ id: 'a2', name: 'Platform Engineer #2', ticketId: 'tk2', projectId: null, status: 'active', createdAt: '2026-09-01T09:00:00.000Z' }),
    ],
    ws2: [agent({ id: 'a3', name: 'Web Engineer #1', ticketId: 'tk3', projectId: null, status: 'running', createdAt: '2026-09-01T11:00:00.000Z' })],
  };
  state.tickets = {
    ws1: [makeTicket({ id: 'tk1', identifier: 'ACME-1', title: 'Dark mode', workerModelId: 'standard' }), makeTicket({ id: 'tk2', identifier: 'ACME-2', title: 'Other' })],
    ws2: [makeTicket({ id: 'tk3', identifier: 'FAN-1', title: 'Fernwood work' })],
  };
  state.runs = [
    makeRun({ id: 'run_a1', agentId: 'a1', status: 'running', model: 'sonnet-4.6', runtimeId: 'claude-code', createdAt: '2026-09-01T10:00:00.000Z' }),
    makeRun({ id: 'run_a3', agentId: 'a3', status: 'running', model: 'sonnet-4.6', runtimeId: 'claude-code', createdAt: '2026-09-01T11:00:00.000Z' }),
  ];
  localStorage.clear();
  setMedia(false);
});

describe('V2 Live', () => {
  it('shows live workers from every workspace and excludes the rest', () => {
    render(<LiveBody />);
    expect(document.querySelector('[data-v2-live-card="a1"]')).toBeTruthy();
    expect(document.querySelector('[data-v2-live-card="a2"]')).toBeTruthy();
    expect(document.querySelector('[data-v2-live-card="a3"]')).toBeTruthy();
    expect(screen.getByText('3 running · showing 3')).toBeInTheDocument();
  });

  it('filters by scope and keeps the shown count tied to the grid', () => {
    render(<LiveBody />);
    fireEvent.click(screen.getByRole('button', { name: 'Acme' }));
    expect(document.querySelector('[data-v2-live-card="a1"]')).toBeTruthy();
    expect(document.querySelector('[data-v2-live-card="a3"]')).toBeNull();
    expect(screen.getByText('3 running · showing 2')).toBeInTheDocument();
  });

  it('changes the columns and the feed height with the per-row control, and remembers it', () => {
    render(<LiveBody />);
    expect(grid().getAttribute('data-cols')).toBe('2');
    expect(grid().querySelector('div[style*="300px"]')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'More per row' }));
    expect(grid().getAttribute('data-cols')).toBe('3');
    expect(grid().querySelector('div[style*="240px"]')).toBeTruthy();
    expect(localStorage.getItem('weave.v2.live.columns')).toBe('3');

    fireEvent.click(screen.getByRole('button', { name: 'Fewer per row' }));
    fireEvent.click(screen.getByRole('button', { name: 'Fewer per row' }));
    expect(grid().getAttribute('data-cols')).toBe('1');
    expect(grid().querySelector('div[style*="420px"]')).toBeTruthy();
  });

  it('is one column on phone with no per-row control', () => {
    setMedia(true);
    render(<LiveBody />);
    expect(grid().getAttribute('data-cols')).toBe('1');
    expect(screen.queryByRole('button', { name: 'More per row' })).toBeNull();
  });

  it('shows the resolved model in the header and the option name on the ticket line', () => {
    render(<LiveBody />);
    const card = document.querySelector('[data-v2-live-card="a1"]') as HTMLElement;
    expect(card.textContent).toContain('sonnet-4.6');
    expect(card.textContent).toContain('standard');
    expect(card.querySelector('svg[role="img"]')).toBeNull();
  });

  it('opens focused when the address names a worker from another workspace', async () => {
    state.search = { worker: 'a3' };
    render(<LiveBody />);
    await waitFor(() => expect(document.querySelector('[data-v2-live-card="a3"]')?.getAttribute('data-focused')).toBe('true'));
    expect(document.querySelector('[data-v2-live-card="a1"]')).toBeNull();
    expect(screen.getByText('3 running · showing 1')).toBeInTheDocument();
  });

  it('lets the scope chips change after arriving focused', async () => {
    state.search = { worker: 'a3' };
    render(<LiveBody />);
    await waitFor(() => expect(document.querySelector('[data-v2-live-card="a3"]')?.getAttribute('data-focused')).toBe('true'));
    fireEvent.click(screen.getByRole('button', { name: 'Everywhere' }));
    expect(screen.getByText('3 running · showing 3')).toBeInTheDocument();
    expect(document.querySelector('[data-v2-live-card="a1"]')).toBeTruthy();
  });
});
