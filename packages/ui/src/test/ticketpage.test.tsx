import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Agent, Decision, Ticket, TicketComment } from '@weave-ai/shared';
import type { WorkerMessageOutcome, WorkProduct } from '../api/types';
import { agent, decision, ticket, workProduct } from './factories';

const state = vi.hoisted(() => ({
  comments: [] as TicketComment[],
  ticketOverrides: {} as Partial<Ticket>,
  worker: null as Agent | null,
  workProducts: [] as WorkProduct[],
  documentRevisions: [] as Array<{ revision: number; createdAt: string; authorKind: string; reason: string | null }>,
  documents: undefined as Array<{ key: string; revision: number; updatedAt: string }> | undefined,
  startSession: vi.fn(),
  decisions: [] as Decision[],
  workerDetail: undefined as { input: { midTurn: boolean; interrupts?: boolean; reason?: string } } | undefined,
  search: {} as Record<string, string | undefined>,
  ticketStatus: 'in_progress' as string,
  messageMutateAsync: vi.fn(async (): Promise<WorkerMessageOutcome> => ({ delivery: 'queued', runId: null, wakeId: null })),
  answerMutate: vi.fn(),
  knowledgeUsage: undefined as { hubTokens: number; documentTokens: number; totalTokens: number; documents: Array<{ scope: string; projectId: string | null; slug: string | null; tokens: number }> } | undefined,
}));

const empty = { data: undefined, isLoading: false, isError: false };
const list = <T,>(data: T[]) => ({ data, isLoading: false, isError: false });

vi.mock('@tanstack/react-router', () => ({ useParams: () => ({ ticketId: 'tk_1' }) }));
vi.mock('../api/context', () => ({ useWs: () => 'ws1', useHookWs: (o?: string) => o ?? 'ws1' }));
vi.mock('../app/link', () => ({ useGo: () => vi.fn(), useSearchParams: () => state.search }));

vi.mock('../api/hooks', () => ({
  useTicket: () => ({
    data: {
      ticket: ticket({ description: 'A description\nwrapped onto two lines.', status: state.ticketStatus as never, ...state.ticketOverrides }),
      project: null, worker: state.worker, role: null, blockers: [], children: [],
      documents: state.documents ?? state.workProducts.filter((p) => p.type === 'artifact' && p.externalId).map((p) => ({ key: `artifact:${p.externalId}`, revision: 1, updatedAt: p.updatedAt })),
      workProducts: state.workProducts, openspecState: null, mergeQueue: { position: null, concurrency: 1 },
    },
    isLoading: false,
    isError: false,
  }),
  usePatchTicket: () => ({ mutate: vi.fn(), isPending: false }),
  useRetryTicket: () => ({ mutate: vi.fn(), isPending: false }),
  useStartSession: () => ({ mutate: state.startSession, isPending: false }),
  usePostComment: () => ({ mutate: vi.fn(), isPending: false }),
  useTicketComments: () => list(state.comments),
  useTicketDocument: () => empty,
  useTicketDocumentRevisions: () => list(state.documentRevisions),
  useTicketWorkProducts: () => list(state.workProducts),
  useTicketRuns: () => list([]),
  useTicketUsage: () => empty,
  useTicketKnowledgeUsage: () => ({ data: state.knowledgeUsage, isLoading: false, isError: false }),
  useDecisions: () => list(state.decisions),
  useAnswerDecision: () => ({ mutate: state.answerMutate, isPending: false }),
  useWorker: () => (state.workerDetail ? { data: state.workerDetail, isLoading: false, isError: false } : empty),
  useWorkerMessage: () => ({ mutateAsync: state.messageMutateAsync, isPending: false }),
  // VS-249: not exercised here — the decision card's handover band only fetches once opened.
  useHandoverCommandFor: () => empty,
  useStartHandoverFor: () => ({ mutate: vi.fn() }),
}));
vi.mock('../components/Toast', () => ({ useToast: () => ({ push: vi.fn(() => 'id'), dismiss: vi.fn() }) }));
vi.mock('../api/client', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../api/client');
  return {
    ...actual,
    api: {
      ws: (_workspace: string, path: string) => {
        if (path.endsWith('/kit.css')) return Promise.resolve(':root { --accent: #fff; }');
        return Promise.resolve('<!doctype html><html><head></head><body>artifact</body></html>');
      },
    },
  };
});

const { TicketRoute } = await import('../routes/TicketPage');

function comment(over: Partial<TicketComment> & Pick<TicketComment, 'id' | 'body'>): TicketComment {
  return {
    ticketId: 'tk_1', authorKind: 'human', authorId: 'victor', runId: null, kind: 'comment',
    sourceTrust: 'trusted', createdAt: '2026-09-01T09:00:00.000Z', ...over,
  };
}

beforeEach(() => {
  state.comments = [];
  state.ticketOverrides = {};
  state.worker = null;
  state.startSession = vi.fn();
  state.decisions = [];
  state.workerDetail = undefined;
  state.search = {};
  state.ticketStatus = 'in_progress';
  state.knowledgeUsage = undefined;
  state.workProducts = [];
  state.documentRevisions = [];
  state.documents = undefined;
  state.messageMutateAsync = vi.fn(async (): Promise<WorkerMessageOutcome> => ({ delivery: 'queued', runId: null, wakeId: null }));
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
    expect(container.querySelector('.ac-chat-prose')).toBeNull();
  });

  it('still reflows a hard-wrapped description', () => {
    const { container } = render(<TicketRoute />);
    expect(container.querySelector('.ac-prose p')!.innerHTML).toBe('A description wrapped onto two lines.');
  });
});

describe('TicketRoute — interactive sessions (VS-101)', () => {
  it('offers to start a session on a ticket with no worker yet, and starts it on click', () => {
    render(<TicketRoute />);
    const startButton = screen.getByRole('button', { name: 'Start interactive session' });
    fireEvent.click(startButton);
    expect(state.startSession).toHaveBeenCalledWith({ ticketId: 'tk_1' }, expect.anything());
  });

  it('does not offer to start a session once the ticket already has a worker', () => {
    state.worker = agent();
    render(<TicketRoute />);
    expect(screen.queryByRole('button', { name: 'Start interactive session' })).not.toBeInTheDocument();
  });

  it('does not offer to start a session that is already one, and marks it interactive instead', () => {
    state.ticketOverrides = { interactiveSession: true };
    render(<TicketRoute />);
    expect(screen.queryByRole('button', { name: 'Start interactive session' })).not.toBeInTheDocument();
    expect(screen.getByText('interactive')).toBeInTheDocument();
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

  it('labels the reply box as interrupting the running turn on a non-streaming runtime (VS-254)', () => {
    state.worker = agent({ status: 'active' });
    state.workerDetail = { input: { midTurn: false, interrupts: true } };
    render(<TicketRoute />);
    openActivity();

    expect(screen.getByText('Interrupts the running turn; the agent answers once its next turn starts.')).toBeInTheDocument();
  });

  it('shows the interrupted outcome after a live reply interrupts the running turn (VS-254)', async () => {
    state.worker = agent({ status: 'active' });
    state.workerDetail = { input: { midTurn: false, interrupts: true } };
    state.messageMutateAsync = vi.fn(async (): Promise<WorkerMessageOutcome> => ({ delivery: 'interrupted', runId: 'run_1', wakeId: 'wk_1' }));
    const { container } = render(<TicketRoute />);
    openActivity();

    const textarea = container.querySelector('textarea')!;
    fireEvent.change(textarea, { target: { value: 'stop, wrong direction' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    });

    expect(screen.getByText('Interrupted the running turn; it will be answered once the next turn starts.')).toBeInTheDocument();
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

  it('shows the weaver-review line on an unseen plan card (VS-223)', () => {
    state.decisions = [decision({ kind: 'plan_approval', ticketId: 'tk_1', title: 'Approve the plan for ACME-42' })];
    render(<TicketRoute />);
    fireEvent.click(screen.getByRole('tab', { name: 'Plan' }));
    expect(screen.getByText("Weaver hasn't reviewed yet")).toBeInTheDocument();
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

describe('TicketRoute knowledge tab (VS-110)', () => {
  it('shows the hub/document/total token split and the documents read, labelled as knowledge context', () => {
    state.knowledgeUsage = {
      hubTokens: 40, documentTokens: 10, totalTokens: 50,
      documents: [{ scope: 'project', projectId: 'proj1', slug: 'payments-webhooks', tokens: 10 }],
    };
    render(<TicketRoute />);
    fireEvent.click(screen.getByRole('tab', { name: 'Knowledge' }));

    expect(screen.getByText(/Knowledge context/)).toBeInTheDocument();
    expect(screen.getByText('payments-webhooks')).toBeInTheDocument();
  });

  it('says so when no documents were read', () => {
    state.knowledgeUsage = { hubTokens: 40, documentTokens: 0, totalTokens: 40, documents: [] };
    render(<TicketRoute />);
    fireEvent.click(screen.getByRole('tab', { name: 'Knowledge' }));

    expect(screen.getByText('No documents read')).toBeInTheDocument();
  });
});

// VS-201: the header's "paused · …" chip is a short preview; the ticket's Overview tab (the default
// tab) shows the full worker-failure decision too, the same reachable card as chat/Needs You, rather
// than leaving the compact chip as the only place on the page to look.
describe('TicketRoute shows the open worker-failure decision (VS-201)', () => {
  it('shows the full decision on the Overview tab when one is open', () => {
    const models = Array.from({ length: 60 }, (_, i) => `gpt-5.${i}-sol-high`).join(', ');
    const longContext = `Last error: Cannot use this model: grok-4-6. Available models: auto, ${models}`;
    state.decisions = [decision({ kind: 'retry_approval', ticketId: 'tk_1', id: 'dec_1', context: longContext })];
    render(<TicketRoute />);

    expect(screen.getByRole('button', { name: 'Show full text' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Show full text' }));
    expect(screen.getByText(/gpt-5\.59-sol-high/)).toBeInTheDocument();
  });

  it('renders no worker-failure decision when none is open', () => {
    render(<TicketRoute />);
    expect(screen.queryByRole('button', { name: 'Show full text' })).not.toBeInTheDocument();
  });
});

describe('TicketRoute header chip carries the full message in its tooltip (VS-201)', () => {
  it('the visible chip stays the capped preview; the tooltip carries the complete message', () => {
    const models = Array.from({ length: 60 }, (_, i) => `gpt-5.${i}-sol-high`).join(', ');
    const longMessage = `Cannot use this model: grok-4-6. Available models: auto, ${models}`;
    state.worker = agent({
      status: 'paused',
      pauseDetail: { family: 'unknown', code: 'bad_model', message: longMessage, resetAt: null, runId: 'r1' },
    });
    render(<TicketRoute />);
    const chip = screen.getByText(/^paused ·/);
    expect(chip.textContent).not.toContain('gpt-5.59-sol-high');
    expect(chip.getAttribute('title')).toContain('gpt-5.59-sol-high');
  });
});

describe('TicketRoute header names an incomplete delivery (VS-250)', () => {
  it('shows delivery incomplete for a done ticket whose merged PR has no merge-done record', () => {
    state.ticketStatus = 'done';
    state.ticketOverrides = { delivery: { prUrl: 'https://example.com/pull/190', prState: 'merged' } };
    render(<TicketRoute />);
    expect(screen.getByText('delivery incomplete')).toBeInTheDocument();
  });

  it("shows merged for merge-done's complete record", () => {
    state.ticketStatus = 'done';
    state.ticketOverrides = { delivery: { merged: true, mergeCommit: 'a'.repeat(40) } };
    render(<TicketRoute />);
    expect(screen.getByText('merged')).toBeInTheDocument();
    expect(screen.queryByText('delivery incomplete')).not.toBeInTheDocument();
  });
});

describe('TicketRoute Artifacts tab (VS-269)', () => {
  it('shows no Artifacts tab when the ticket has no artifacts', () => {
    state.workProducts = [];
    render(<TicketRoute />);
    expect(screen.queryByRole('tab', { name: 'Artifacts' })).not.toBeInTheDocument();
  });

  it('shows the Artifacts tab once the ticket has one, and lists it with title, kind and a sandboxed frame', () => {
    state.workProducts = [workProduct()];
    render(<TicketRoute />);
    fireEvent.click(screen.getByRole('tab', { name: 'Artifacts' }));
    expect(screen.getByRole('button', { name: /Overview/ })).toBeInTheDocument();
    expect(screen.getByText(/diagram/)).toBeInTheDocument();
    const frame = document.querySelector('iframe');
    expect(frame).toBeTruthy();
    expect(frame?.getAttribute('src')).toBe('/api/w/ws1/tickets/tk_1/artifacts/overview/raw');
    expect(frame?.getAttribute('sandbox')).toBe('allow-scripts allow-forms allow-popups allow-downloads');
  });

  it('shows a link-only artifact as a plain URL link with no frame and no Download (VS-331)', () => {
    state.workProducts = [workProduct({ externalId: 'shots', title: 'Phone screenshots', url: 'file:///tmp/artifacts/' })];
    state.documents = [];
    render(<TicketRoute />);
    fireEvent.click(screen.getByRole('tab', { name: 'Artifacts' }));

    expect(screen.getByText('Phone screenshots')).toBeInTheDocument();
    const link = screen.getByText('file:///tmp/artifacts/');
    expect(link.tagName).toBe('A');
    expect(link.getAttribute('href')).toBe('file:///tmp/artifacts/');
    expect(document.querySelector('iframe')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Download' })).not.toBeInTheDocument();
  });

  it('lists two artifacts independently and switches the frame when a different one is picked', () => {
    state.workProducts = [
      workProduct({ id: 'wp_1', externalId: 'overview', title: 'Overview' }),
      workProduct({ id: 'wp_2', externalId: 'sequence', title: 'Sequence diagram', url: '/api/w/ws1/tickets/tk_1/artifacts/sequence/raw' }),
    ];
    render(<TicketRoute />);
    fireEvent.click(screen.getByRole('tab', { name: 'Artifacts' }));
    expect(document.querySelector('iframe')?.getAttribute('src')).toBe('/api/w/ws1/tickets/tk_1/artifacts/overview/raw');
    fireEvent.click(screen.getByText('Sequence diagram'));
    expect(document.querySelector('iframe')?.getAttribute('src')).toBe('/api/w/ws1/tickets/tk_1/artifacts/sequence/raw');
  });

  it('offers a revision picker only when more than one revision exists, and selecting one updates the frame src', () => {
    state.workProducts = [workProduct()];
    state.documentRevisions = [
      { revision: 1, createdAt: '2026-09-01T09:00:00.000Z', authorKind: 'agent', reason: null },
      { revision: 2, createdAt: '2026-09-01T10:00:00.000Z', authorKind: 'agent', reason: null },
    ];
    render(<TicketRoute />);
    fireEvent.click(screen.getByRole('tab', { name: 'Artifacts' }));
    expect(screen.getByText('Revisions')).toBeInTheDocument();
    fireEvent.click(screen.getByText('r1'));
    expect(document.querySelector('iframe')?.getAttribute('src')).toBe('/api/w/ws1/tickets/tk_1/artifacts/overview/raw?revision=1');
  });

  it('does not offer a revision picker with only one revision', () => {
    state.workProducts = [workProduct()];
    state.documentRevisions = [{ revision: 1, createdAt: '2026-09-01T09:00:00.000Z', authorKind: 'agent', reason: null }];
    render(<TicketRoute />);
    fireEvent.click(screen.getByRole('tab', { name: 'Artifacts' }));
    expect(screen.queryByText('Revisions')).not.toBeInTheDocument();
  });

  it('the open-in-new-tab link points straight at the artifact URL', () => {
    state.workProducts = [workProduct()];
    render(<TicketRoute />);
    fireEvent.click(screen.getByRole('tab', { name: 'Artifacts' }));
    const link = screen.getByText('Open in new tab ↗');
    expect(link.getAttribute('href')).toBe('/api/w/ws1/tickets/tk_1/artifacts/overview/raw');
  });

  it('downloads without throwing even when the fetched HTML does not embed the kit', async () => {
    // jsdom has no object-URL implementation; stub it the way a real browser provides it.
    const createObjectURL = vi.fn(() => 'blob:mock');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL });
    state.workProducts = [workProduct()];
    render(<TicketRoute />);
    fireEvent.click(screen.getByRole('tab', { name: 'Artifacts' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Download' }));
    });
    expect(screen.queryByText('Downloading…')).not.toBeInTheDocument();
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock');
    vi.unstubAllGlobals();
  });
});
