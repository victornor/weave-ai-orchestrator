/**
 * VS-637: the inline feed panel behind a ticket chip's expand control. It mounts the modal's own
 * activity feed only while expanded, follows in contained mode (never scrolling the chat), carries
 * the ten-line cap, and collapses itself when its ticket reaches a terminal state while open.
 */
import { fireEvent, render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Ticket, TicketComment, UiStatus } from '@weave-ai/shared';
import { V2TicketStrip, CHIP_PANEL_EXIT_MS } from '../v2/ChatChips';
import { ticket } from './factories';
import type { Dispatch } from '../lib/dispatch';

const state = vi.hoisted(() => ({
  comments: {} as Record<string, TicketComment[]>,
  runs: {} as Record<string, unknown[]>,
}));

vi.mock('../api/hooks', () => ({
  useTicketComments: (id: string) => ({ data: state.comments[id] ?? [], isLoading: false }),
  useTicketRuns: (id: string) => ({ data: state.runs[id] ?? [], isLoading: false }),
}));
vi.mock('../api/runStream', () => ({
  useRunEventStream: () => ({
    events: [],
    partials: [],
    lastPartialAt: null,
    partialSince: null,
    status: { state: 'connected', capturedAt: null, attempts: 0 },
    retryNow: vi.fn(),
  }),
}));

function comment(id: string, ticketId: string, body: string): TicketComment {
  return {
    id,
    ticketId,
    authorKind: 'agent',
    authorId: null,
    runId: null,
    body,
    kind: 'comment',
    sourceTrust: 'trusted',
    createdAt: '2026-09-21T00:00:00.000Z',
  };
}

function reference(status: UiStatus, ticketStatus: Ticket['status'] = 'in_progress'): Dispatch {
  return {
    ticket: ticket({ id: 'tk_VS-1', identifier: 'VS-1', title: 'VS-1 title', status: ticketStatus, projectId: null }),
    worker: null,
    status,
  };
}

function expandAll(container: HTMLElement): void {
  for (const chevron of container.querySelectorAll('[data-v2-chip-expand]')) fireEvent.click(chevron);
}

beforeEach(() => {
  state.comments = {};
  state.runs = {};
  state.comments['tk_VS-1'] = [comment('c1', 'tk_VS-1', 'A first line of the feed.')];
  state.comments['tk_VS-2'] = [comment('c2', 'tk_VS-2', 'Another ticket line.')];
  vi.restoreAllMocks();
});

describe('V2TicketChipPanel (VS-637)', () => {
  it('mounts the modal feed only while expanded', async () => {
    const { container } = render(<V2TicketStrip references={[reference('working')]} projectIds={[]} open={vi.fn()} />);
    expect(container.querySelector('[data-ticket-activity-feed]')).toBeNull();
    expect(container.querySelector('[data-ticket-chip-feed]')).toBeNull();

    fireEvent.click(container.querySelector('[data-v2-chip-expand]')!);
    const panel = container.querySelector('[data-v2-chip-panel]')!;
    expect(panel).not.toBeNull();
    const feed = panel.querySelector('[data-ticket-activity-feed]')!;
    expect(feed).not.toBeNull();
    expect(feed.textContent).toContain('A first line of the feed.');

    fireEvent.click(container.querySelector('[data-v2-chip-expand]')!);
    await waitFor(() => expect(container.querySelector('[data-ticket-activity-feed]')).toBeNull());
  });

  it('expands two chips at once, each with its own feed', () => {
    state.comments['tk_VS-2'] = [comment('c2', 'tk_VS-2', 'The second ticket feed.')];
    const refs: Dispatch[] = [
      reference('working'),
      { ticket: ticket({ id: 'tk_VS-2', identifier: 'VS-2', title: 'VS-2 title', projectId: null }), worker: null, status: 'idle' },
    ];
    const { container } = render(<V2TicketStrip references={refs} projectIds={[]} open={vi.fn()} />);
    expandAll(container);
    expect(container.querySelectorAll('[data-v2-chip-panel]')).toHaveLength(2);
    expect(container.querySelectorAll('[data-ticket-activity-feed]')).toHaveLength(2);
    expect(container.textContent).toContain('A first line of the feed.');
    expect(container.textContent).toContain('The second ticket feed.');
  });

  it('renders the panel under the chip row in a capped, self-scrolling box', () => {
    const { container } = render(<V2TicketStrip references={[reference('working')]} projectIds={[]} open={vi.fn()} />);
    expandAll(container);
    const strip = container.querySelector('[data-v2-ticket-strip]')!;
    const row = strip.firstElementChild!;
    expect(row.contains(container.querySelector('[data-v2-dispatch-chip]')!)).toBe(true);
    expect(row.contains(container.querySelector('[data-ticket-chip-feed]'))).toBe(false);
    const scroll = container.querySelector('[data-ticket-chip-scroll]')!;
    expect(scroll.className).toContain('max-h-[10lh]');
    expect(scroll.className).toContain('overflow-y-auto');
  });

  it('follows in contained mode, never scrolling the chat with scrollIntoView', () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    const refs = [reference('working')];
    const { container, rerender } = render(<V2TicketStrip references={refs} projectIds={[]} open={vi.fn()} />);
    expandAll(container);
    // A new line arrives while the panel is open: the follow must move the panel alone.
    state.comments['tk_VS-1'] = [...state.comments['tk_VS-1']!, comment('c3', 'tk_VS-1', 'A newer line.')];
    rerender(<V2TicketStrip references={[reference('working')]} projectIds={[]} open={vi.fn()} />);
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it('collapses itself when its ticket reaches done while open', async () => {
    const { container, rerender } = render(<V2TicketStrip references={[reference('working', 'in_progress')]} projectIds={[]} open={vi.fn()} />);
    expandAll(container);
    expect(container.querySelector('[data-ticket-activity-feed]')).not.toBeNull();

    rerender(<V2TicketStrip references={[reference('done', 'done')]} projectIds={[]} open={vi.fn()} />);
    await waitFor(() => expect(container.querySelector('[data-ticket-activity-feed]')).toBeNull(), { timeout: CHIP_PANEL_EXIT_MS + 500 });
    expect(container.querySelector('[data-v2-chip-expand]')!.getAttribute('aria-expanded')).toBe('false');
    expect(container.querySelector('[data-v2-dispatch-chip]')!.textContent).toContain('done');
  });

  it('collapses itself when its ticket is cancelled while open', async () => {
    const { container, rerender } = render(<V2TicketStrip references={[reference('working', 'in_progress')]} projectIds={[]} open={vi.fn()} />);
    expandAll(container);
    rerender(<V2TicketStrip references={[reference('failed', 'cancelled')]} projectIds={[]} open={vi.fn()} />);
    await waitFor(() => expect(container.querySelector('[data-ticket-activity-feed]')).toBeNull(), { timeout: CHIP_PANEL_EXIT_MS + 500 });
  });

  it('leaves a panel open when the ticket moves to in review', () => {
    const { container, rerender } = render(<V2TicketStrip references={[reference('working', 'in_progress')]} projectIds={[]} open={vi.fn()} />);
    expandAll(container);
    rerender(<V2TicketStrip references={[reference('needs-you', 'in_review')]} projectIds={[]} open={vi.fn()} />);
    expect(container.querySelector('[data-ticket-activity-feed]')).not.toBeNull();
  });

  it('stays open when the ticket was already done at expansion', () => {
    const { container, rerender } = render(<V2TicketStrip references={[reference('done', 'done')]} projectIds={[]} open={vi.fn()} />);
    expandAll(container);
    expect(container.querySelector('[data-ticket-activity-feed]')).not.toBeNull();
    rerender(<V2TicketStrip references={[reference('done', 'done')]} projectIds={[]} open={vi.fn()} />);
    expect(container.querySelector('[data-ticket-activity-feed]')).not.toBeNull();
  });

  it('skips the exit transition under reduced motion', () => {
    const real = window.matchMedia;
    window.matchMedia = ((q: string) => ({
      matches: q.includes('prefers-reduced-motion'),
      media: q,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
    try {
      const { container } = render(<V2TicketStrip references={[reference('working')]} projectIds={[]} open={vi.fn()} />);
      expandAll(container);
      expect(container.querySelector('[data-ticket-activity-feed]')).not.toBeNull();
      fireEvent.click(container.querySelector('[data-v2-chip-expand]')!);
      expect(container.querySelector('[data-ticket-activity-feed]')).toBeNull();
    } finally {
      window.matchMedia = real;
    }
  });
});