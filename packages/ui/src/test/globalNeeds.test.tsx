/** VS-168: daemon-wide Needs you page. */
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Decision } from '@agent-conductor/shared';
import { decision } from './factories';
import { clearHiddenCache, writeHidden, decisionFingerprint } from '../lib/hiddenDecisions';

const state = vi.hoisted(() => ({
  workspaces: [] as Array<{ id: string; name: string }>,
  workspacesError: false,
  decisions: {} as Record<string, Decision[] | undefined>,
  errors: {} as Record<string, boolean>,
  answer: vi.fn() as unknown as ReturnType<typeof vi.fn>,
}));

vi.mock('../api/hooks', () => ({
  useWorkspaces: () => ({ data: state.workspacesError ? undefined : state.workspaces, isError: state.workspacesError, refetch: vi.fn() }),
  useDecisionsMany: (ids: string[]) => ids.map((id) => ({ data: state.decisions[id], isError: Boolean(state.errors[id]), refetch: vi.fn() })),
  useAnswerDecision: () => ({ mutate: state.answer, isPending: false }),
  useTickets: () => ({ data: [] }),
  useProjects: () => ({ data: [] }),
  useWorkspaceSummary: () => ({ data: { config: {} } }),
  useTicketDocument: () => ({ data: undefined, isLoading: false, isError: true }),
  // VS-249: not exercised here — the decision card's handover band only fetches once opened.
  useHandoverCommandFor: () => ({ data: undefined, isLoading: false, isError: false }),
  useStartHandoverFor: () => ({ mutate: vi.fn() }),
}));

vi.mock('../app/link', () => ({ useGo: () => vi.fn(), A: ({ children }: { children?: React.ReactNode }) => <a href="#">{children}</a> }));
vi.mock('../lib/queue', () => ({ enqueue: vi.fn(), useQueue: () => [] }));
vi.mock('../components/Toast', () => ({ useToast: () => ({ push: vi.fn(), dismiss: vi.fn() }) }));
vi.mock('../api/context', () => ({
  useWs: () => 'ws1',
  useHookWs: (o?: string) => o ?? 'ws1',
  useConnection: () => ({ state: 'connected', capturedAt: null, lastSeq: 0, attempts: 0 }),
}));

const { GlobalNeedsRoute } = await import('../routes/GlobalNeeds');

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
  state.workspaces = [
    { id: 'alpha', name: 'Alpha' },
    { id: 'beta', name: 'Beta' },
  ];
  state.workspacesError = false;
  state.decisions = { alpha: [], beta: [] };
  state.errors = {};
  state.answer = vi.fn();
  localStorage.clear();
  clearHiddenCache();
});

describe('GlobalNeedsRoute', () => {
  it('shows cards from two workspaces under headings', () => {
    state.decisions = {
      alpha: [asked({ id: 'da', title: 'Alpha question' })],
      beta: [asked({ id: 'db', title: 'Beta question' })],
    };
    render(<GlobalNeedsRoute />);
    expect(screen.getByRole('heading', { name: 'Alpha' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Beta' })).toBeInTheDocument();
    expect(screen.getByText('Alpha question')).toBeInTheDocument();
    expect(screen.getByText('Beta question')).toBeInTheDocument();
  });

  it('posts an answer to that workspace only', () => {
    state.decisions = { alpha: [asked({ id: 'da', title: 'Alpha question' })], beta: [] };
    render(<GlobalNeedsRoute />);
    fireEvent.click(screen.getByRole('radio', { name: /File it/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Send answer' }));
    expect(state.answer).toHaveBeenCalledWith(expect.objectContaining({ id: 'da', ws: 'alpha', key: 'file' }), expect.anything());
  });

  it('stays silent when one workspace is idle', () => {
    state.decisions = { alpha: [asked({ id: 'da', title: 'Alpha question' })], beta: [] };
    render(<GlobalNeedsRoute />);
    expect(screen.getByText('Alpha question')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Beta' })).not.toBeInTheDocument();
  });

  it('keeps the other workspace when one fails', () => {
    state.decisions = { alpha: [asked({ id: 'da', title: 'Alpha question' })], beta: undefined };
    state.errors = { beta: true };
    render(<GlobalNeedsRoute />);
    expect(screen.getByText('Alpha question')).toBeInTheDocument();
    expect(screen.getByText(/Could not load what needs you in Beta/)).toBeInTheDocument();
  });

  it('shows empty when nothing is waiting', () => {
    render(<GlobalNeedsRoute />);
    expect(screen.getByText('Nothing needs you right now.')).toBeInTheDocument();
  });

  it('still shows a decision hidden from chat', () => {
    const d = asked({ id: 'da', title: 'Hidden one' });
    writeHidden('alpha', { [d.id]: { fingerprint: decisionFingerprint(d), at: new Date().toISOString() } });
    state.decisions = { alpha: [d], beta: [] };
    render(<GlobalNeedsRoute />);
    expect(screen.getByText('Hidden one')).toBeInTheDocument();
    expect(screen.getByText('Hidden from chat')).toBeInTheDocument();
  });
});
