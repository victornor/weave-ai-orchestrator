/** VS-350: the V2 worker page — identity, tabs, shared feed, actions, handover and steer. */
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Agent, ThreadMessage } from '@weave-ai/shared';
import { agent, ticket } from './factories';

const state = vi.hoisted(() => ({
  agent: null as Agent | null,
  go: vi.fn() as unknown as ReturnType<typeof vi.fn>,
  action: vi.fn() as unknown as ReturnType<typeof vi.fn>,
  send: vi.fn() as unknown as ReturnType<typeof vi.fn>,
  end: vi.fn() as unknown as ReturnType<typeof vi.fn>,
  start: vi.fn() as unknown as ReturnType<typeof vi.fn>,
  patch: vi.fn() as unknown as ReturnType<typeof vi.fn>,
  actionError: null as Error | null,
  // VS-495: null keeps every existing test's ticketed worker unchanged; a session test overrides both.
  noTicket: false,
  thread: null as { id: string; agentId: string } | null,
  role: null as { id: string; name: string } | null,
  threadMessages: [] as ThreadMessage[],
  postThread: vi.fn() as unknown as ReturnType<typeof vi.fn>,
  compact: vi.fn() as unknown as ReturnType<typeof vi.fn>,
  setOption: vi.fn() as unknown as ReturnType<typeof vi.fn>,
  resetOption: vi.fn() as unknown as ReturnType<typeof vi.fn>,
  models: null as { workers: { runtime: string; model: string | null }; weaver: { runtime: string; model: string | null }; workerOptions: Array<{ id: string; description: string; runtime: string | null; model: string | null }>; source: { weaver: string; workers: string; workerOptions: string } } | null,
  sessionTurns: null as number | null,
}));

vi.mock('@tanstack/react-router', () => ({
  useRouterState: (o?: { select?: (s: { location: { pathname: string } }) => unknown }) => (o?.select ? o.select({ location: { pathname: '/w/ws1/workers/a1' } }) : '/w/ws1/workers/a1'),
  useParams: () => ({ ws: 'ws1', workerId: 'a1' }),
}));
vi.mock('../app/link', () => ({ useGo: () => state.go, useSearchParams: () => ({}) }));
vi.mock('../api/context', () => ({ useWs: () => 'ws1' }));
vi.mock('../lib/drafts', () => ({ draftKey: () => 'k', useDraft: () => ({ draft: { text: 'steer this' }, patch: state.patch }) }));
vi.mock('../v2/WorkerFeed', () => ({ WorkerFeed: () => <div data-testid="worker-feed" /> }));
vi.mock('../api/hooks', () => ({
  useWorker: () => ({ data: state.agent ? { agent: state.agent, ticket: state.noTicket ? null : ticket({ id: 'tk1', identifier: 'ACME-1' }), thread: state.thread, role: state.role, project: null, lastRun: null, usage: null, worktree: null, scheduledWake: null, sessionTurns: state.sessionTurns, input: { midTurn: false, interrupts: false } } : undefined, isLoading: false, isError: false }),
  useWorkerBrief: () => ({ data: { brief: '# The brief' } }),
  useWorkerAction: () => ({ mutate: state.action, error: state.actionError }),
  useWorkerMessage: () => ({ mutateAsync: state.send, error: null }),
  usePostThreadMessage: () => ({ mutateAsync: state.postThread, error: null }),
  useCompactWorker: () => ({ mutate: state.compact, isPending: false, error: null }),
  useModels: () => ({ data: state.models }),
  useSetSessionOption: () => ({ mutate: state.setOption, isPending: false, reset: state.resetOption, error: null }),
  useThreadMessages: () => ({ data: state.threadMessages, isLoading: false, isError: false, error: null }),
  useHandoverCommand: () => ({ isLoading: false, data: null }),
  useStartHandover: () => ({ mutate: state.start, error: null }),
  useEndHandover: () => ({ mutateAsync: state.end, error: null }),
  useWorkers: () => ({ data: [] }),
  useIncidents: () => ({ data: { items: [], total: 0 } }),
  useWorkspaces: () => ({ data: [] }),
}));

const { WorkerBody, sessionAuthorLabel } = await import('../v2/WorkerPage');

/** A thread message with only the fields the session transcript reads. */
const message = (over: Partial<ThreadMessage> = {}): ThreadMessage => ({
  id: 'm1',
  threadId: 'th1',
  direction: 'inbound',
  authorKind: 'human',
  authorId: null,
  runId: null,
  projectId: null,
  blockId: null,
  replyToMessageId: null,
  replyToMessageIds: [],
  replyToExcerpt: null,
  body: 'hi',
  parts: [],
  externalMessageId: null,
  deliveryStatus: 'received',
  createdAt: 't0',
  ...over,
});

beforeEach(() => {
  state.go = vi.fn();
  state.action = vi.fn();
  state.send = vi.fn().mockResolvedValue({ delivery: 'mid_turn' });
  state.end = vi.fn().mockResolvedValue(undefined);
  state.start = vi.fn();
  state.patch = vi.fn();
  state.actionError = null;
  state.agent = agent({ id: 'a1', name: 'Backend Engineer #7', status: 'running', runtimeId: 'claude-code' });
  state.noTicket = false;
  state.thread = null;
  state.role = null;
  state.threadMessages = [] as ThreadMessage[];
  state.postThread = vi.fn().mockResolvedValue(undefined);
  state.compact = vi.fn();
  state.setOption = vi.fn();
  state.resetOption = vi.fn();
  state.models = null;
  state.sessionTurns = null;
});

describe('V2 worker page', () => {
  it('shows the worker identity and renders the brief tab', () => {
    render(<WorkerBody workerId="a1" />);
    expect(screen.getByText('Backend Engineer #7')).toBeInTheDocument();
    expect(screen.getByTestId('worker-feed')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Brief' }));
    expect(screen.getByRole('heading', { name: 'The brief' })).toBeInTheDocument();
  });

  it('offers Resume when the worker is paused', () => {
    state.agent = agent({ id: 'a1', name: 'Backend Engineer #7', status: 'paused', runtimeId: 'claude-code' });
    render(<WorkerBody workerId="a1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Resume' }));
    expect(state.action).toHaveBeenCalledWith({ id: 'a1', action: 'resume' });
  });

  it('posts a steer message and reports the delivery outcome', async () => {
    render(<WorkerBody workerId="a1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(state.send).toHaveBeenCalledWith({ id: 'a1', ticketId: 'tk1', body: 'steer this', live: true });
    expect(await screen.findByText('Delivered to the running turn.')).toBeInTheDocument();
  });

  it('gives a held session back with a note', async () => {
    state.agent = agent({ id: 'a1', name: 'Backend Engineer #7', status: 'paused', runtimeId: 'claude-code', pauseDetail: { code: 'held_by_human', family: null, message: null, resetAt: null, runId: null } });
    render(<WorkerBody workerId="a1" />);
    fireEvent.click(screen.getAllByRole('button', { name: 'Give it back' })[0] as HTMLElement);
    fireEvent.change(screen.getByLabelText('What did you do while you held this session?'), { target: { value: 'did stuff' } });
    fireEvent.click(screen.getByRole('button', { name: 'Give it back' }));
    expect(state.end).toHaveBeenCalledWith({ id: 'a1', note: 'did stuff' });
  });

  it('shows a failed action error instead of failing silently', () => {
    state.actionError = new Error('the worker is already gone');
    render(<WorkerBody workerId="a1" />);
    expect(screen.getByRole('alert')).toHaveTextContent('the worker is already gone');
  });

  it('shows why the last turn failed instead of a bare status (VS-526)', () => {
    state.agent = agent({ id: 'a1', status: 'error', errorText: 'Not inside a trusted directory and --skip-git-repo-check was not specified.' });
    render(<WorkerBody workerId="a1" />);
    expect(screen.getByRole('alert')).toHaveTextContent('--skip-git-repo-check was not specified');
  });

  it('shows no failure band when the agent has not errored', () => {
    render(<WorkerBody workerId="a1" />);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('requires a confirmation before cancelling', () => {
    render(<WorkerBody workerId="a1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(state.action).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm cancel' }));
    expect(state.action).toHaveBeenCalledWith({ id: 'a1', action: 'cancel', reason: 'cancelled from the web app' });
  });

  describe('a persistent session with no ticket (VS-495)', () => {
    beforeEach(() => {
      state.agent = agent({ id: 'a1', kind: 'session', ticketId: null, name: 'Backend Engineer — session', status: 'active', runtimeId: 'claude-code' });
      state.noTicket = true;
      state.thread = { id: 'th1', agentId: 'a1' };
    });

    it('offers Compact now and posts to the thread instead of a ticket', async () => {
      render(<WorkerBody workerId="a1" />);
      expect(screen.queryByRole('button', { name: 'Ticket' })).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'Compact now' }));
      expect(state.compact).toHaveBeenCalled();

      fireEvent.change(screen.getByPlaceholderText('Talk to this session…'), { target: { value: 'hello there' } });
      fireEvent.click(screen.getByRole('button', { name: 'Send' }));
      expect(state.postThread).toHaveBeenCalledWith({ threadId: 'th1', body: 'hello there' });
      expect(state.send).not.toHaveBeenCalled();
    });
    it('names each author of the session conversation (VS-553)', () => {
      state.role = { id: 'r1', name: 'Full-stack Engineer' };
      state.threadMessages = [
        message({ id: 'm1', direction: 'inbound', authorKind: 'human', authorId: null, body: 'hi' }),
        message({ id: 'm2', direction: 'outbound', authorKind: 'agent', authorId: 'a1', body: 'Hello — the session is up and running.' }),
        message({ id: 'm3', direction: 'outbound', authorKind: 'agent', authorId: 'weaver1', body: 'The weaver relayed this.' }),
        message({ id: 'm4', direction: 'outbound', authorKind: 'system', authorId: null, body: 'Session resumed.' }),
      ];
      render(<WorkerBody workerId="a1" />);
      expect(screen.getByText('Full-stack Engineer')).toBeInTheDocument();
      expect(screen.getByText('Weaver')).toBeInTheDocument();
      expect(screen.getByText('System')).toBeInTheDocument();
      // Only the human's own message reads `you`, whatever its direction; nothing else falls back to it.
      expect(screen.getAllByText('you')).toHaveLength(1);
    });

    it("renders the session's answer and a turn that ended without one (VS-596)", () => {
      state.role = { id: 'r1', name: 'Full-stack Engineer' };
      state.threadMessages = [
        message({ id: 'm1', direction: 'inbound', authorKind: 'human', authorId: null, body: 'are you there?' }),
        message({ id: 'm2', direction: 'outbound', authorKind: 'agent', authorId: 'a1', body: 'Here is the answer.' }),
        message({ id: 'm3', direction: 'outbound', authorKind: 'system', authorId: null, body: 'This turn ended without an answer.' }),
      ];
      render(<WorkerBody workerId="a1" />);
      // The answer is the session's own message, named by the role.
      expect(screen.getByText('Here is the answer.')).toBeInTheDocument();
      expect(screen.getAllByText('Full-stack Engineer').length).toBeGreaterThan(0);
      // An empty turn is a state, not a blank thread: a centred system notice, labelled as system.
      const notice = screen.getByText('This turn ended without an answer.');
      expect(notice.closest('li')).toHaveClass('items-center');
      expect(screen.getByText('System')).toBeInTheDocument();
    });
  });

  describe('sessionAuthorLabel (VS-553)', () => {
    it('attributes by author, never by direction', () => {
      expect(sessionAuthorLabel({ authorKind: 'human', authorId: null }, 'a1', 'Full-stack Engineer')).toBe('you');
      expect(sessionAuthorLabel({ authorKind: 'agent', authorId: 'a1' }, 'a1', 'Full-stack Engineer')).toBe('Full-stack Engineer');
      expect(sessionAuthorLabel({ authorKind: 'agent', authorId: 'weaver1' }, 'a1', 'Full-stack Engineer')).toBe('Weaver');
      expect(sessionAuthorLabel({ authorKind: 'system', authorId: null }, 'a1', 'Full-stack Engineer')).toBe('System');
      expect(sessionAuthorLabel({ authorKind: 'plugin', authorId: null }, 'a1', 'Full-stack Engineer')).toBe('plugin');
    });
  });

  // VS-526: the session's worker option is selectable and changeable, and the surface states what a
  // change does to the conversation before it is applied.
  describe('choosing a session worker option (VS-526)', () => {
    beforeEach(() => {
      state.noTicket = true;
      state.thread = { id: 'th1', agentId: 'a1' };
      state.models = {
        workers: { runtime: 'claude-code', model: null },
        weaver: { runtime: 'claude-code', model: null },
        workerOptions: [
          { id: 'quick', description: 'fast', runtime: 'claude-code', model: 'haiku' },
          { id: 'deep', description: 'slow', runtime: 'codex', model: null },
        ],
        source: { weaver: 'default', workers: 'default', workerOptions: 'workspace' },
      };
    });

    it('shows the current option and stages a change before applying it', () => {
      state.agent = agent({ id: 'a1', kind: 'session', ticketId: null, status: 'active', runtimeId: 'claude-code', workerModelId: 'quick' });
      render(<WorkerBody workerId="a1" />);
      const select = document.querySelector('[data-v2-session-option]') as HTMLSelectElement;
      expect(select.value).toBe('quick');

      fireEvent.change(select, { target: { value: 'deep' } });
      // Staged, not applied: the surface must state the effect first.
      expect(state.setOption).not.toHaveBeenCalled();
      const band = document.querySelector('[data-v2-session-option-confirm]') as HTMLElement;
      expect(band.textContent).toContain('different runtime');
      expect(band.textContent).toContain('restarts on codex');

      fireEvent.click(screen.getByRole('button', { name: 'Switch' }));
      expect(state.setOption).toHaveBeenCalledWith({ workerModelId: 'deep' }, expect.anything());
    });

    it('says a same-runtime change keeps the conversation', () => {
      state.agent = agent({ id: 'a1', kind: 'session', ticketId: null, status: 'active', runtimeId: 'codex', workerModelId: 'deep' });
      state.models = { ...state.models!, workerOptions: [
        { id: 'deep', description: 'slow', runtime: 'codex', model: null },
        { id: 'fast', description: 'quick', runtime: 'codex', model: 'mini' },
      ] };
      render(<WorkerBody workerId="a1" />);
      fireEvent.change(document.querySelector('[data-v2-session-option]') as HTMLSelectElement, { target: { value: 'fast' } });
      const band = document.querySelector('[data-v2-session-option-confirm]') as HTMLElement;
      expect(band.textContent).toContain('same runtime');
      expect(band.textContent).toContain('kept');
    });

    it('says the conversation restarted when the session is fresh after a runtime change', () => {
      state.agent = agent({ id: 'a1', kind: 'session', ticketId: null, status: 'active', runtimeId: 'codex', workerModelId: 'deep' });
      state.sessionTurns = 0;
      render(<WorkerBody workerId="a1" />);
      expect(document.querySelector('[data-v2-session-restarted]')?.textContent).toContain('New conversation on codex');
    });

    it('shows no restart banner once the fresh conversation has taken a turn', () => {
      state.agent = agent({ id: 'a1', kind: 'session', ticketId: null, status: 'active', runtimeId: 'codex', workerModelId: 'deep' });
      state.sessionTurns = 3;
      render(<WorkerBody workerId="a1" />);
      expect(document.querySelector('[data-v2-session-restarted]')).toBeNull();
    });
  });
});
