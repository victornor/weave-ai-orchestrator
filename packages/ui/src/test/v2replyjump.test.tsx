/**
 * VS-447: jumping from a human message to the weaver's response, and back.
 *
 * Two layers, because the hard part is a rule and the visible part is a render. `replyTargets` is
 * pure and tested directly (the explicit link, the fallback, and what is ignored); the page tests
 * drive the link, the jump's scroll/highlight/focus, the quote jump-back, reduced motion and the
 * link appearing when a reply arrives live.
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type { Agent, Decision, RunTrace, ThreadMessage, Ticket } from '@weave-ai/shared';
import { replyTargets } from '../lib/replyTargets';
import { agent } from './factories';

function message(over: Partial<ThreadMessage> = {}): ThreadMessage {
  return {
    id: 'm1',
    threadId: 't1',
    direction: 'outbound',
    authorKind: 'agent',
    authorId: 'weaver1',
    runId: null,
    projectId: null,
    replyToMessageId: null,
    replyToMessageIds: [],
    replyToExcerpt: null,
    body: 'Hello',
    parts: [],
    externalMessageId: null,
    deliveryStatus: 'sent',
    createdAt: '2026-09-13T09:00:00.000Z',
    ...over,
  };
}

const inbound = (over: Partial<ThreadMessage> = {}): ThreadMessage =>
  message({ direction: 'inbound', authorKind: 'human', authorId: null, ...over });

const outbound = (over: Partial<ThreadMessage> = {}): ThreadMessage =>
  message({ direction: 'outbound', ...over });

describe('replyTargets', () => {
  it('links an outbound message to the inbound message it replies to', () => {
    const human = inbound({ id: 'h1', createdAt: '2026-09-13T09:00:00.000Z' });
    const reply = outbound({ id: 'r1', replyToMessageId: 'h1', createdAt: '2026-09-13T09:00:01.000Z' });
    const { responses, repliesTo } = replyTargets([human, reply]);
    expect(responses.get('h1')).toEqual(['r1']);
    expect(repliesTo.get('r1')).toBe('h1');
  });

  it('falls back to the first outbound after a human message, before the human’s next', () => {
    const h1 = inbound({ id: 'h1', createdAt: '2026-09-13T09:00:00.000Z' });
    const r1 = outbound({ id: 'r1', createdAt: '2026-09-13T09:00:01.000Z' });
    const h2 = inbound({ id: 'h2', createdAt: '2026-09-13T09:00:02.000Z' });
    const r2 = outbound({ id: 'r2', createdAt: '2026-09-13T09:00:03.000Z' });
    const { responses } = replyTargets([h1, r1, h2, r2]);
    expect(responses.get('h1')).toEqual(['r1']);
    expect(responses.get('h2')).toEqual(['r2']);
  });

  it('prefers an explicit link over the fallback', () => {
    const h1 = inbound({ id: 'h1', createdAt: '2026-09-13T09:00:00.000Z' });
    const first = outbound({ id: 'r1', createdAt: '2026-09-13T09:00:01.000Z' });
    const linked = outbound({ id: 'r2', replyToMessageId: 'h1', createdAt: '2026-09-13T09:00:02.000Z' });
    const { responses } = replyTargets([h1, first, linked]);
    expect(responses.get('h1')).toEqual(['r2']);
  });

  it('keeps every explicit reply, oldest first', () => {
    const h1 = inbound({ id: 'h1', createdAt: '2026-09-13T09:00:00.000Z' });
    const a = outbound({ id: 'r1', replyToMessageId: 'h1', createdAt: '2026-09-13T09:00:01.000Z' });
    const b = outbound({ id: 'r2', replyToMessageId: 'h1', createdAt: '2026-09-13T09:00:02.000Z' });
    const { responses } = replyTargets([h1, a, b]);
    expect(responses.get('h1')).toEqual(['r1', 'r2']);
  });

  it('ignores a link at another thread and falls back for the human message', () => {
    const h1 = inbound({ id: 'h1', createdAt: '2026-09-13T09:00:00.000Z' });
    const foreign = outbound({ id: 'r1', threadId: 't2', replyToMessageId: 'h1', createdAt: '2026-09-13T09:00:01.000Z' });
    const own = outbound({ id: 'r2', replyToMessageId: 'r1', createdAt: '2026-09-13T09:00:02.000Z' });
    const { responses, repliesTo } = replyTargets([h1, foreign, own]);
    // r1 replies across threads: ignored. h1 falls back to the first outbound in its own segment.
    expect(repliesTo.get('r1')).toBeUndefined();
    expect(responses.get('h1')).toEqual(['r2']);
  });

  it('ignores a link at an outbound message', () => {
    const h1 = inbound({ id: 'h1', createdAt: '2026-09-13T09:00:00.000Z' });
    const reply = outbound({ id: 'r1', replyToMessageId: 'h1', createdAt: '2026-09-13T09:00:01.000Z' });
    const toOutbound = outbound({ id: 'r2', replyToMessageId: 'r1', createdAt: '2026-09-13T09:00:02.000Z' });
    const { responses, repliesTo } = replyTargets([h1, reply, toOutbound]);
    expect(responses.get('h1')).toEqual(['r1']);
    expect(repliesTo.get('r2')).toBeUndefined();
  });

  it('leaves a human message with no response unlinked', () => {
    const h1 = inbound({ id: 'h1', createdAt: '2026-09-13T09:00:00.000Z' });
    const { responses } = replyTargets([h1]);
    expect(responses.has('h1')).toBe(false);
  });

  it('links one reply to every human message a batched turn answered (VS-449)', () => {
    const h1 = inbound({ id: 'h1', createdAt: '2026-09-13T09:00:00.000Z' });
    const h2 = inbound({ id: 'h2', createdAt: '2026-09-13T09:00:01.000Z' });
    const reply = outbound({ id: 'r1', replyToMessageId: 'h2', replyToMessageIds: ['h1', 'h2'], createdAt: '2026-09-13T09:00:02.000Z' });
    const { responses, repliesTo } = replyTargets([h1, h2, reply]);
    expect(responses.get('h1')).toEqual(['r1']);
    expect(responses.get('h2')).toEqual(['r1']);
    // The quote still answers one message: the newest target.
    expect(repliesTo.get('r1')).toBe('h2');
  });
});

const { ChatMessage } = await import('../v2/ChatMessage');

describe('ChatMessage navigation controls', () => {
  it('shows Jump to response under a human message with a response, and not without one', () => {
    const onJumpTo = vi.fn();
    const human = inbound({ id: 'h1', body: 'Why is it red?' });
    const { rerender } = render(<ChatMessage message={human} ws="ws1" spent={null} onTicket={vi.fn()} responseIds={['r1']} onJumpTo={onJumpTo} />);
    fireEvent.click(screen.getByRole('button', { name: 'Jump to response' }));
    expect(onJumpTo).toHaveBeenCalledWith(['r1']);

    rerender(<ChatMessage message={human} ws="ws1" spent={null} onTicket={vi.fn()} onJumpTo={onJumpTo} />);
    expect(screen.queryByRole('button', { name: 'Jump to response' })).toBeNull();
  });

  it('renders the quote as a jump-back button only when its target resolves', () => {
    const onJumpTo = vi.fn();
    const reply = outbound({ id: 'r1', body: 'Because the build failed.', replyToMessageId: 'h1', replyToExcerpt: 'Why is it red?' });
    const { rerender } = render(<ChatMessage message={reply} ws="ws1" spent={null} onTicket={vi.fn()} jumpBackTo="h1" onJumpTo={onJumpTo} />);
    fireEvent.click(screen.getByRole('button', { name: 'Jump to the message this replies to' }));
    expect(onJumpTo).toHaveBeenCalledWith(['h1']);

    rerender(<ChatMessage message={reply} ws="ws1" spent={null} onTicket={vi.fn()} onJumpTo={onJumpTo} />);
    expect(screen.queryByRole('button', { name: 'Jump to the message this replies to' })).toBeNull();
    expect(screen.getByText('Why is it red?')).toBeInTheDocument();
  });
});

/* ---- The page: the link in the real conversation list, and the jump itself. ---- */

const state = vi.hoisted(() => ({
  width: 900,
  messages: [] as ThreadMessage[],
  decisions: [] as Decision[],
  traces: [] as RunTrace[],
  tickets: [] as Ticket[],
  workers: [] as Agent[],
  search: [] as Array<{ messageId: string; authorKind: string; authorId: string | null; createdAt: string; snippet: string }>,
  context: [] as ThreadMessage[],
  events: [] as unknown[],
  runState: 'connected' as 'connected' | 'offline' | 'unreachable',
  lastRun: null as { id: string; status: string } | null,
  answer: vi.fn(),
  post: vi.fn(),
  go: vi.fn(),
  reducedMotion: false,
}));

vi.mock('@tanstack/react-router', () => ({
  Outlet: () => null,
  useRouterState: () => '/w/ws1/chat',
  useParams: () => ({}),
}));
vi.mock('../app/link', () => ({
  A: ({ to, children, ...rest }: { to: string; children?: ReactNode }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
  useGo: () => state.go,
}));
vi.mock('../api/context', () => ({
  useWs: () => 'ws1',
  useConnection: () => ({ state: 'connected', capturedAt: null, lastSeq: 0, attempts: 0 }),
  useWorkspaceEvents: () => undefined,
}));
vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>();
  return { ...actual, useQueryClient: () => ({ invalidateQueries: () => undefined }) };
});
vi.mock('../api/runStream', () => ({
  useRunEventStream: () => ({ events: [], status: { state: state.runState }, retryNow: vi.fn() }),
}));
vi.mock('../v2/chatSplit', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../v2/chatSplit')>();
  return { ...actual, useElementWidth: () => ({ ref: () => undefined, width: state.width }) };
});
vi.mock('../api/hooks', () => ({
  ACCOUNTS_REFRESH_MS: 300_000,
  useThreads: () => ({ data: [{ id: 't1' }], isSuccess: true }),
  useCreateThread: () => ({ data: { id: 't1' }, mutate: vi.fn(), isPending: false }),
  useThreadMessages: () => ({
    data: state.messages,
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
    isLoadingOlder: false,
    hasOlder: false,
    loadOlder: vi.fn(),
  }),
  usePostThreadMessage: () => ({ mutateAsync: state.post, mutate: state.post, isPending: false }),
  useDecisions: (params: { status?: string | string[] } = {}) => {
    const wanted = params.status === undefined ? ['open'] : Array.isArray(params.status) ? params.status : [params.status];
    return { data: state.decisions.filter((d) => wanted.includes(d.status)), isSuccess: true };
  },
  useAnswerDecision: () => ({ mutate: state.answer, isPending: false }),
  useWorkers: () => ({ data: state.workers }),
  useProjects: () => ({ data: [{ id: 'p1', workspaceId: 'ws1', slug: 'web', name: 'web' }] }),
  useTickets: () => ({ data: state.tickets }),
  useWeaver: () => ({ data: { agent: { id: 'weaver1', runtimeId: 'claude' }, lastRun: state.lastRun } }),
  useRuntimes: () => ({ data: [{ id: 'claude', capabilities: { contextCompactionAt: 0.8 } }] }),
  useRuntimeModels: () => ({ data: [{ id: 'sonnet', contextWindowTokens: 1_000_000 }] }),
  useUsageAccounts: () => ({ data: [] }),
  useRunTraces: () => ({ data: state.traces }),
  useMessageContext: () => ({ data: state.context, isLoading: false }),
  useRunEvents: () => ({ data: state.events }),
  useThreadSearch: () => ({ data: state.search, isLoading: false, isError: false }),
  useRuns: () => ({ data: [] }),
  useTicketWorkProducts: () => ({ data: [], isLoading: false }),
  useTicketFor: () => ({ data: undefined }),
  useTicketDocument: () => ({ data: undefined, isLoading: false, isError: true }),
  useTicketDocumentById: () => ({ data: undefined, isLoading: false, isError: true }),
  useStartOrResumePlan: () => ({ mutate: vi.fn() }),
  usePlan: () => ({ data: undefined }),
  useRoles: () => ({ data: [] }),
  usePatchPlanDraft: () => ({ mutate: vi.fn() }),
  useRemovePlanDraft: () => ({ mutate: vi.fn() }),
  useSubmitPlan: () => ({ mutate: vi.fn(), isPending: false }),
  useDiscardPlan: () => ({ mutate: vi.fn() }),
}));

const { V2ChatPage } = await import('../v2/ChatPage');

const anchorOf = (id: string): HTMLElement => {
  const el = document.querySelector<HTMLElement>(`[data-message-id="${id}"]`);
  if (!el) throw new Error(`no anchor for ${id}`);
  return el;
};

const scroller = (): HTMLElement => {
  const el = document.querySelector<HTMLElement>('[data-v2-chat-scroll]');
  if (!el) throw new Error('no conversation scroller');
  return el;
};

/** Spy on the conversation scroller's own `scrollTo`, so a test can prove the jump stayed inside it. */
const spyScrollTo = (): ReturnType<typeof vi.fn> => {
  const spy = vi.fn();
  scroller().scrollTo = spy as unknown as HTMLElement['scrollTo'];
  return spy;
};

/** Record writes to the scroller's own `scrollTop` (the instant path). */
const spyScrollTop = (): number[] => {
  const writes: number[] = [];
  let v = 0;
  Object.defineProperty(scroller(), 'scrollTop', {
    configurable: true,
    get: () => v,
    set: (n: number) => {
      v = n;
      writes.push(n);
    },
  });
  return writes;
};

const scrollIntoView = (): ReturnType<typeof vi.fn> => window.HTMLElement.prototype.scrollIntoView as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  window.HTMLElement.prototype.scrollTo = vi.fn();
  state.width = 900;
  state.messages = [];
  state.decisions = [];
  state.traces = [];
  state.tickets = [];
  state.workers = [agent({ id: 'w1', name: 'Platform Engineer #7', status: 'running', ticketId: null })];
  state.search = [];
  state.context = [];
  state.events = [];
  state.runState = 'connected';
  state.lastRun = null;
  state.reducedMotion = false;
  state.answer.mockReset();
  state.post.mockReset().mockResolvedValue(undefined);
  state.go.mockReset();
  // A minimal matchMedia whose answer the reduced-motion test can flip.
  window.matchMedia = ((q: string) => ({
    matches: q.includes('prefers-reduced-motion') ? state.reducedMotion : false,
    media: q,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
});

afterEach(() => {
  vi.useRealTimers();
});

describe('the conversation’s Jump to response', () => {
  it('shows the link for an explicit reply and jumps to it, highlighting and focusing it', () => {
    state.messages = [
      inbound({ id: 'h1', body: 'Why is it red?', createdAt: '2026-09-13T09:00:00.000Z' }),
      outbound({ id: 'r1', body: 'Because the build failed.', replyToMessageId: 'h1', replyToExcerpt: 'Why is it red?', createdAt: '2026-09-13T09:00:01.000Z' }),
    ];
    render(<V2ChatPage />);
    const scrollTo = spyScrollTo();

    fireEvent.click(screen.getByRole('button', { name: 'Jump to response' }));

    // The jump scrolls the conversation scroller itself, never an ancestor (the shell or a pane).
    expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ behavior: 'smooth' }));
    expect(scrollIntoView()).not.toHaveBeenCalled();
    expect(anchorOf('r1')).toHaveAttribute('data-jump-highlight');
    expect(anchorOf('h1')).not.toHaveAttribute('data-jump-highlight');
    expect(document.activeElement).toBe(anchorOf('r1'));
  });

  it('shows the link through the fallback when the reply carries no explicit target', () => {
    state.messages = [
      inbound({ id: 'h1', body: 'One', createdAt: '2026-09-13T09:00:00.000Z' }),
      outbound({ id: 'r1', body: 'Answer one', createdAt: '2026-09-13T09:00:01.000Z' }),
      inbound({ id: 'h2', body: 'Two', createdAt: '2026-09-13T09:00:02.000Z' }),
      outbound({ id: 'r2', body: 'Answer two', createdAt: '2026-09-13T09:00:03.000Z' }),
    ];
    render(<V2ChatPage />);

    const links = screen.getAllByRole('button', { name: 'Jump to response' });
    expect(links).toHaveLength(2);
    fireEvent.click(links[0]!);
    expect(anchorOf('r1')).toHaveAttribute('data-jump-highlight');
  });

  it('hides the link when the human message has no response', () => {
    state.messages = [inbound({ id: 'h1', body: 'Still waiting', createdAt: '2026-09-13T09:00:00.000Z' })];
    render(<V2ChatPage />);
    expect(screen.queryByRole('button', { name: 'Jump to response' })).toBeNull();
  });

  it('links a batched reply to every human message it answered (VS-449)', () => {
    state.messages = [
      inbound({ id: 'h1', body: 'First', createdAt: '2026-09-13T09:00:00.000Z' }),
      inbound({ id: 'h2', body: 'Second', createdAt: '2026-09-13T09:00:01.000Z' }),
      outbound({ id: 'r1', body: 'Both at once', replyToMessageId: 'h2', replyToMessageIds: ['h1', 'h2'], replyToExcerpt: 'Second', createdAt: '2026-09-13T09:00:02.000Z' }),
    ];
    render(<V2ChatPage />);

    const links = screen.getAllByRole('button', { name: 'Jump to response' });
    expect(links).toHaveLength(2);
    const scrollTo = spyScrollTo();
    fireEvent.click(links[0]!);
    expect(anchorOf('r1')).toHaveAttribute('data-jump-highlight');
    expect(scrollTo).toHaveBeenCalledTimes(1);
  });

  it('jumps to the first of two linked replies and highlights both', () => {
    state.messages = [
      inbound({ id: 'h1', body: 'One', createdAt: '2026-09-13T09:00:00.000Z' }),
      outbound({ id: 'r1', replyToMessageId: 'h1', createdAt: '2026-09-13T09:00:01.000Z' }),
      outbound({ id: 'r2', replyToMessageId: 'h1', createdAt: '2026-09-13T09:00:02.000Z' }),
    ];
    render(<V2ChatPage />);
    const scrollTo = spyScrollTo();

    fireEvent.click(screen.getByRole('button', { name: 'Jump to response' }));

    expect(anchorOf('r1')).toHaveAttribute('data-jump-highlight');
    expect(anchorOf('r2')).toHaveAttribute('data-jump-highlight');
    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(scrollIntoView()).not.toHaveBeenCalled();
  });

  it('clears the highlight after a beat', () => {
    vi.useFakeTimers();
    state.messages = [
      inbound({ id: 'h1', body: 'Why?', createdAt: '2026-09-13T09:00:00.000Z' }),
      outbound({ id: 'r1', replyToMessageId: 'h1', createdAt: '2026-09-13T09:00:01.000Z' }),
    ];
    render(<V2ChatPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Jump to response' }));
    expect(anchorOf('r1')).toHaveAttribute('data-jump-highlight');

    act(() => vi.advanceTimersByTime(2000));
    expect(anchorOf('r1')).not.toHaveAttribute('data-jump-highlight');
  });

  it('returns from a weaver reply’s quote to the human message it answers', () => {
    state.messages = [
      inbound({ id: 'h1', body: 'Why is it red?', createdAt: '2026-09-13T09:00:00.000Z' }),
      outbound({ id: 'r1', body: 'Because.', replyToMessageId: 'h1', replyToExcerpt: 'Why is it red?', createdAt: '2026-09-13T09:00:01.000Z' }),
    ];
    render(<V2ChatPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Jump to the message this replies to' }));

    expect(anchorOf('h1')).toHaveAttribute('data-jump-highlight');
    expect(anchorOf('r1')).not.toHaveAttribute('data-jump-highlight');
  });

  it('scrolls instantly under reduced motion', () => {
    state.reducedMotion = true;
    state.messages = [
      inbound({ id: 'h1', body: 'Why?', createdAt: '2026-09-13T09:00:00.000Z' }),
      outbound({ id: 'r1', replyToMessageId: 'h1', createdAt: '2026-09-13T09:00:01.000Z' }),
    ];
    render(<V2ChatPage />);
    const scrollTo = spyScrollTo();
    const writes = spyScrollTop();

    fireEvent.click(screen.getByRole('button', { name: 'Jump to response' }));
    // Instant: the scroller is moved directly, with no smooth scroll requested.
    expect(scrollTo).not.toHaveBeenCalled();
    expect(writes).toHaveLength(1);
    expect(scrollIntoView()).not.toHaveBeenCalled();
  });

  it('shows the link when a reply arrives live', async () => {
    state.messages = [inbound({ id: 'h1', body: 'Why?', createdAt: '2026-09-13T09:00:00.000Z' })];
    const utils = render(<V2ChatPage />);
    expect(screen.queryByRole('button', { name: 'Jump to response' })).toBeNull();

    state.messages = [
      state.messages[0]!,
      outbound({ id: 'r1', body: 'Because.', replyToMessageId: 'h1', createdAt: '2026-09-13T09:00:05.000Z' }),
    ];
    utils.rerender(<V2ChatPage />);
    expect(await screen.findByRole('button', { name: 'Jump to response' })).toBeInTheDocument();
  });
});