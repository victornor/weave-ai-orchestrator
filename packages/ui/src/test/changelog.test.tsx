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

vi.mock('../api/context', () => ({ useWs: () => 'ws1', useHookWs: (o?: string) => o ?? 'ws1' }));
vi.mock('../app/link', () => ({
  useGo: () => vi.fn(),
  // A real anchor, so a link's target is assertable without a router.
  A: ({ children, params, className, ...rest }: Record<string, unknown> & { children?: React.ReactNode }) => (
    <a href={`/w/ws1/tickets/${String((params as Record<string, string>)?.['ticketId'] ?? '')}`} className={className as string} {...(rest as Record<string, unknown>)}>
      {children}
    </a>
  ),
}));
vi.mock('../api/hooks', () => ({
  useChangelog: () => ({
    data: state.entries, isLoading: state.isLoading, isError: state.isError,
    hasOlder: state.hasOlder, isLoadingOlder: state.isLoadingOlder,
    loadOlder: state.loadOlder, loadUntil: state.loadUntil,
  }),
  useChangelogHeatmap: () => ({ data: state.heatmap, isLoading: false }),
  readerTimezone: () => 'UTC',
}));

const { ChangelogPanel } = await import('../routes/Changelog');

let n = 0;
function entry(at: string, over: Partial<ChangelogEntry> = {}): ChangelogEntry {
  n += 1;
  return {
    id: `e${n}`, at, kind: 'landed',
    actor: { kind: 'human', id: 'victor', label: 'the workspace owner' },
    projectId: 'p1', ticketId: 't1', ticketIdentifier: `ACME-${n}`,
    summary: `Landed: thing ${n}`, link: { kind: 'ticket', target: 't1' },
    ...over,
  };
}

function day(date: string, landed: number): ChangelogDay {
  const byKind = Object.fromEntries((['filed', 'plan_approved', 'pr_opened', 'landed', 'cancelled', 'hired', 'upgraded'] as ChangelogKind[]).map((k) => [k, 0])) as Record<ChangelogKind, number>;
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

describe('the changelog timeline', () => {
  it('separates each day, and marks the week and the month a day begins', () => {
    // Newest first across a month boundary (1 Sep 2026 is a Tuesday) and a week boundary.
    state.entries = [
      entry('2026-09-02T10:00:00.000Z'),
      entry('2026-09-01T10:00:00.000Z'),
      entry('2026-08-31T10:00:00.000Z'),
      entry('2026-08-28T10:00:00.000Z'),
    ];
    const { container } = render(<ChangelogPanel />);

    const days = [...container.querySelectorAll('[data-day]')].map((el) => el.getAttribute('data-day'));
    expect(days).toEqual(['2026-09-02', '2026-09-01', '2026-08-31', '2026-08-28']);

    // The month separator sits on the oldest day of that month in the list, which is where the
    // reader crosses into it as they scroll down.
    expect(within(container.querySelector('[data-day="2026-09-01"]')!).getByRole('heading', { level: 2 }).textContent).toMatch(/September 2026/);
    expect(container.querySelector('[data-day="2026-09-02"]')!.querySelector('h2')).toBeNull();
    // The Monday that begins that week gets the week separator, and no month separator.
    expect(within(container.querySelector('[data-day="2026-08-31"]')!).getByRole('heading', { level: 3 }).textContent).toMatch(/Week of/);
    expect(container.querySelector('[data-day="2026-08-31"]')!.querySelector('h2')).toBeNull();
    // Every day carries its own separator naming the date. The wording is the reader's locale, so
    // this asserts the parts rather than one locale's ordering.
    const dayHeading = within(container.querySelector('[data-day="2026-09-02"]')!).getByRole('heading', { level: 4 }).textContent ?? '';
    expect(dayHeading).toMatch(/September/);
    expect(dayHeading).toMatch(/\b2\b/);
    expect(dayHeading).toMatch(/2026/);
  });

  it('links an entry to its ticket', () => {
    state.entries = [entry('2026-09-02T10:00:00.000Z', { ticketId: 'tk_7', link: { kind: 'ticket', target: 'tk_7' }, summary: 'Landed: dark mode' })];
    render(<ChangelogPanel />);
    const link = screen.getByRole('link', { name: 'Landed: dark mode' });
    expect(link.getAttribute('href')).toBe('/w/ws1/tickets/tk_7');
  });

  it('links a pull request entry to the pull request, outside the app', () => {
    state.entries = [entry('2026-09-02T10:00:00.000Z', {
      kind: 'pr_opened', summary: 'Pull request opened for dark mode',
      link: { kind: 'url', target: 'https://example.invalid/pr/9' },
    })];
    render(<ChangelogPanel />);
    const link = screen.getByRole('link', { name: /Pull request opened/ });
    expect(link.getAttribute('href')).toBe('https://example.invalid/pr/9');
    expect(link.getAttribute('target')).toBe('_blank');
  });

  it('shows each entry with its kind, time and actor', () => {
    state.entries = [entry('2026-09-02T10:00:00.000Z', { kind: 'hired', summary: 'Hired Backend Engineer for api', link: null, ticketIdentifier: null })];
    render(<ChangelogPanel />);
    expect(screen.getByText('hired')).toBeTruthy();
    expect(screen.getByText('Hired Backend Engineer for api')).toBeTruthy();
    expect(screen.getByText('the workspace owner')).toBeTruthy();
  });

  it('says so when there is nothing rather than showing an empty list', () => {
    render(<ChangelogPanel />);
    expect(screen.getByText(/Nothing has happened yet/)).toBeTruthy();
  });

  it('offers to load older entries, and says when the record ends', () => {
    state.entries = [entry('2026-09-02T10:00:00.000Z')];
    state.hasOlder = true;
    const { rerender } = render(<ChangelogPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Load older' }));
    expect(state.loadOlder).toHaveBeenCalled();

    state.hasOlder = false;
    rerender(<ChangelogPanel />);
    expect(screen.queryByRole('button', { name: 'Load older' })).toBeNull();
    expect(screen.getByText(/That is the whole record/)).toBeTruthy();
  });

  it('says it is loading while an older page is in flight', () => {
    state.entries = [entry('2026-09-02T10:00:00.000Z')];
    state.hasOlder = true;
    state.isLoadingOlder = true;
    render(<ChangelogPanel />);
    expect(screen.getByText(/Loading older entries/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Load older' })).toBeNull();
  });
});

describe('the activity heatmap', () => {
  /** A year of days ending on a Saturday, so the grid has a partial first and last column. */
  const year = (): ChangelogDay[] => {
    const days: ChangelogDay[] = [];
    const start = new Date('2025-09-06T00:00:00Z');
    for (let i = 0; i < 371; i += 1) {
      const d = new Date(start.getTime() + i * 86_400_000);
      days.push(day(d.toISOString().slice(0, 10), 0));
    }
    return days;
  };

  it('draws a cell per day over at least a year', () => {
    state.heatmap = heatmapOf(year());
    const { container } = render(<ChangelogPanel />);
    expect(container.querySelectorAll('rect[data-date]')).toHaveLength(371);
  });

  it('states the measure and its definition in the view', () => {
    state.heatmap = heatmapOf(year());
    render(<ChangelogPanel />);
    expect(screen.getByText('Tickets landed')).toBeTruthy();
    expect(screen.getByText(/Tickets whose work reached the repository that day/)).toBeTruthy();
  });

  it('draws a quiet day in the empty shade rather than omitting it', () => {
    state.heatmap = heatmapOf([day('2026-09-01', 0), day('2026-09-02', 4)]);
    const { container } = render(<ChangelogPanel />);
    const quiet = container.querySelector('rect[data-date="2026-09-01"]')!;
    const busy = container.querySelector('rect[data-date="2026-09-02"]')!;
    expect(quiet).toBeTruthy();
    expect(quiet.getAttribute('fill')).toBe('var(--bg-input)');
    expect(busy.getAttribute('fill')).not.toBe(quiet.getAttribute('fill'));
  });

  it('shows a day detail on hover and on tap', () => {
    state.heatmap = heatmapOf([day('2026-09-02', 3)]);
    const { container } = render(<ChangelogPanel />);
    const cell = container.querySelector('rect[data-date="2026-09-02"]')!;

    expect(screen.queryByTestId('heatmap-detail')).toBeNull();
    fireEvent.mouseEnter(cell);
    expect(screen.getByTestId('heatmap-detail').textContent).toMatch(/2026-09-02.*3 landed/);

    // A touch device never fires mouseEnter; the tap has to be enough on its own.
    fireEvent.mouseLeave(cell);
    expect(screen.queryByTestId('heatmap-detail')).toBeNull();
    fireEvent.click(cell);
    expect(screen.getByTestId('heatmap-detail').textContent).toMatch(/2026-09-02/);
  });

  it('scrolls the timeline to a day that is already loaded', () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    state.entries = [entry('2026-09-02T10:00:00.000Z')];
    state.heatmap = heatmapOf([day('2026-09-02', 1)]);
    const { container } = render(<ChangelogPanel />);

    fireEvent.click(container.querySelector('rect[data-date="2026-09-02"]')!);
    expect(scrollIntoView).toHaveBeenCalled();
    expect(state.loadUntil).not.toHaveBeenCalled();
  });

  it('loads the intervening pages before scrolling to a day older than everything loaded', async () => {
    Element.prototype.scrollIntoView = vi.fn();
    state.entries = [entry('2026-09-02T10:00:00.000Z')];
    state.heatmap = heatmapOf([day('2026-08-01', 2), day('2026-09-02', 1)]);
    const { container } = render(<ChangelogPanel />);

    // The jump is async (it pages first, then scrolls), so the click has to settle inside act.
    await act(async () => { fireEvent.click(container.querySelector('rect[data-date="2026-08-01"]')!); });
    expect(state.loadUntil).toHaveBeenCalledWith('2026-08-01');
  });
});
