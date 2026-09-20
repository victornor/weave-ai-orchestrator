/**
 * VS-629: both new scrollers offer the jump-to-latest control when the reader has scrolled away from
 * the bottom, and activating it resumes the follow. The shared follow hook is mocked here so the
 * control's own behaviour is asserted rather than jsdom's (unmeasurable) geometry.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const stick = vi.hoisted(() => ({
  atBottom: true,
  unread: false,
  toBottom: vi.fn() as ReturnType<typeof vi.fn>,
  scrollRef: vi.fn() as ReturnType<typeof vi.fn>,
  bottomRef: { current: null } as { current: null },
  following: { current: true } as { current: boolean },
  pause: vi.fn() as ReturnType<typeof vi.fn>,
}));

vi.mock('../lib/stickToBottom', () => ({
  useStickToBottom: () => ({
    scrollRef: stick.scrollRef,
    bottomRef: stick.bottomRef,
    atBottom: stick.atBottom,
    unread: stick.unread,
    toBottom: stick.toBottom,
    following: stick.following,
    pause: stick.pause,
  }),
}));

vi.mock('@tanstack/react-router', () => ({
  useParams: () => ({ ws: 'ws1', workerId: 'a1' }),
  useRouterState: (o?: { select?: (s: { location: { pathname: string } }) => unknown }) => (o?.select ? o.select({ location: { pathname: '/w/ws1/workers/a1' } }) : '/w/ws1/workers/a1'),
}));
vi.mock('../app/link', () => ({ useGo: () => vi.fn(), useSearchParams: () => ({}) }));
vi.mock('../api/context', () => ({ useWs: () => 'ws1' }));
vi.mock('../api/workerActivity', () => ({ useWorkerActivity: () => new Map() }));
vi.mock('../api/runStream', () => ({
  useRunEventStream: () => ({ events: [], partials: [], lastPartialAt: null, partialSince: null, status: { state: 'connected' }, retryNow: vi.fn() }),
}));
vi.mock('../api/hooks', () => ({
  usePartialOutput: () => 'full',
  useThreadMessages: () => ({ data: [message], isLoading: false, isError: false, error: null }),
  useRuns: () => ({ data: [] }),
  useTicket: () => ({ data: { ticket: { id: 'tk1', identifier: 'ACME-42', kind: 'change', status: 'in_progress', title: 'A ticket' }, worker: null, project: null, role: null, blockers: [], attachments: [] }, isLoading: false, isError: false }),
  useTicketRuns: () => ({ data: [], isLoading: false }),
  useTicketComments: () => ({ data: [], isLoading: false }),
  useWorkers: () => ({ data: [] }),
  useWorkerActivity: () => new Map(),
}));

const message = {
  id: 'm1', threadId: 'th1', direction: 'inbound' as const, authorKind: 'human' as const, authorId: null, runId: null,
  projectId: null, blockId: null, replyToMessageId: null, replyToMessageIds: [], replyToExcerpt: null,
  body: 'hello there', parts: [], externalMessageId: null, deliveryStatus: 'received' as const, createdAt: '2026-09-20T09:00:00.000Z',
};

const { SessionThreadFeed } = await import('../v2/WorkerPage');
const { TicketModal } = await import('../v2/ticket/TicketModal');

beforeEach(() => {
  stick.atBottom = true;
  stick.unread = false;
  stick.toBottom.mockClear();
});

describe('the session conversation follow control (VS-629)', () => {
  it('offers jump-to-latest while paused and resumes on activation', () => {
    stick.atBottom = false;
    stick.unread = true;
    render(<SessionThreadFeed threadId="th1" label="Conversation" sessionAgentId="a1" roleName="Backend Engineer" />);
    const button = screen.getByRole('button', { name: 'Scroll to bottom — new messages' });
    fireEvent.click(button);
    expect(stick.toBottom).toHaveBeenCalledTimes(1);
  });

  it('shows no control while at the bottom', () => {
    render(<SessionThreadFeed threadId="th1" label="Conversation" sessionAgentId="a1" roleName="Backend Engineer" />);
    expect(screen.queryByRole('button', { name: /Scroll to bottom/ })).toBeNull();
  });
});

describe('the ticket modal feed follow control (VS-629)', () => {
  it('offers jump-to-latest while paused and resumes on activation', () => {
    stick.atBottom = false;
    render(<TicketModal identifier="ACME-42" onClose={() => undefined} />);
    const button = screen.getByRole('button', { name: /Scroll to bottom/ });
    fireEvent.click(button);
    expect(stick.toBottom).toHaveBeenCalledTimes(1);
  });

  it('shows no control while at the bottom', () => {
    render(<TicketModal identifier="ACME-42" onClose={() => undefined} />);
    expect(screen.queryByRole('button', { name: /Scroll to bottom/ })).toBeNull();
  });
});