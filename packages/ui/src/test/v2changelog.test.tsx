/**
 * VS-352: the V2 Changelog screen (`/w/:ws/changelog`) — the year heatmap over the newest-first,
 * day/week/month timeline, restyled to V2, with V2 ticket links.
 */
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChangelogDay, ChangelogEntry, ChangelogHeatmap, ChangelogKind } from '../api/types';

const state = vi.hoisted(() => ({
  entries: [] as ChangelogEntry[],
  heatmap: undefined as ChangelogHeatmap | undefined,
  hasOlder: false,
  isLoadingOlder: false,
  isLoading: false,
  isError: false,
  loadOlder: vi.fn(),
  loadUntil: vi.fn(async () => undefined),
}));

vi.mock('@tanstack/react-router', () => ({
  useRouterState: () => '/w/ws1/changelog',
  useParams: () => ({ ws: 'ws1' }),
}));
vi.mock('../api/context', () => ({ useWs: () => 'ws1', useHookWs: (o?: string) => o ?? 'ws1' }));
vi.mock('../app/link', () => ({
  useGo: () => vi.fn(),
  A: ({ children, params, className, ...rest }: Record<string, unknown> & { children?: React.ReactNode }) => (
    <a href={`/w/ws1/tickets/${String((params as Record<string, string>)?.['ticketId'] ?? '')}`} className={className as string} {...(rest as Record<string, unknown>)}>
      {children}
    </a>
  ),
}));
vi.mock('../api/hooks', () => ({
  useWorkspaces: () => ({ data: [{ id: 'ws1', name: 'Acme', needsYou: 0 }] }),
  useWorkers: () => ({ data: [] }),
  useWorkersMany: (ids: readonly string[]) => ids.map(() => ({ data: [] })),
  useDecisionsMany: (ids: readonly string[]) => ids.map(() => ({ data: [] })),
  useIncidents: () => ({ data: { items: [] } }),
  useChangelog: () => ({
    data: state.entries,
    isLoading: state.isLoading,
    isError: state.isError,
    hasOlder: state.hasOlder,
    isLoadingOlder: state.isLoadingOlder,
    loadOlder: state.loadOlder,
    loadUntil: state.loadUntil,
  }),
  useChangelogHeatmap: () => ({ data: state.heatmap, isLoading: false }),
  readerTimezone: () => 'UTC',
}));

const { V2ChangelogScreen } = await import('../v2/changelog/ChangelogPage');

let n = 0;
function entry(at: string, over: Partial<ChangelogEntry> = {}): ChangelogEntry {
  n += 1;
  return {
    id: `e${n}`,
    at,
    kind: 'landed',
    actor: { kind: 'human', id: 'victor', label: 'the workspace owner' },
    projectId: 'p1',
    ticketId: 't1',
    ticketIdentifier: `ACME-${n}`,
    summary: `Landed: thing ${n}`,
    link: { kind: 'ticket', target: 't1' },
    ...over,
  };
}

function day(date: string, landed: number): ChangelogDay {
  const byKind = Object.fromEntries(
    (['filed', 'plan_approved', 'pr_opened', 'landed', 'cancelled', 'hired', 'upgraded'] as ChangelogKind[]).map((k) => [k, 0]),
  ) as Record<ChangelogKind, number>;
  byKind.landed = landed;
  return { date, landed, total: landed, byKind };
}

function heatmapOf(days: ChangelogDay[]): ChangelogHeatmap {
  return { days, timezone: 'UTC', measure: { kind: 'landed', label: 'Tickets landed', definition: 'Tickets whose work reached the repository that day.' } };
}

beforeEach(() => {
  n = 0;
  state.entries = [];
  state.heatmap = undefined;
  state.hasOlder = false;
  state.isLoadingOlder = false;
  state.isLoading = false;
  state.isError = false;
  state.loadOlder = vi.fn();
  state.loadUntil = vi.fn(async () => undefined);
});

describe('the V2 changelog screen', () => {
  it('separates each day, and marks the week and the month a day begins', () => {
    state.entries = [
      entry('2026-09-02T10:00:00.000Z'),
      entry('2026-09-01T10:00:00.000Z'),
      entry('2026-08-31T10:00:00.000Z'),
      entry('2026-08-28T10:00:00.000Z'),
    ];
    const { container } = render(<V2ChangelogScreen />);
    expect(screen.getByRole('heading', { name: 'Changelog' })).toBeInTheDocument();
    const days = [...container.querySelectorAll('[data-day]')].map((el) => el.getAttribute('data-day'));
    expect(days).toEqual(['2026-09-02', '2026-09-01', '2026-08-31', '2026-08-28']);
    expect(within(container.querySelector('[data-day="2026-09-01"]')!).getByRole('heading', { level: 2 }).textContent).toMatch(/September 2026/);
    expect(within(container.querySelector('[data-day="2026-08-31"]')!).getByRole('heading', { level: 3 }).textContent).toMatch(/Week of/);
  });

  it('links an entry to its ticket', () => {
    state.entries = [entry('2026-09-02T10:00:00.000Z', { ticketId: 'tk_7', link: { kind: 'ticket', target: 'tk_7' }, summary: 'Landed: dark mode' })];
    render(<V2ChangelogScreen />);
    const link = screen.getByRole('link', { name: 'Landed: dark mode' });
    expect(link.getAttribute('href')).toBe('/w/ws1/tickets/tk_7');
  });

  it('opens a pull request entry on the forge', () => {
    state.entries = [entry('2026-09-02T10:00:00.000Z', {
      kind: 'pr_opened',
      summary: 'Pull request opened for dark mode',
      link: { kind: 'url', target: 'https://example.invalid/pr/9' },
    })];
    render(<V2ChangelogScreen />);
    const link = screen.getByRole('link', { name: /Pull request opened/ });
    expect(link.getAttribute('href')).toBe('https://example.invalid/pr/9');
    expect(link.getAttribute('target')).toBe('_blank');
  });

  it('shows each entry with its kind, time and actor, and says so when there is nothing', () => {
    state.entries = [entry('2026-09-02T10:00:00.000Z', { kind: 'hired', summary: 'Hired Backend Engineer for api', link: null, ticketIdentifier: null })];
    const { rerender } = render(<V2ChangelogScreen />);
    expect(screen.getByText('hired')).toBeInTheDocument();
    expect(screen.getByText('the workspace owner')).toBeInTheDocument();

    state.entries = [];
    rerender(<V2ChangelogScreen />);
    expect(screen.getByText(/Nothing has happened yet/)).toBeInTheDocument();
  });

  it('offers to load older entries and says when the record ends', () => {
    state.entries = [entry('2026-09-02T10:00:00.000Z')];
    state.hasOlder = true;
    const { rerender } = render(<V2ChangelogScreen />);
    fireEvent.click(screen.getByRole('button', { name: 'Load older' }));
    expect(state.loadOlder).toHaveBeenCalled();

    state.hasOlder = false;
    rerender(<V2ChangelogScreen />);
    expect(screen.queryByRole('button', { name: 'Load older' })).toBeNull();
    expect(screen.getByText(/That is the whole record/)).toBeInTheDocument();
  });

  it('moves the timeline to a heatmap day, loading older entries first when it is not yet loaded', async () => {
    Element.prototype.scrollIntoView = vi.fn();
    state.entries = [entry('2026-09-02T10:00:00.000Z')];
    state.heatmap = heatmapOf([day('2026-08-01', 2), day('2026-09-02', 1)]);
    const { container } = render(<V2ChangelogScreen />);
    await act(async () => { fireEvent.click(container.querySelector('rect[data-date="2026-08-01"]')!); });
    expect(state.loadUntil).toHaveBeenCalledWith('2026-08-01');
  });
});
