/** VS-350: the V2 worker page — identity, tabs, shared feed, actions, handover and steer. */
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Agent, Run, RunEvent, ThreadMessage } from '@weave-ai/shared';
import { agent, run, ticket } from './factories';

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
  /** VS-656: the agent's sessions, for the conversation's retirement boundaries. */
  sessions: [] as Array<{ id: string; status: string; turnCount: number; createdAt: string; updatedAt: string; retiredReason: string | null }>,
  /** VS-618: the session agent's runs, and each run's events/partials for its turn transcript. */
  runs: [] as Run[],
  /** VS-656: what the old workspace-wide window would have returned — must not be what the feed reads. */
  workspaceRuns: [] as Run[],
  /** VS-656: the run-page count the feed asked for, one entry per render. */
  sessionRunPages: [] as number[],
  hasOlder: false,
  loadOlder: vi.fn() as ReturnType<typeof vi.fn>,
  runEvents: {} as Record<string, RunEvent[]>,
  runPartials: {} as Record<string, Array<{ partId: string; kind: 'text' | 'thinking' | 'tool_input'; text: string }>>,
}));

vi.mock('@tanstack/react-router', () => ({
  useRouterState: (o?: { select?: (s: { location: { pathname: string } }) => unknown }) => (o?.select ? o.select({ location: { pathname: '/w/ws1/workers/a1' } }) : '/w/ws1/workers/a1'),
  useParams: () => ({ ws: 'ws1', workerId: 'a1' }),
}));
vi.mock('../app/link', () => ({ useGo: () => state.go, useSearchParams: () => ({}) }));
vi.mock('../api/context', () => ({ useWs: () => 'ws1' }));
vi.mock('../lib/drafts', () => ({ draftKey: () => 'k', useDraft: () => ({ draft: { text: 'steer this' }, patch: state.patch }) }));
vi.mock('../v2/WorkerFeed', () => ({ WorkerFeed: () => <div data-testid="worker-feed" />, useWorkerRun: () => ({ run: null, live: false }) }));
vi.mock('../api/runStream', () => ({
  useRunEventStream: (runId: string | null) => ({
    events: runId ? state.runEvents[runId] ?? [] : [],
    partials: runId ? state.runPartials[runId] ?? [] : [],
    lastPartialAt: null,
    partialSince: null,
    status: { state: 'connected' },
    retryNow: vi.fn(),
  }),
}));
vi.mock('../api/hooks', () => ({
  // What the daemon's runtime list declares for each runtime (VS-615).
  usePartialOutput: (id?: string | null) => (({ opencode: 'full', claude: 'full', codex: 'full', cursor: 'text', gemini: 'text', weave: 'full' }) as Record<string, string>)[id ?? ''] ?? 'none',
  useWorker: () => ({ data: state.agent ? { agent: state.agent, ticket: state.noTicket ? null : ticket({ id: 'tk1', identifier: 'ACME-1' }), thread: state.thread, role: state.role, project: null, lastRun: null, usage: null, worktree: null, scheduledWake: null, sessionTurns: state.sessionTurns, sessions: state.sessions, input: { midTurn: false, interrupts: false } } : undefined, isLoading: false, isError: false }),
  useWorkerBrief: () => ({ data: { brief: '# The brief' } }),
  useWorkerAction: () => ({ mutate: state.action, error: state.actionError }),
  useWorkerMessage: () => ({ mutateAsync: state.send, error: null }),
  usePostThreadMessage: () => ({ mutateAsync: state.postThread, error: null }),
  useCompactWorker: () => ({ mutate: state.compact, isPending: false, error: null }),
  useModels: () => ({ data: state.models }),
  useSetSessionOption: () => ({ mutate: state.setOption, isPending: false, reset: state.resetOption, error: null }),
  useThreadMessages: () => ({ data: state.threadMessages, isLoading: false, isError: false, error: null, hasOlder: state.hasOlder, isLoadingOlder: false, loadOlder: state.loadOlder }),
  useRuns: () => ({ data: state.workspaceRuns }),
  useSessionRuns: (_agentId: string, pages?: number) => { state.sessionRunPages.push(pages ?? 1); return { data: state.runs }; },
  useHandoverCommand: () => ({ isLoading: false, data: null }),
  useStartHandover: () => ({ mutate: state.start, error: null }),
  useEndHandover: () => ({ mutateAsync: state.end, error: null }),
  useWorkers: () => ({ data: [] }),
  // `V2Page`'s counts fan out per workspace (VS-629 renders the whole page in a test).
  useWorkersMany: () => [],
  useDecisionsMany: () => [],
  useIncidents: () => ({ data: { items: [], total: 0 } }),
  useWorkspaces: () => ({ data: [] }),
}));

const { WorkerBody, V2WorkerPage, sessionAuthorLabel } = await import('../v2/WorkerPage');

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

/** A session run for the ticketless feed (VS-618). */
const sessionRun = (over: Partial<Run> = {}): Run =>
  run({ id: 'run9', agentId: 'a1', ticketId: null, runtimeId: 'opencode', status: 'running', startedAt: '2026-09-20T00:01:00.000Z', createdAt: '2026-09-20T00:01:00.000Z', ...over });

let eventSeq = 0;
/** A run event with only the fields the transcript reads. */
const ev = (type: RunEvent['type'], payload: Record<string, unknown> = {}, runId = 'run9'): RunEvent => ({
  id: `e${(eventSeq += 1)}`,
  runId,
  seq: eventSeq,
  ts: '2026-09-20T00:01:30.000Z',
  stream: 'stdout',
  level: 'info',
  type,
  payload,
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
  state.sessions = [];
  state.runs = [];
  state.workspaceRuns = [];
  state.sessionRunPages = [];
  state.hasOlder = false;
  state.loadOlder = vi.fn();
  state.runEvents = {};
  state.runPartials = {};
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
    it('sends a pasted image and a browsed file on the session message (VS-657)', () => {
      render(<WorkerBody workerId="a1" />);
      const box = screen.getByPlaceholderText('Talk to this session…');
      fireEvent.change(box, { target: { value: 'here is the spec' } });
      const pasted = new File(['x'], 'clipboard.png', { type: 'image/png' });
      fireEvent.paste(box, { clipboardData: { items: [{ kind: 'file', getAsFile: () => pasted }] } });
      const browsed = new File(['y'], 'spec.md', { type: 'text/markdown' });
      fireEvent.change(screen.getByTestId('composer-file-input'), { target: { files: [browsed] } });

      fireEvent.click(screen.getByLabelText('Send'));
      expect(state.postThread).toHaveBeenCalledWith(expect.objectContaining({ threadId: 'th1', body: 'here is the spec', files: [pasted, browsed] }));
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

    it('keeps the session’s own words when they are not a delivered run answer (VS-618)', () => {
      state.role = { id: 'r1', name: 'Full-stack Engineer' };
      state.threadMessages = [
        message({ id: 'm2', direction: 'outbound', authorKind: 'agent', authorId: 'a1', body: 'Here is the answer.' }),
      ];
      render(<WorkerBody workerId="a1" />);
      expect(screen.getByText('Here is the answer.')).toBeInTheDocument();
      expect(screen.getAllByText('Full-stack Engineer').length).toBeGreaterThan(0);
    });

    it('shows a failed turn’s real reason as a system notice (VS-598)', () => {
      state.role = { id: 'r1', name: 'Full-stack Engineer' };
      state.runs = [sessionRun({ status: 'failed', finishedAt: '2026-09-20T00:05:00.000Z' })];
      state.threadMessages = [
        message({ id: 'm1', createdAt: '2026-09-20T00:00:30.000Z', body: 'any update?' }),
        message({ id: 'm2', direction: 'outbound', authorKind: 'system', authorId: null, runId: 'run9', body: 'The turn failed: the runtime crashed unexpectedly.', createdAt: '2026-09-20T00:05:00.000Z' }),
      ];
      render(<WorkerBody workerId="a1" />);
      const notice = screen.getByText('The turn failed: the runtime crashed unexpectedly.');
      expect(notice.closest('li')).toHaveClass('items-center');
      expect(screen.getByText('System')).toBeInTheDocument();
    });

    it('shows the live activity row for a session turn, never an idle-looking thread (VS-602)', () => {
      state.runs = [sessionRun({ status: 'running' })];
      state.threadMessages = [message({ id: 'm1', createdAt: '2026-09-20T00:00:30.000Z', body: 'are you there?' })];
      render(<WorkerBody workerId="a1" />);
      const row = document.querySelector('[data-live-activity]');
      expect(row).not.toBeNull();
      expect(row?.textContent).toContain('Starting the turn');
    });

    it('shows a live session turn’s streamed text and tool calls, like the worker live view (VS-616)', () => {
      state.runs = [sessionRun({ status: 'running' })];
      state.threadMessages = [message({ id: 'm1', createdAt: '2026-09-20T00:00:30.000Z', body: 'are you there?' })];
      state.runPartials = { run9: [{ partId: 'p1', kind: 'text', text: 'Looking into the failing test.' }] };
      state.runEvents = { run9: [ev('tool.call', { name: 'bash', callId: 'c1', target: 'pnpm test' })] };
      render(<WorkerBody workerId="a1" />);
      expect(document.querySelector('[data-live-partials]')).toHaveTextContent('Looking into the failing test.');
      expect(screen.getByText('bash')).toBeInTheDocument();
      expect(document.querySelector('[data-live-activity]')).not.toBeNull();
      // VS-629: the conversation's one scroller is `data-v2-session-scroll`, and a turn never nests
      // a second `role="log"` scroller of its own.
      expect(document.querySelector('[role="log"]')).toBeNull();
      expect(document.querySelectorAll('[data-v2-session-scroll]')).toHaveLength(1);
    });

    it('renders each turn’s transcript between the human’s messages (VS-618)', () => {
      state.runs = [sessionRun({ status: 'succeeded', finishedAt: '2026-09-20T00:05:00.000Z' })];
      state.threadMessages = [
        message({ id: 'm1', createdAt: '2026-09-20T00:00:30.000Z', body: 'fix the failing test' }),
        message({ id: 'm2', createdAt: '2026-09-20T00:10:00.000Z', body: 'what did you find?' }),
      ];
      state.runEvents = {
        run9: [
          ev('assistant.text', { text: 'Looking at the failing test.' }),
          ev('tool.call', { name: 'Edit', callId: 'c1', input: { file_path: 'work/src/util.ts', old_string: 'const a = 1;', new_string: 'const a = 2;' } }),
          ev('tool.call', { name: 'Write', callId: 'c2', input: { file_path: 'work/README.md', content: '# Hello\n' } }),
          ev('command.executed', { command: 'pnpm test', exitCode: 0, stdout: 'all green' }),
        ],
      };
      render(<WorkerBody workerId="a1" />);
      // The turn's assistant text, an edit diff, a written-file preview and a command with output.
      expect(screen.getByText('Looking at the failing test.')).toBeInTheDocument();
      expect(screen.getByText('util.ts')).toBeInTheDocument();
      expect(screen.getByText('README.md')).toBeInTheDocument();
      expect(screen.getByText('pnpm test')).toBeInTheDocument();
      expect(screen.getByText('all green')).toBeInTheDocument();
      // The transcript sits between the two human messages.
      const items = Array.from(document.querySelectorAll('ol[aria-label] > li'));
      const turnIndex = items.findIndex((li) => li.querySelector('[data-session-turn]'));
      expect(turnIndex).toBeGreaterThan(0);
      expect(items[turnIndex - 1]).toHaveTextContent('fix the failing test');
      expect(items[turnIndex + 1]).toHaveTextContent('what did you find?');
    });

    it('links a ticket identifier in the turn transcript and leaves code literal (VS-623)', () => {
      state.runs = [sessionRun({ status: 'succeeded', finishedAt: '2026-09-20T00:05:00.000Z' })];
      state.threadMessages = [message({ id: 'm1', createdAt: '2026-09-20T00:00:30.000Z', body: 'what now?' })];
      state.runEvents = {
        run9: [ev('assistant.text', { text: 'I filed VS-623 for that; the literal is `VS-623`.' })],
      };
      render(<WorkerBody workerId="a1" />);
      const tags = screen.getAllByText('VS-623');
      const link = tags.find((t) => t.tagName === 'A');
      expect(link).toBeTruthy();
      expect(link!.getAttribute('href')).toBe('#ticket:VS-623');
      expect(tags.some((t) => t.tagName === 'CODE')).toBe(true);
      fireEvent.click(link!);
      expect(state.go).toHaveBeenCalledWith('/w/$ws/tickets/$ticketId', { params: { ws: 'ws1', ticketId: 'VS-623' } });
    });

    it('shows the final text once, from the transcript, not again as a message (VS-618)', () => {
      state.runs = [sessionRun({ status: 'succeeded', finishedAt: '2026-09-20T00:05:00.000Z' })];
      state.threadMessages = [
        message({ id: 'm1', createdAt: '2026-09-20T00:00:30.000Z', body: 'are you there?' }),
        message({ id: 'm2', direction: 'outbound', authorKind: 'agent', authorId: 'a1', runId: 'run9', body: 'Here is the answer.', createdAt: '2026-09-20T00:05:00.000Z' }),
      ];
      state.runEvents = { run9: [ev('assistant.text', { text: 'Here is the answer.' })] };
      render(<WorkerBody workerId="a1" />);
      expect(screen.getAllByText('Here is the answer.')).toHaveLength(1);
    });

    it('still shows a delivered answer a runtime did not put in the events (VS-618)', () => {
      state.runs = [sessionRun({ status: 'succeeded', finishedAt: '2026-09-20T00:05:00.000Z' })];
      state.threadMessages = [
        message({ id: 'm1', createdAt: '2026-09-20T00:00:30.000Z', body: 'are you there?' }),
        message({ id: 'm2', direction: 'outbound', authorKind: 'agent', authorId: 'a1', runId: 'run9', body: 'Only in the final text.', createdAt: '2026-09-20T00:05:00.000Z' }),
      ];
      state.runEvents = { run9: [ev('tool.call', { name: 'bash', callId: 'c1', target: 'ls' })] };
      render(<WorkerBody workerId="a1" />);
      expect(screen.getAllByText('Only in the final text.')).toHaveLength(1);
    });

    it('a turn that ended after a tool result shows no notice and no error (VS-618)', () => {
      state.runs = [sessionRun({ status: 'succeeded', finishedAt: '2026-09-20T00:05:00.000Z' })];
      state.threadMessages = [message({ id: 'm1', createdAt: '2026-09-20T00:00:30.000Z', body: 'run the tests' })];
      state.runEvents = {
        run9: [
          ev('tool.call', { name: 'bash', callId: 'c1', target: 'pnpm test' }),
          ev('tool.result', { name: 'bash', callId: 'c1', content: 'all green' }),
        ],
      };
      render(<WorkerBody workerId="a1" />);
      expect(screen.queryByText(/ended without an answer/i)).toBeNull();
      expect(screen.queryByRole('alert')).toBeNull();
      expect(screen.getByText('bash')).toBeInTheDocument();
    });

    it('says a non-streaming session runtime reports whole steps only (VS-616)', () => {
      state.runs = [sessionRun({ status: 'running', runtimeId: 'not-a-runtime' })];
      state.threadMessages = [message({ id: 'm1', createdAt: '2026-09-20T00:00:30.000Z' })];
      render(<WorkerBody workerId="a1" />);
      expect(document.querySelector('[data-live-activity]')).not.toBeNull();
      expect(document.querySelector('[data-live-whole-steps]')).not.toBeNull();
    });
  });

  // VS-656: a session retired at an upgrade keeps its turns visible, the boundary is marked, and the
  // turns come from the agent's own runs rather than a window shared with other agents.
  describe('a session across retired sessions (VS-656)', () => {
    beforeEach(() => {
      state.agent = agent({ id: 'a1', kind: 'session', ticketId: null, name: 'Backend Engineer — session', status: 'active', runtimeId: 'opencode' });
      state.noTicket = true;
      state.thread = { id: 'th1', agentId: 'a1' };
    });

    it('shows a retired session’s turns even when the shared workspace window would drop them', () => {
      state.threadMessages = [
        message({ id: 'h1', body: 'first question', createdAt: '2026-09-19T00:00:00.000Z' }),
        message({ id: 'h2', body: 'second question', createdAt: '2026-09-21T00:00:00.000Z' }),
      ];
      const retired = sessionRun({ id: 'old1', sessionId: 's1', status: 'succeeded', startedAt: '2026-09-19T00:00:10.000Z', createdAt: '2026-09-19T00:00:10.000Z', finishedAt: '2026-09-19T00:00:20.000Z' });
      const fresh = sessionRun({ id: 'new1', sessionId: 's2', status: 'succeeded', startedAt: '2026-09-21T00:00:10.000Z', createdAt: '2026-09-21T00:00:10.000Z', finishedAt: '2026-09-21T00:00:20.000Z' });
      state.runs = [retired, fresh];
      state.workspaceRuns = [fresh];
      state.sessions = [
        { id: 's1', status: 'stale', turnCount: 1, createdAt: '2026-09-19T00:00:00.000Z', updatedAt: '2026-09-21T00:00:00.000Z', retiredReason: 'tool_contract' },
        { id: 's2', status: 'active', turnCount: 1, createdAt: '2026-09-21T00:00:00.000Z', updatedAt: '2026-09-21T00:00:20.000Z', retiredReason: null },
      ];
      render(<WorkerBody workerId="a1" />);
      expect(document.querySelector('[data-session-turn="old1"]')).not.toBeNull();
      expect(document.querySelector('[data-session-turn="new1"]')).not.toBeNull();
      expect(document.querySelector('[data-v2-session-boundary]')?.textContent).toContain("the agent's tools changed at an upgrade");
    });

    it('draws no boundary for a single session', () => {
      state.threadMessages = [message({ id: 'h1', body: 'hi', createdAt: '2026-09-21T00:00:00.000Z' })];
      state.runs = [sessionRun({ id: 'new1', sessionId: 's2', status: 'succeeded', startedAt: '2026-09-21T00:00:10.000Z', createdAt: '2026-09-21T00:00:10.000Z' })];
      state.sessions = [{ id: 's2', status: 'active', turnCount: 1, createdAt: '2026-09-21T00:00:00.000Z', updatedAt: '2026-09-21T00:00:20.000Z', retiredReason: null }];
      render(<WorkerBody workerId="a1" />);
      expect(document.querySelector('[data-v2-session-boundary]')).toBeNull();
    });

    it('loads earlier history, growing the run window, when the reader scrolls back', () => {
      state.hasOlder = true;
      state.threadMessages = [message({ id: 'h1', body: 'newest', createdAt: '2026-09-21T00:00:00.000Z' })];
      state.runs = [sessionRun({ id: 'new1', sessionId: 's2', status: 'succeeded', startedAt: '2026-09-21T00:00:10.000Z', createdAt: '2026-09-21T00:00:10.000Z' })];
      render(<WorkerBody workerId="a1" />);

      const scroller = document.querySelector('[data-v2-session-scroll]') as HTMLElement;
      scroller.scrollTop = 0;
      fireEvent.scroll(scroller);

      expect(state.loadOlder).toHaveBeenCalled();
      // The run window grew with the conversation, so the older turns load alongside the messages.
      expect(state.sessionRunPages).toContain(2);
    });
  });

  // VS-629: the page fills the frame; the header and composer are pinned rows and only the
  // transcript region scrolls, so the document never scrolls the header away.
  describe('the page frame (VS-629)', () => {
    beforeEach(() => {
      state.agent = agent({ id: 'a1', kind: 'session', ticketId: null, name: 'Backend Engineer — session', status: 'active', runtimeId: 'claude-code' });
      state.noTicket = true;
      state.thread = { id: 'th1', agentId: 'a1' };
      state.role = { id: 'r1', name: 'Full-stack Engineer' };
      state.threadMessages = [message({ id: 'm1', body: 'hello' })];
    });

    it('bounds the page and pins the header above the one transcript scroller', () => {
      const { container } = render(<V2WorkerPage />);
      const pageBody = container.querySelector('[data-v2-page-body]') as HTMLElement;
      expect(pageBody).toHaveAttribute('data-v2-page-body', 'fill');
      expect(pageBody.className).toContain('overflow-hidden');
      expect(pageBody.className).not.toContain('overflow-y-auto');

      const root = container.querySelector('[data-v2-worker]') as HTMLElement;
      // The transcript region is the page's only scrolling region; the composer's own textarea
      // scrolls its text, which is a control, not a page scroller.
      const scrollers = [...root.querySelectorAll<HTMLElement>('.overflow-y-auto')].filter(
        (el) => el.tagName !== 'TEXTAREA' && el.tagName !== 'INPUT',
      );
      expect(scrollers).toHaveLength(1);
      const scroller = scrollers[0] as HTMLElement;
      expect(scroller).toHaveAttribute('data-v2-session-scroll');
      // The header is a pinned sibling of the scroller, not inside it, so it cannot scroll away.
      const header = root.firstElementChild as HTMLElement;
      expect(header.textContent).toContain('Backend Engineer — session');
      expect(scroller.contains(header)).toBe(false);
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
