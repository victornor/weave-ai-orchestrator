import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TicketComment } from '@agent-conductor/shared';
import { ticket } from './factories';

const state = vi.hoisted(() => ({ comments: [] as TicketComment[] }));

const empty = { data: undefined, isLoading: false, isError: false };
const list = <T,>(data: T[]) => ({ data, isLoading: false, isError: false });

vi.mock('@tanstack/react-router', () => ({ useParams: () => ({ ticketId: 'tk_1' }) }));
vi.mock('../api/context', () => ({ useWs: () => 'ws1' }));
vi.mock('../app/link', () => ({ useGo: () => vi.fn() }));

vi.mock('../api/hooks', () => ({
  useTicket: () => ({
    data: {
      ticket: ticket({ description: 'A description\nwrapped onto two lines.' }),
      project: null, worker: null, role: null, blockers: [], children: [], documents: [],
      workProducts: [], openspecState: null, mergeQueue: { position: null, concurrency: 1 },
    },
    isLoading: false,
    isError: false,
  }),
  usePatchTicket: () => ({ mutate: vi.fn(), isPending: false }),
  useRetryTicket: () => ({ mutate: vi.fn(), isPending: false }),
  usePostComment: () => ({ mutate: vi.fn(), isPending: false }),
  useTicketComments: () => list(state.comments),
  useTicketDocument: () => empty,
  useTicketDocumentRevisions: () => list([]),
  useTicketWorkProducts: () => list([]),
  useTicketRuns: () => list([]),
  useTicketUsage: () => empty,
  useDecisions: () => list([]),
  useAnswerDecision: () => ({ mutate: vi.fn(), isPending: false }),
}));

const { TicketRoute } = await import('../routes/TicketPage');

function comment(over: Partial<TicketComment> & Pick<TicketComment, 'id' | 'body'>): TicketComment {
  return {
    ticketId: 'tk_1', authorKind: 'human', authorId: 'victor', runId: null, kind: 'comment',
    sourceTrust: 'trusted', createdAt: '2026-09-01T09:00:00.000Z', ...over,
  };
}

beforeEach(() => { state.comments = []; });
afterEach(() => { cleanup(); vi.clearAllMocks(); });

const openActivity = (): void => { fireEvent.click(screen.getByRole('tab', { name: 'Activity' })); };

describe('TicketRoute comments', () => {
  it('keeps the line breaks of a comment the human wrote', () => {
    state.comments = [comment({ id: 'c1', body: 'first line\nsecond line\n\n- one\n- two' })];
    const { container } = render(<TicketRoute />);
    openActivity();

    const para = container.querySelector('article .ac-prose p')!;
    expect(para.innerHTML).toBe('first line<br>second line');
    expect([...container.querySelectorAll('article .ac-prose li')].map((li) => li.textContent)).toEqual(['one', 'two']);
  });

  it('still reflows a hard-wrapped description', () => {
    const { container } = render(<TicketRoute />);
    expect(container.querySelector('.ac-prose p')!.innerHTML).toBe('A description wrapped onto two lines.');
  });
});
