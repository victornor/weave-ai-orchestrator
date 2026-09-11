import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Decision } from '@agent-conductor/shared';
import { decision } from './factories';
import { clearHiddenCache, decisionFingerprint, readHidden, writeHidden } from '../lib/hiddenDecisions';

const state = vi.hoisted(() => ({
  planDoc: null as { key: string; revision: number; body: string; createdAt: string } | null,
  decisions: [] as Decision[],
  conductorOwned: [] as Decision[],
  queries: [] as Array<Record<string, unknown>>,
  answer: vi.fn() as unknown as ReturnType<typeof vi.fn>,
  toasts: [] as Array<Record<string, unknown>>,
  tickets: [] as Array<Record<string, unknown>>,
  projects: [] as Array<Record<string, unknown>>,
  config: {} as Record<string, unknown>,
  connection: 'connected' as string,
  go: vi.fn() as unknown as ReturnType<typeof vi.fn>,
}));

vi.mock('../api/context', () => ({
  useWs: () => 'ws1',
  useHookWs: (o?: string) => o ?? 'ws1',
  useConnection: () => ({ state: state.connection, capturedAt: null, lastSeq: 0, attempts: 0 }),
}));

vi.mock('../api/hooks', () => ({
  useDecisions: (p: { owner?: string }) => {
    state.queries.push(p);
    return { data: p.owner === 'conductor' ? state.conductorOwned : state.decisions, isLoading: false, isError: false, refetch: vi.fn() };
  },
  useAnswerDecision: () => ({ mutate: state.answer, isPending: false }),
  useTickets: () => ({ data: state.tickets }),
  useWorkers: () => ({ data: [] }),
  useProjects: () => ({ data: state.projects }),
  useWorkspaceSummary: () => ({ data: { config: state.config } }),
  useTicketDocument: () => ({ data: state.planDoc ?? undefined, isLoading: false, isError: state.planDoc === null }),
}));

vi.mock('../app/link', () => ({ useGo: () => state.go, A: ({ children }: { children?: React.ReactNode }) => <a href="#">{children}</a> }));
const enqueueMock = vi.hoisted(() => vi.fn());
vi.mock('../lib/queue', () => ({ enqueue: enqueueMock, useQueue: () => [] }));
vi.mock('../components/Toast', () => ({
  useToast: () => ({ push: (t: Record<string, unknown>) => { state.toasts.push(t); return 't1'; }, dismiss: vi.fn() }),
}));

const { NeedsYouRoute } = await import('../routes/NeedsYou');

const asked = (over: Partial<Decision> = {}): Decision =>
  decision({
    id: 'd1', kind: 'question', ticketId: null, askedInRunId: 'run_1', title: 'File this as a ticket?',
    context: 'It is a one-line fix.', recommendation: null, target: null,
    options: [
      { key: 'file', label: 'File it', description: 'A ticket, routed to the engineer.' },
      { key: 'skip', label: 'Leave it', description: 'Nothing is filed.' },
    ],
    ...over,
  });

beforeEach(() => {
  state.planDoc = null;
  state.decisions = [];
  state.conductorOwned = [];
  state.queries = [];
  state.answer = vi.fn();
  state.toasts = [];
  state.tickets = [];
  state.projects = [];
  state.config = {};
  state.connection = 'connected';
  state.go = vi.fn();
  enqueueMock.mockClear();
  localStorage.clear();
  clearHiddenCache();
});

describe('NeedsYouRoute', () => {
  it('lists the open human-owned decisions only', () => {
    render(<NeedsYouRoute />);
    expect(state.queries).toContainEqual({ status: 'open', owner: 'human' });
  });

  it('shows a conductor question with the same options as the chat', () => {
    state.decisions = [asked()];
    render(<NeedsYouRoute />);
    expect(screen.getByText('File this as a ticket?')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /File it/ })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Leave it/ })).toBeInTheDocument();
    expect(screen.getByText('Write your own…')).toBeInTheDocument();
    expect(screen.getByText('1 waiting')).toBeInTheDocument();
  });

  it('shows the conductor-review line on an unseen plan card (VS-223)', () => {
    state.decisions = [decision({ kind: 'plan_approval', title: 'Approve the plan for ACME-42' })];
    render(<NeedsYouRoute />);
    expect(screen.getByText("Conductor hasn't looked yet")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Approve/ })).toBeInTheDocument();
  });

  it('answers with the option that was selected and sent', () => {
    state.decisions = [asked()];
    render(<NeedsYouRoute />);
    fireEvent.click(screen.getByRole('radio', { name: /Leave it/ }));
    expect(state.answer).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Send answer' }));
    expect(state.answer).toHaveBeenCalledWith({ id: 'd1', key: 'skip' }, expect.anything());
  });

  it('reports an answer the daemon refused', () => {
    state.decisions = [asked()];
    state.answer = vi.fn((_vars: unknown, opts: { onError: (e: Error) => void }) => opts.onError(new Error('decision d1 is answered')));
    render(<NeedsYouRoute />);
    fireEvent.click(screen.getByRole('radio', { name: /File it/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Send answer' }));
    expect(state.toasts).toEqual([{ title: 'Could not record that answer', detail: 'decision d1 is answered', status: 'failed' }]);
  });

  it('says a stale card was superseded and offers a way to the replacement, instead of a raw error', async () => {
    const { ApiError } = await import('../api/client');
    state.decisions = [asked({ ticketId: 'tk_1' })];
    state.answer = vi.fn((_vars: unknown, opts: { onError: (e: Error) => void }) =>
      opts.onError(new ApiError(409, { code: 'wrong_status', message: 'decision d1 is superseded', details: { status: 'superseded', supersededBy: 'd2' } })));

    render(<NeedsYouRoute />);
    fireEvent.click(screen.getByRole('radio', { name: /File it/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Send answer' }));

    expect(state.toasts).toHaveLength(1);
    expect(state.toasts[0]).toMatchObject({ title: 'This changed while you were looking at it', status: 'failed' });
    expect(state.go).not.toHaveBeenCalled();
    (state.toasts[0]!.action as { run: () => void }).run();
    expect(state.go).toHaveBeenCalledWith('/w/$ws/tickets/$ticketId', { params: { ws: 'ws1', ticketId: 'tk_1' } });
  });

  it('never treats a stale answer as reaching the decision that replaced it', async () => {
    const { ApiError } = await import('../api/client');
    state.decisions = [asked({ ticketId: 'tk_1' })];
    state.answer = vi.fn((_vars: unknown, opts: { onError: (e: Error) => void }) =>
      opts.onError(new ApiError(409, { code: 'wrong_status', message: 'decision d1 is superseded', details: { status: 'superseded', supersededBy: 'd2' } })));

    render(<NeedsYouRoute />);
    fireEvent.click(screen.getByRole('radio', { name: /File it/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Send answer' }));

    expect(state.answer).toHaveBeenCalledTimes(1);
    expect(state.answer).toHaveBeenCalledWith({ id: 'd1', key: 'file' }, expect.anything());
  });

  it('puts the plan one tap from the approval, and says so when there is none', () => {
    state.planDoc = { key: 'plan', revision: 1, body: '# Plan for dark-mode\n\nSemantic tokens first.', createdAt: '' };
    state.decisions = [decision()];
    const { unmount } = render(<NeedsYouRoute />);
    fireEvent.click(screen.getByRole('button', { name: /Read the plan/ }));
    expect(screen.getByText('Semantic tokens first.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Approve/ })).toBeInTheDocument();
    unmount();

    state.planDoc = null;
    render(<NeedsYouRoute />);
    expect(screen.getByText('No plan document on this ticket — the proposal is missing or empty.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Approve/ })).toBeInTheDocument();
  });

  it('stops listing a decision that was answered elsewhere', () => {
    render(<NeedsYouRoute />);
    expect(screen.queryByText('File this as a ticket?')).not.toBeInTheDocument();
    expect(screen.getByText('Nothing needs you right now.')).toBeInTheDocument();
  });
});

describe('NeedsYou — decisions hidden from the chat', () => {
  /** What the chat writes when the human hides a card: the decision as it read at the time. */
  const hideInChat = (d: Decision): void => writeHidden('ws1', { [d.id]: { fingerprint: decisionFingerprint(d), at: '2026-09-01T09:00:00.000Z' } });

  it('still lists a hidden decision, and marks it as hidden from the chat', () => {
    const d = asked();
    hideInChat(d);
    state.decisions = [d];
    render(<NeedsYouRoute />);

    expect(screen.getByText('File this as a ticket?')).toBeInTheDocument();
    expect(screen.getByText('1 waiting')).toBeInTheDocument();
    expect(screen.getByText('Hidden from chat')).toBeInTheDocument();
  });

  it('shows it in the chat again, and leaves the decision itself alone', () => {
    const d = asked();
    hideInChat(d);
    state.decisions = [d];
    render(<NeedsYouRoute />);

    fireEvent.click(screen.getByRole('button', { name: 'Show in chat again' }));
    expect(screen.queryByText('Hidden from chat')).toBeNull();
    expect(readHidden('ws1')).toEqual({});
    expect(state.answer).not.toHaveBeenCalled();
  });

  it('answers a hidden decision exactly as it answers a pinned one', () => {
    const d = asked();
    hideInChat(d);
    state.decisions = [d];
    render(<NeedsYouRoute />);

    fireEvent.click(screen.getByRole('radio', { name: /Leave it/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Send answer' }));
    expect(state.answer).toHaveBeenCalledWith({ id: 'd1', key: 'skip' }, expect.anything());
  });

  it('marks nothing when the decision has been edited since it was hidden', () => {
    hideInChat(asked());
    state.decisions = [asked({ context: 'Actually it touches three files.' })];
    render(<NeedsYouRoute />);
    expect(screen.queryByText('Hidden from chat')).toBeNull();
  });
});

describe('NeedsYou — YOLO mode', () => {
  /** A decision on a ticket in a project, so the mode can be resolved for it. */
  const onTicket = (over: Partial<Decision>): Decision => {
    state.tickets = [{ id: 't1', identifier: 'ACME-42', projectId: 'p1' }];
    state.projects = [{ id: 'p1', slug: 'api', policies: {} }];
    return decision({ id: 'd1', ticketId: 't1', ...over } as Partial<Decision>);
  };

  it('offers no approve action for a merge approval the daemon will grant', () => {
    state.config = { defaults: { yolo: true } };
    state.decisions = [onTicket({ kind: 'merge_approval', title: 'Approve the merge for ACME-42' })];
    render(<NeedsYouRoute />);

    expect(screen.getByLabelText('Auto-approved by YOLO mode')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /approve merge/i })).toBeNull();
  });

  it('offers no approve action for a plan approval either', () => {
    state.config = { defaults: { yolo: true } };
    state.decisions = [onTicket({ kind: 'plan_approval', title: 'Approve the plan for ACME-42' })];
    render(<NeedsYouRoute />);

    expect(screen.getByLabelText('Auto-approved by YOLO mode')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^approve$/i })).toBeNull();
  });

  it('leaves a kind the mode does not cover exactly as it is', () => {
    state.config = { defaults: { yolo: true } };
    state.decisions = [onTicket({ kind: 'hire_approval', title: 'Hire a Backend Engineer?' })];
    render(<NeedsYouRoute />);

    expect(screen.queryByLabelText('Auto-approved by YOLO mode')).toBeNull();
    expect(screen.getByRole('button', { name: /hire/i })).toBeInTheDocument();
  });

  it('leaves an action_approval for the human even when YOLO is on', () => {
    state.config = { defaults: { yolo: true } };
    state.decisions = [onTicket({ kind: 'action_approval', title: 'Approve the action for ACME-42' })];
    render(<NeedsYouRoute />);

    expect(screen.queryByLabelText('Auto-approved by YOLO mode')).toBeNull();
    expect(screen.getByRole('button', { name: /^approve/i })).toBeInTheDocument();
  });

  it('keeps the approve action when the ticket\'s project has opted out', () => {
    state.config = { defaults: { yolo: true } };
    const d = onTicket({ kind: 'merge_approval', title: 'Approve the merge for ACME-42' });
    state.projects = [{ id: 'p1', slug: 'api', policies: { yolo: false } }];
    state.decisions = [d];
    render(<NeedsYouRoute />);

    expect(screen.queryByLabelText('Auto-approved by YOLO mode')).toBeNull();
    expect(screen.getByRole('button', { name: /approve merge/i })).toBeInTheDocument();
  });

  it('keeps the approve action while the mode is off', () => {
    state.decisions = [onTicket({ kind: 'merge_approval', title: 'Approve the merge for ACME-42' })];
    render(<NeedsYouRoute />);

    expect(screen.queryByLabelText('Auto-approved by YOLO mode')).toBeNull();
    expect(screen.getByRole('button', { name: /approve merge/i })).toBeInTheDocument();
  });
  // ---------- VS-92 ----------

  it('names the project a decision belongs to, and calls a workspace decision the workspace', () => {
    state.projects = [{ id: 'pr_1', slug: 'api' }, { id: 'pr_2', slug: 'web' }];
    state.decisions = [asked({ id: 'd1', projectId: 'pr_2' })];
    const { unmount } = render(<NeedsYouRoute />);
    expect(screen.getByText(/web/)).toBeInTheDocument();
    unmount();

    state.decisions = [asked({ id: 'd1', projectId: null, ticketId: null })];
    render(<NeedsYouRoute />);
    expect(screen.getByText(/Workspace/)).toBeInTheDocument();
  });

  it('falls back to the project of the ticket the decision concerns', () => {
    state.projects = [{ id: 'pr_1', slug: 'api' }];
    state.tickets = [{ id: 'tk_9', identifier: 'ACME-9', projectId: 'pr_1' }];
    state.decisions = [asked({ id: 'd1', projectId: null, ticketId: 'tk_9' })];
    render(<NeedsYouRoute />);
    expect(screen.getByText(/ACME-9 · api/)).toBeInTheDocument();
  });

  it('sends the collected values with the answer', () => {
    state.decisions = [asked({
      options: [],
      inputs: [
        { key: 'base_url', label: 'Base URL', type: 'text', required: true },
        { key: 'notes', label: 'Anything else', type: 'multiline' },
        { key: 'regions', label: 'Regions', type: 'multiselect', choices: [{ key: 'eu', label: 'EU' }, { key: 'us', label: 'US' }] },
      ],
    })];
    render(<NeedsYouRoute />);

    // Nothing to send until the required input is filled.
    const send = screen.getByRole('button', { name: /send answer/i });
    expect(send).toBeDisabled();
    expect(screen.getByText('Base URL is needed before this can be sent.')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/Base URL/), { target: { value: 'https://example.test' } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'US' }));
    fireEvent.click(send);

    // The empty optional input is absent rather than present and empty.
    expect(state.answer).toHaveBeenCalledWith(
      { id: 'd1', inputs: { base_url: 'https://example.test', regions: ['us'] } },
      expect.anything(),
    );
  });

  it('masks a secret input and never sends the card to the offline queue', () => {
    state.connection = 'offline';
    state.decisions = [asked({
      options: [],
      inputs: [{ key: 'token', label: 'Read-only token', type: 'secret', required: true, secretName: 'CF_READONLY_TOKEN' }],
    })];
    render(<NeedsYouRoute />);

    const field = screen.getByLabelText(/Read-only token/);
    expect(field).toHaveAttribute('type', 'password');
    fireEvent.change(field, { target: { value: 'cf-not-a-real-token-0000000000' } });
    fireEvent.click(screen.getByRole('button', { name: /send answer/i }));

    // Never in localStorage, and the human is told it did not go.
    expect(enqueueMock).not.toHaveBeenCalled();
    expect(state.answer).not.toHaveBeenCalled();
    expect(state.toasts.at(-1)).toMatchObject({ title: 'Not sent', status: 'failed' });
    expect(JSON.stringify(localStorage)).not.toContain('cf-not-a-real-token');
  });

  it('still queues an ordinary answer while offline', () => {
    state.connection = 'offline';
    state.decisions = [asked()];
    render(<NeedsYouRoute />);
    fireEvent.click(screen.getByRole('radio', { name: /Leave it/ }));
    fireEvent.click(screen.getByRole('button', { name: /send answer/i }));
    expect(enqueueMock).toHaveBeenCalledTimes(1);
  });

  it('does not compact the card or show a conductor-filed tag (VS-146)', () => {
    state.tickets = [{ id: 'tk_1', identifier: 'VS-145', createdByKind: 'agent', summary: 'Filed after a false alarm.' }];
    state.decisions = [decision({ ticketId: 'tk_1' })];
    render(<NeedsYouRoute />);
    expect(screen.queryByText('Filed by conductor')).not.toBeInTheDocument();
    expect(screen.queryByText('Filed after a false alarm.')).not.toBeInTheDocument();
    const body = screen.getByRole('article').querySelector(':scope > div:last-of-type');
    expect(body).toHaveClass('p-3.5');
    expect(screen.getByRole('button', { name: /Approve/ })).toHaveClass('px-4');
    expect(screen.getByRole('button', { name: /Approve/ })).not.toHaveClass('px-3');
  });
});
