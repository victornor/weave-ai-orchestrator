import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Decision } from '@agent-conductor/shared';
import { decision } from './factories';

const state = vi.hoisted(() => ({
  planDoc: null as { key: string; revision: number; body: string; createdAt: string } | null,
  decisions: [] as Decision[],
  conductorOwned: [] as Decision[],
  queries: [] as Array<Record<string, unknown>>,
  answer: vi.fn() as unknown as ReturnType<typeof vi.fn>,
  toasts: [] as Array<Record<string, unknown>>,
}));

vi.mock('../api/context', () => ({
  useWs: () => 'ws1',
  useConnection: () => ({ state: 'connected', capturedAt: null, lastSeq: 0, attempts: 0 }),
}));

vi.mock('../api/hooks', () => ({
  useDecisions: (p: { owner?: string }) => {
    state.queries.push(p);
    return { data: p.owner === 'conductor' ? state.conductorOwned : state.decisions, isLoading: false, isError: false, refetch: vi.fn() };
  },
  useAnswerDecision: () => ({ mutate: state.answer, isPending: false }),
  useTickets: () => ({ data: [] }),
  useWorkers: () => ({ data: [] }),
  useTicketDocument: () => ({ data: state.planDoc ?? undefined, isLoading: false, isError: state.planDoc === null }),
}));

vi.mock('../app/link', () => ({ useGo: () => vi.fn() }));
vi.mock('../lib/queue', () => ({ enqueue: vi.fn(), useQueue: () => [] }));
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
