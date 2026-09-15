/** VS-350: the V2 Live floor — grid, scope chips, one-source counts and the per-row control. */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Agent, Project, Run, Ticket } from '@weave-ai/shared';
import { agent, project, run as makeRun, ticket as makeTicket } from './factories';
import { LIVE_RUN_GRACE_MS } from '../lib/liveOrder';
import { LIVE_HEIGHT_MIN } from '../v2/prefs';

const state = vi.hoisted(() => ({
  phone: false,
  search: {} as Record<string, string | undefined>,
  go: vi.fn(),
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
vi.mock('../app/link', () => ({ useSearchParams: () => state.search, useGo: () => state.go }));
vi.mock('../api/hooks', () => ({
  useWorkspaces: () => ({ data: state.workspaces, isError: false, refetch: vi.fn() }),
  useWorkersMany: (ids: string[]) => ids.map((id) => ({ data: state.workers[id] ?? [] })),
  useTicketsMany: (ids: string[]) => ids.map((id) => ({ data: state.tickets[id] ?? [] })),
  useModelsMany: (ids: string[]) => ids.map(() => ({ data: { workerOptions: state.options } })),
  useWorkspaceProjects: (ids: string[]) => Object.fromEntries(ids.map((id) => [id, { status: 'success', projects: state.projects }])),
  useRuntimeModels: () => ({ data: [] }),
  useRuns: (params: { status?: string } = {}) => ({ data: state.runs.filter((r) => !params.status || r.status === params.status) }),
  useDecisionsMany: (ids: string[]) => ids.map(() => ({ data: [] })),
  useIncidents: () => ({ data: { items: [], total: 0 } }),
}));
vi.mock('../api/runStream', () => ({
  useRunEventStream: () => ({ events: [], status: { state: 'connected' }, retryNow: vi.fn() }),
}));

const { LiveBody, V2LivePage } = await import('../v2/LivePage');

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
  state.go = vi.fn();
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
    expect(screen.getByText('2 running · showing 3')).toBeInTheDocument();
  });

  it('filters by scope and keeps the shown count tied to the grid', () => {
    render(<LiveBody />);
    fireEvent.click(screen.getByRole('button', { name: 'Acme' }));
    expect(document.querySelector('[data-v2-live-card="a1"]')).toBeTruthy();
    expect(document.querySelector('[data-v2-live-card="a3"]')).toBeNull();
    expect(screen.getByText('1 running · showing 2')).toBeInTheDocument();
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
    expect(screen.getByText('1 running · showing 1')).toBeInTheDocument();
  });

  it('lets the scope chips change after arriving focused', async () => {
    state.search = { worker: 'a3' };
    render(<LiveBody />);
    await waitFor(() => expect(document.querySelector('[data-v2-live-card="a3"]')?.getAttribute('data-focused')).toBe('true'));
    fireEvent.click(screen.getByRole('button', { name: 'Everywhere' }));
    expect(screen.getByText('2 running · showing 3')).toBeInTheDocument();
    expect(document.querySelector('[data-v2-live-card="a1"]')).toBeTruthy();
  });

  it('opens pre-filtered when the address names a workspace (VS-455)', () => {
    state.search = { ws: 'ws2' };
    render(<LiveBody />);
    expect(screen.getByRole('button', { name: 'Fernwood' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Everywhere' })).toHaveAttribute('aria-pressed', 'false');
    expect(document.querySelector('[data-v2-live-card="a3"]')).toBeTruthy();
    expect(document.querySelector('[data-v2-live-card="a1"]')).toBeNull();
    expect(screen.getByText('1 running · showing 1')).toBeInTheDocument();
  });

  it('writes a chosen scope back to the URL, and drops it for Everywhere (VS-455)', () => {
    render(<LiveBody />);
    fireEvent.click(screen.getByRole('button', { name: 'Acme' }));
    expect(state.go).toHaveBeenLastCalledWith('/v2/live', { search: { ws: 'ws1' }, replace: true });
    fireEvent.click(screen.getByRole('button', { name: 'Everywhere' }));
    expect(state.go).toHaveBeenLastCalledWith('/v2/live', { search: { ws: undefined }, replace: true });
  });

  it('reads a ws that names no workspace as Everywhere, so the floor is never empty (VS-455)', () => {
    state.search = { ws: 'nope' };
    render(<LiveBody />);
    expect(screen.getByRole('button', { name: 'Everywhere' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('2 running · showing 3')).toBeInTheDocument();
  });
});

describe('V2 Live working-first order (VS-415)', () => {
  const cardIds = (): string[] =>
    [...document.querySelectorAll<HTMLElement>('[data-v2-live-card]')].map((el) => el.getAttribute('data-v2-live-card') ?? '');
  const statusOf = (id: string): string =>
    document.querySelector(`[data-v2-live-card="${id}"]`)?.getAttribute('data-v2-live-status') ?? '';
  /** Every card that reads working comes before every card that does not. */
  const workingIsAPrefix = (): boolean => {
    let seenIdle = false;
    return cardIds().every((id) => {
      if (statusOf(id) === 'working') return !seenIdle;
      seenIdle = true;
      return true;
    });
  };

  it('puts every working card above every idle card across two workspaces', () => {
    state.workers = {
      ws1: [
        agent({ id: 'r1', ticketId: 'tk1', status: 'running', createdAt: '2026-09-01T09:00:00.000Z' }),
        agent({ id: 'i1', ticketId: 'tk2', status: 'active', createdAt: '2026-09-01T10:00:00.000Z' }),
      ],
      ws2: [
        agent({ id: 'r2', ticketId: 'tk3', status: 'running', createdAt: '2026-09-01T11:00:00.000Z' }),
        agent({ id: 'i2', ticketId: 'tk4', status: 'active', createdAt: '2026-09-01T08:00:00.000Z' }),
      ],
    };
    state.tickets = {
      ws1: [makeTicket({ id: 'tk1' }), makeTicket({ id: 'tk2' })],
      ws2: [makeTicket({ id: 'tk3' }), makeTicket({ id: 'tk4' })],
    };
    render(<LiveBody />);
    expect(workingIsAPrefix()).toBe(true);
    expect(cardIds().slice(0, 2).sort()).toEqual(['r1', 'r2']);
    expect(statusOf('i1')).toBe('idle');
  });

  it('keeps a handing-over card in the working group, then drops it when the grace elapses', () => {
    vi.useFakeTimers();
    try {
      const running = (): void => {
        state.workers = {
          ws1: [
            agent({ id: 'r1', ticketId: 'tk1', status: 'running', createdAt: '2026-09-01T09:00:00.000Z' }),
            agent({ id: 'h1', ticketId: 'tk2', status: 'running', createdAt: '2026-09-01T10:00:00.000Z' }),
          ],
          ws2: [agent({ id: 'r2', ticketId: 'tk3', status: 'running', createdAt: '2026-09-01T11:00:00.000Z' })],
        };
      };
      running();
      state.tickets = {
        ws1: [makeTicket({ id: 'tk1' }), makeTicket({ id: 'tk2' })],
        ws2: [makeTicket({ id: 'tk3' })],
      };
      const { rerender } = render(<LiveBody />);
      expect(statusOf('h1')).toBe('working');

      // h1's turn ends; its createdAt sits between the two running cards, so a card that read idle
      // but stayed in the running group would land between them.
      state.workers = {
        ws1: [
          agent({ id: 'r1', ticketId: 'tk1', status: 'running', createdAt: '2026-09-01T09:00:00.000Z' }),
          agent({ id: 'h1', ticketId: 'tk2', status: 'active', createdAt: '2026-09-01T10:00:00.000Z' }),
        ],
        ws2: [agent({ id: 'r2', ticketId: 'tk3', status: 'running', createdAt: '2026-09-01T11:00:00.000Z' })],
      };
      rerender(<LiveBody />);
      // The card still reads working, so the group has not split.
      expect(statusOf('h1')).toBe('working');
      expect(workingIsAPrefix()).toBe(true);

      act(() => vi.advanceTimersByTime(LIVE_RUN_GRACE_MS));
      expect(statusOf('h1')).toBe('idle');
      expect(workingIsAPrefix()).toBe(true);
      expect(cardIds()[cardIds().length - 1]).toBe('h1');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('V2 Live tile height (VS-372, VS-429)', () => {
  const grips = (): HTMLElement[] => screen.getAllByRole('separator', { name: 'Resize all live tiles' });
  const gripFor = (id: string): HTMLElement =>
    within(document.querySelector(`[data-v2-live-card="${id}"]`) as HTMLElement).getByRole('separator', { name: 'Resize all live tiles' });
  const bodyHeights = (): number[] =>
    [...document.querySelectorAll<HTMLElement>('[data-worker-feed] > div')].map((el) => parseInt(el.style.height, 10));
  const drag = (el: HTMLElement, by: number): void => {
    fireEvent.pointerDown(el, { pointerId: 1, clientY: 100 });
    fireEvent.pointerMove(window, { pointerId: 1, clientY: 100 + by });
    fireEvent.pointerUp(window, { pointerId: 1 });
  };

  it('puts a corner grip inside every tile, not a bar above the grid', () => {
    render(<LiveBody />);
    expect(grips()).toHaveLength(3);
    for (const g of grips()) expect(g.closest('[data-v2-live-card]')).toBeTruthy();
    // The toolbar is now the scroll container's previous sibling: the 8px separator is gone.
    const scroll = document.querySelector('[data-v2-live-scroll]') as HTMLElement;
    expect(scroll.previousElementSibling?.querySelector('[data-v2-live-cols]')).toBeTruthy();
  });

  it('drags one tile grip to resize every tile together and remembers it', () => {
    render(<LiveBody />);
    expect(bodyHeights()).toEqual([300, 300, 300]);
    drag(gripFor('a1'), 80);
    expect(bodyHeights()).toEqual([380, 380, 380]);
    expect(localStorage.getItem('weave.v2.live.height')).toBe('380');
  });

  it('clamps the drag to the minimum and to most of the viewport', () => {
    render(<LiveBody />);
    drag(gripFor('a1'), -5000);
    expect(bodyHeights()).toEqual([LIVE_HEIGHT_MIN, LIVE_HEIGHT_MIN, LIVE_HEIGHT_MIN]);
    drag(gripFor('a2'), 9000);
    const cap = Math.round(window.innerHeight * 0.85);
    expect(bodyHeights()).toEqual([cap, cap, cap]);
  });

  it('remembers the tile height across a remount', () => {
    const first = render(<LiveBody />);
    drag(gripFor('a1'), 80);
    first.unmount();
    render(<LiveBody />);
    expect(bodyHeights()).toEqual([380, 380, 380]);
  });

  it('keeps the chosen height when the per-row count changes', () => {
    render(<LiveBody />);
    drag(gripFor('a1'), 80);
    fireEvent.click(screen.getByRole('button', { name: 'More per row' }));
    expect(grid().getAttribute('data-cols')).toBe('3');
    expect(bodyHeights()).toEqual([380, 380, 380]);
  });

  it('double-click on any tile grip returns to the per-row default', () => {
    render(<LiveBody />);
    drag(gripFor('a1'), 80);
    fireEvent.doubleClick(gripFor('a2'));
    expect(bodyHeights()).toEqual([300, 300, 300]);
    expect(localStorage.getItem('weave.v2.live.height')).toBeNull();
  });

  it('steps the shared height with the arrow keys', () => {
    render(<LiveBody />);
    fireEvent.keyDown(gripFor('a1'), { key: 'ArrowDown' });
    expect(bodyHeights()).toEqual([324, 324, 324]);
    fireEvent.keyDown(gripFor('a2'), { key: 'ArrowUp' });
    fireEvent.keyDown(gripFor('a3'), { key: 'ArrowUp' });
    expect(bodyHeights()).toEqual([276, 276, 276]);
    expect(localStorage.getItem('weave.v2.live.height')).toBe('276');
  });

  it('has no tile grip on the phone', () => {
    setMedia(true);
    render(<LiveBody />);
    expect(screen.queryByRole('separator', { name: 'Resize all live tiles' })).toBeNull();
  });
});

describe('the Live page frame', () => {
  it('is fill-height with one scroll container, and every card sits inside it', () => {
    render(<V2LivePage />);
    const body = document.querySelector('[data-v2-page-body]') as HTMLElement;
    // The page body does not scroll; the grid does. Two nested scroll containers clipped cards.
    expect(body.getAttribute('data-v2-page-body')).toBe('fill');
    expect(body.className).not.toContain('overflow-y-auto');

    const scroll = document.querySelector('[data-v2-live-scroll]') as HTMLElement;
    expect(scroll.className).toContain('flex-1');
    expect(scroll.className).toContain('min-h-0');
    expect(scroll.className).toContain('overflow-y-auto');
    expect(scroll.contains(document.querySelector('[data-v2-live-grid]'))).toBe(true);

    const cards = document.querySelectorAll('[data-v2-live-card]');
    expect(cards.length).toBeGreaterThan(0);
    for (const card of cards) expect(scroll.contains(card)).toBe(true);
  });
});
