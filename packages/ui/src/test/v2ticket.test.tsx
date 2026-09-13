/** The V2 ticket page: the header, the tabs and their data, the folded knowledge usage, the actions. */
import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Decision, Role, Ticket } from '@weave-ai/shared';
import type { UsageTotals } from '../api/types';
import { ToastProvider } from '../components/Toast';
import { agent, decision, project, ticket, workProduct } from './factories';

const state = vi.hoisted(() => ({
  ticket: undefined as Ticket | undefined,
  notFound: false,
  documents: [] as Array<{ key: string; revision: number; updatedAt: string }>,
  products: [] as unknown[],
  decisions: [] as Decision[],
  search: {} as Record<string, string | undefined>,
  patch: vi.fn() as unknown as ReturnType<typeof vi.fn>,
  retry: vi.fn() as unknown as ReturnType<typeof vi.fn>,
  cancel: vi.fn() as unknown as ReturnType<typeof vi.fn>,
  discard: vi.fn() as unknown as ReturnType<typeof vi.fn>,
  assign: vi.fn() as unknown as ReturnType<typeof vi.fn>,
  blockers: vi.fn() as unknown as ReturnType<typeof vi.fn>,
  answer: vi.fn() as unknown as ReturnType<typeof vi.fn>,
  cancelError: null as Error | null,
  discardError: null as Error | null,
  answerError: null as Error | null,
  go: vi.fn() as unknown as ReturnType<typeof vi.fn>,
}));

vi.mock('@tanstack/react-router', () => ({
  useParams: () => ({ ws: 'ws1', ticketId: 'ACME-42' }),
}));
vi.mock('../api/context', () => ({ useWs: () => 'ws1' }));
vi.mock('../app/link', () => ({
  A: ({ to, children, ...rest }: { to: string; children?: React.ReactNode }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
  useGo: () => state.go,
  useSearchParams: () => state.search,
}));
vi.mock('../api/runStream', () => ({ useRunEventStream: () => ({ events: [] }) }));

const usage: UsageTotals = { tokensIn: 10_000, tokensOut: 8_400, tokensCached: 0, runs: 2, workerTurns: 3, durationMs: 60_000, costCents: 41, costStatus: 'reported' };

vi.mock('../api/hooks', () => ({
  useTicket: () =>
    state.notFound
      ? { isLoading: false, isError: true, data: undefined }
      : {
          isLoading: false,
          isError: false,
          data: {
            ticket: state.ticket,
            project: project({ id: 'p1', slug: 'web', name: 'web' }),
            worker: agent({ id: 'a1', name: 'Backend Engineer #7' }),
            role: null,
            blockers: [],
            children: [],
            documents: state.documents,
            workProducts: state.products,
            openspecState: null,
            mergeQueue: { position: null, concurrency: 1 },
            usage,
          },
        },
  useTicketWorkProducts: () => ({ data: state.products, isLoading: false }),
  useTicketComments: () => ({ data: [], isLoading: false }),
  useTicketRuns: () => ({ data: [], isLoading: false }),
  useTicketDocument: () => state.notFound ? { data: undefined, isLoading: false, isError: true } : { data: { key: 'plan', revision: 1, body: '# The plan', createdAt: '' }, isLoading: false, isError: false },
  useTicketDocumentRevisions: () => ({ data: [] }),
  useTicketUsage: () => ({ data: { total: usage, turns: [] }, isLoading: false }),
  useTicketKnowledgeUsage: () => ({ data: { hubTokens: 120, documentTokens: 30, totalTokens: 150, documents: [{ scope: 'project', projectId: 'p1', slug: 'notes', tokens: 30 }] }, isLoading: false }),
  useDecisions: () => ({ data: state.decisions }),
  useRoles: () => ({ data: [{ id: 'r1', name: 'Engineer' } as Role] }),
  usePatchTicket: () => ({ mutate: state.patch, isPending: false }),
  useRetryTicket: () => ({ mutate: state.retry, isPending: false }),
  useCancelTicket: () => ({ mutate: state.cancel, isPending: false, isError: Boolean(state.cancelError), error: state.cancelError }),
  useDiscardTicket: () => ({ mutate: state.discard, isPending: false, isError: Boolean(state.discardError), error: state.discardError }),
  useAssignTicket: () => ({ mutate: state.assign, isPending: false }),
  useSetTicketBlockers: () => ({ mutate: state.blockers, isPending: false }),
  usePostComment: () => ({ mutate: vi.fn() }),
  useAnswerDecision: () => ({ mutate: state.answer, isPending: false, isError: Boolean(state.answerError), error: state.answerError }),
  useWorker: () => ({ data: undefined }),
  useWorkerMessage: () => ({ mutateAsync: vi.fn().mockResolvedValue({ delivery: 'queued' }) }),
  useHandoverCommandFor: () => ({ isLoading: false, data: null }),
  useStartHandoverFor: () => ({ mutate: vi.fn() }),
}));

const { V2TicketScreen } = await import('../v2/ticket/Ticket');

function renderScreen(): ReturnType<typeof render> {
  return render(
    <ToastProvider>
      <V2TicketScreen />
    </ToastProvider>,
  );
}

function artifactTicket(): Ticket {
  return ticket({ id: 'tk_42', identifier: 'ACME-42', title: 'Dark mode for the dashboard', status: 'in_progress' });
}

beforeEach(() => {
  state.ticket = artifactTicket();
  state.notFound = false;
  state.search = {};
  state.decisions = [];
  state.products = [workProduct({ id: 'wp1', type: 'artifact', externalId: 'overview', title: 'Overview', url: '/api/w/ws1/tickets/tk_42/artifacts/overview/raw' })];
  state.documents = [{ key: 'artifact:overview', revision: 1, updatedAt: '2026-09-01T00:00:00.000Z' }];
  state.patch = vi.fn();
  state.retry = vi.fn();
  state.cancel = vi.fn();
  state.discard = vi.fn();
  state.assign = vi.fn();
  state.blockers = vi.fn();
  state.answer = vi.fn();
  state.cancelError = null;
  state.discardError = null;
  state.answerError = null;
  state.go = vi.fn();
});

describe('V2 ticket header', () => {
  it('names the ticket and its context', () => {
    renderScreen();
    const header = document.querySelector('[data-v2-ticket-header]') as HTMLElement;
    expect(within(header).getByText('ACME-42')).toBeInTheDocument();
    expect(within(header).getByText('change')).toBeInTheDocument();
    expect(within(header).getByText('Dark mode for the dashboard')).toBeInTheDocument();
    expect(within(header).getByText('web')).toBeInTheDocument();
    expect(within(header).getByText('Backend Engineer #7')).toBeInTheDocument();
    expect(within(header).getByText(/18.4k tok/)).toBeInTheDocument();
  });

  it('states the ticket was not found for an unknown id', () => {
    state.notFound = true;
    renderScreen();
    expect(screen.getByText(/No ticket ACME-42/)).toBeInTheDocument();
  });
});

describe('V2 ticket tabs', () => {
  it('shows only Overview, Plan and (with an artifact) Artifacts', () => {
    renderScreen();
    for (const name of ['Artifacts', 'Overview', 'Plan']) {
      expect(screen.getByRole('tab', { name })).toBeInTheDocument();
    }
    for (const gone of ['Activity', 'Work', 'Usage', 'Knowledge']) {
      expect(screen.queryByRole('tab', { name: gone })).toBeNull();
    }
  });

  it('defaults to Artifacts when the ticket has one and renders it inline with the sandbox note', () => {
    renderScreen();
    expect(screen.getByRole('tab', { name: 'Artifacts' })).toHaveAttribute('aria-selected', 'true');
    const frame = document.querySelector('iframe') as HTMLIFrameElement;
    expect(frame).toBeTruthy();
    expect(frame.getAttribute('sandbox')).toContain('allow-scripts');
    expect(screen.getByText(/sandboxed frame/)).toBeInTheDocument();
  });

  it('defaults to Overview when the ticket has no artifact', () => {
    state.products = [];
    state.documents = [];
    renderScreen();
    expect(screen.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true');
  });

  it('maps an old tab value to Overview', () => {
    state.search = { tab: 'usage' };
    renderScreen();
    expect(screen.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true');
    expect(document.querySelector('[data-v2-overview-page]')).toBeTruthy();
  });

  it('lays out Overview in captain’s order, with the panes stacking and the Activity pane scrolling', () => {
    renderScreen();
    fireEvent.click(screen.getByRole('tab', { name: 'Overview' }));
    const page = document.querySelector('[data-v2-overview-page]') as HTMLElement;
    expect(page).toBeTruthy();
    const order = [...page.querySelectorAll('[data-v2-overview-pane],[data-v2-activity-pane],[data-v2-section]')].map((el) => {
      const d = (el as HTMLElement).dataset;
      if (d['v2OverviewPane'] !== undefined) return 'overview';
      if (d['v2ActivityPane'] !== undefined) return 'activity';
      return d['v2Section']!;
    });
    expect(order).toEqual(['overview', 'activity', 'work', 'usage', 'knowledge']);

    const grid = page.firstElementChild as HTMLElement;
    expect(grid.className).toContain('grid-cols-1');
    expect(grid.className).toContain('lg:grid-cols-2');
    expect((document.querySelector('[data-v2-activity-pane]') as HTMLElement).className).toContain('overflow-y-auto');
  });

  it('renders the Activity feed, Work, Usage and Knowledge sections on Overview', () => {
    renderScreen();
    fireEvent.click(screen.getByRole('tab', { name: 'Overview' }));
    expect(screen.getByText('Nothing has happened yet.')).toBeInTheDocument();
    const work = document.querySelector('[data-v2-section="work"]') as HTMLElement;
    expect(within(work).getByText('Work products')).toBeInTheDocument();
    expect(within(work).getByText('Worktree')).toBeInTheDocument();
    const knowledge = document.querySelector('[data-v2-section="knowledge"]') as HTMLElement;
    expect(within(knowledge).getByText('150')).toBeInTheDocument();
    expect(within(knowledge).getByText('notes')).toBeInTheDocument();
  });

  it('shows the ticket facts in the overview pane', () => {
    state.ticket = ticket({ id: 'tk_42', identifier: 'ACME-42', title: 'Dark mode for the dashboard', status: 'in_progress', description: 'Add a dark theme.' });
    renderScreen();
    fireEvent.click(screen.getByRole('tab', { name: 'Overview' }));
    const pane = document.querySelector('[data-v2-overview-pane]') as HTMLElement;
    expect(within(pane).getByText('Add a dark theme.')).toBeInTheDocument();
    expect(within(pane).getByText('Delivery')).toBeInTheDocument();
  });

  it('opens on a named tab from the URL', () => {
    state.search = { tab: 'plan' };
    renderScreen();
    expect(screen.getByRole('tab', { name: 'Plan' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('The plan')).toBeInTheDocument();
  });
});

describe('V2 ticket actions', () => {
  it('toggles auto-merge through the patch endpoint', () => {
    renderScreen();
    fireEvent.click(screen.getByRole('switch', { name: 'Auto-merge' }));
    expect(state.patch).toHaveBeenCalledWith({ id: 'tk_42', patch: { autoMerge: true } });
  });

  it('retries a blocked ticket', () => {
    state.ticket = ticket({ id: 'tk_42', identifier: 'ACME-42', status: 'blocked' });
    renderScreen();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(state.retry).toHaveBeenCalledWith({ id: 'tk_42' });
  });

  it('cancels the ticket through the existing endpoint after a confirmation', () => {
    renderScreen();
    fireEvent.click(screen.getByRole('button', { name: 'Actions' }));
    fireEvent.change(screen.getByLabelText('Cancel reason'), { target: { value: 'not wanted' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel ticket' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm cancel' }));
    expect(state.cancel).toHaveBeenCalledWith({ id: 'tk_42', reason: 'not wanted' });
  });

  it('discards the ticket work through the existing endpoint after a confirmation', () => {
    renderScreen();
    fireEvent.click(screen.getByRole('button', { name: 'Actions' }));
    fireEvent.click(screen.getByRole('button', { name: 'Discard work' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm discard' }));
    expect(state.discard).toHaveBeenCalledWith({ id: 'tk_42' }, expect.anything());
  });

  it('reaches reassign and blockers', () => {
    renderScreen();
    fireEvent.click(screen.getByRole('button', { name: 'Actions' }));
    fireEvent.change(screen.getByLabelText('Reassign role'), { target: { value: 'r1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Assign' }));
    expect(state.assign).toHaveBeenCalledWith({ id: 'tk_42', roleId: 'r1' });
    expect(screen.getByText(/Clear blockers/)).toBeInTheDocument();
  });
});

describe('V2 ticket held decisions and action errors', () => {
  const held = () =>
    decision({
      id: 'd_plan',
      ticketId: 'tk_42',
      kind: 'plan_approval',
      status: 'open',
      owner: 'human',
      weaverReviewStatus: 'concerns',
      weaverReviewNote: 'needs a rollback step',
    });

  it('disables Approve on a held plan and offers the reason-required override', () => {
    state.decisions = [held()];
    renderScreen();
    fireEvent.click(screen.getByRole('tab', { name: 'Plan' }));
    expect(screen.getByRole('button', { name: /Approve/ })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Override & approve…' }));
    fireEvent.change(screen.getByPlaceholderText('Why override the hold?'), { target: { value: 'shipping anyway' } });
    fireEvent.click(screen.getByRole('button', { name: 'Override & approve' }));
    expect(state.answer).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'd_plan', key: 'approve', overrideHold: true, overrideReason: 'shipping anyway' }),
    );
  });

  it('shows a plan answer error on the page', () => {
    state.decisions = [held()];
    state.answerError = new Error('revision_pending: the weaver has concerns');
    renderScreen();
    fireEvent.click(screen.getByRole('tab', { name: 'Plan' }));
    const err = document.querySelector('[data-v2-answer-error]') as HTMLElement;
    expect(err).toBeTruthy();
    expect(err.textContent).toContain('revision_pending');
  });

  it('will not confirm a cancel without a reason and surfaces a cancel error', () => {
    state.cancelError = new Error('validation: reason required');
    renderScreen();
    fireEvent.click(screen.getByRole('button', { name: 'Actions' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel ticket' }));
    expect(screen.getByRole('button', { name: 'Confirm cancel' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Cancel reason'), { target: { value: 'not wanted' } });
    expect(screen.getByRole('button', { name: 'Confirm cancel' })).not.toBeDisabled();
    const err = document.querySelector('[data-v2-cancel-error]') as HTMLElement;
    expect(err.textContent).toContain('reason required');
  });

  it('reports when a discard approval was raised instead of discarding', () => {
    state.discard = vi.fn((_v: unknown, opts?: { onSuccess?: (r: { discarded: boolean; decisionId: string }) => void }) =>
      opts?.onSuccess?.({ discarded: false, decisionId: 'd_discard' }),
    );
    renderScreen();
    fireEvent.click(screen.getByRole('button', { name: 'Actions' }));
    fireEvent.click(screen.getByRole('button', { name: 'Discard work' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm discard' }));
    const notice = document.querySelector('[data-v2-discard-notice]') as HTMLElement;
    expect(notice.textContent).toMatch(/discard approval/i);
  });
});
