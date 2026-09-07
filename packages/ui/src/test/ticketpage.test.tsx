import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Agent, Decision, TicketComment } from '@agent-conductor/shared';
import { agent, decision, ticket } from './factories';

const state = vi.hoisted(() => ({
  comments: [] as TicketComment[],
  worker: null as Agent | null,
  decisions: [] as Decision[],
  workerDetail: undefined as { input: { midTurn: boolean; reason?: string } } | undefined,
  search: {} as Record<string, string | undefined>,
  ticketStatus: 'in_progress' as string,
  messageMutateAsync: vi.fn(async () => ({ delivery: 'queued', runId: null, wakeId: null })),
  answerMutate: vi.fn(),
}));

const empty = { data: undefined, isLoading: false, isError: false };
const list = <T,>(data: T[]) => ({ data, isLoading: false, isError: false });

vi.mock('@tanstack/react-router', () => ({ useParams: () => ({ ticketId: 'tk_1' }) }));
vi.mock('../api/context', () => ({ useWs: () => 'ws1' }));
vi.mock('../app/link', () => ({ useGo: () => vi.fn(), useSearchParams: () => state.search }));

vi.mock('../api/hooks', () => ({
  useTicket: () => ({
    data: {
      ticket: ticket({ description: 'A description\nwrapped onto two lines.', status: state.ticketStatus as never }),
      project: null, worker: state.worker, role: null, blockers: [], children: [], documents: [],
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
  useDecisions: () => list(state.decisions),
  useAnswerDecision: () => ({ mutate: state.answerMutate, isPending: false }),
  useWorker: () => (state.workerDetail ? { data: state.workerDetail, isLoading: false, isError: false } : empty),
  useWorkerMessage: () => ({ mutateAsync: state.messageMutateAsync, isPending: false }),
}));

const { TicketRoute } = await import('../routes/TicketPage');

function comment(over: Partial<TicketComment> & Pick<TicketComment, 'id' | 'body'>): TicketComment {
  return {
    ticketId: 'tk_1', authorKind: 'human', authorId: 'victor', runId: null, kind: 'comment',
    sourceTrust: 'trusted', createdAt: '2026-09-01T09:00:00.000Z', ...over,
  };
}

beforeEach(() => {
  state.comments = [];
  state.worker = null;
  state.decisions = [];
  state.workerDetail = undefined;
  state.search = {};
  state.ticketStatus = 'in_progress';
});
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

describe('TicketRoute deep-links to a tab (VS-106)', () => {
  it('opens on the tab named in ?tab=', () => {
    state.search = { tab: 'activity' };
    state.comments = [comment({ id: 'c1', body: 'hello' })];
    const { container } = render(<TicketRoute />);
    expect(container.querySelector('article .ac-prose p')).not.toBeNull();
  });

  it('falls back to overview for an unknown tab', () => {
    state.search = { tab: 'nope' };
    render(<TicketRoute />);
    expect(screen.getByRole('tab', { name: 'Overview', selected: true })).toBeTruthy();
  });
});

describe("TicketRoute's Activity tab talks to the worker (VS-106)", () => {
  it('sends through the live-input path and shows the delivery outcome', async () => {
    state.worker = agent({ status: 'active' });
    state.workerDetail = { input: { midTurn: true } };
    const { container } = render(<TicketRoute />);
    openActivity();

    const textarea = container.querySelector('textarea')!;
    fireEvent.change(textarea, { target: { value: 'why did you do it that way?' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    });

    expect(state.messageMutateAsync).toHaveBeenCalledWith({ id: 'a1', ticketId: 'tk_1', body: 'why did you do it that way?', live: true });
  });

  it('is read-only once the worker has retired, naming it', () => {
    state.worker = agent({ status: 'retired', retiredAt: '2026-09-02T00:00:00.000Z' });
    const { container } = render(<TicketRoute />);
    openActivity();

    expect(container.textContent).toContain('Frontend Engineer #7 has retired');
    expect(container.querySelector('textarea')).not.toBeNull(); // the ticket isn't terminal — a plain reply can still bring a worker back
  });

  it('offers no composer at all once a retired worker’s ticket has also landed', () => {
    state.worker = agent({ status: 'retired', retiredAt: '2026-09-02T00:00:00.000Z' });
    state.ticketStatus = 'done';
    const { container } = render(<TicketRoute />);
    openActivity();

    expect(container.textContent).toContain('Frontend Engineer #7 has retired');
    expect(container.querySelector('textarea')).toBeNull();
  });

  it('leaves a paused worker on the relaunch-flavored plain composer', () => {
    state.worker = agent({ status: 'paused' });
    render(<TicketRoute />);
    openActivity();
    expect(screen.getByPlaceholderText(/relaunches the parked worker/)).toBeTruthy();
  });
});

describe("TicketRoute's Activity tab answers the merge approval (VS-106)", () => {
  it('offers Approve merge and Ask for revisions when one is open', () => {
    state.decisions = [decision({ kind: 'merge_approval', ticketId: 'tk_1' })];
    render(<TicketRoute />);
    openActivity();

    expect(screen.getByRole('button', { name: 'Approve merge' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Ask for revisions…' })).toBeTruthy();
  });

  it('approve answers the decision with key "approve"', () => {
    state.decisions = [decision({ kind: 'merge_approval', ticketId: 'tk_1', id: 'dec_1' })];
    render(<TicketRoute />);
    openActivity();
    fireEvent.click(screen.getByRole('button', { name: 'Approve merge' }));
    expect(state.answerMutate).toHaveBeenCalledWith({ id: 'dec_1', key: 'approve' });
  });

  it('revising sends the human’s words on the revise key', () => {
    state.decisions = [decision({ kind: 'merge_approval', ticketId: 'tk_1', id: 'dec_1' })];
    const { container } = render(<TicketRoute />);
    openActivity();
    fireEvent.click(screen.getByRole('button', { name: 'Ask for revisions…' }));
    const textarea = [...container.querySelectorAll('textarea')].find((t) => t.getAttribute('placeholder') === 'What should change?')!;
    fireEvent.change(textarea, { target: { value: 'please add a test' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(state.answerMutate).toHaveBeenCalledWith({ id: 'dec_1', key: 'changes', text: 'please add a test' });
  });

  it('renders no merge-approval banner when none is open', () => {
    render(<TicketRoute />);
    openActivity();
    expect(screen.queryByRole('button', { name: 'Approve merge' })).toBeNull();
  });

  it('answering the merge approval touches only that decision, leaving another open one alone', () => {
    state.decisions = [
      decision({ kind: 'question', ticketId: 'tk_1', id: 'dec_other', title: 'Which approach?' }),
      decision({ kind: 'merge_approval', ticketId: 'tk_1', id: 'dec_1' }),
    ];
    render(<TicketRoute />);
    openActivity();
    fireEvent.click(screen.getByRole('button', { name: 'Approve merge' }));

    expect(state.answerMutate).toHaveBeenCalledTimes(1);
    expect(state.answerMutate).toHaveBeenCalledWith({ id: 'dec_1', key: 'approve' });
    expect(state.answerMutate).not.toHaveBeenCalledWith(expect.objectContaining({ id: 'dec_other' }));
  });
});
