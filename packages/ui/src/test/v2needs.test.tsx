/**
 * VS-345: the global V2 Needs you screen — decisions from every workspace, scope-leading and
 * kind chips that filter for real, and a count that is the same filtered array the list renders.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type { Decision } from '@weave-ai/shared';
import { decision as makeDecision } from './factories';

const state = vi.hoisted(() => ({
  path: '/needs',
  decisions: [] as Decision[],
  workers: {} as Record<string, Array<{ id: string; name: string }>>,
}));

vi.mock('@tanstack/react-router', () => ({
  Outlet: () => null,
  useRouterState: () => state.path,
  useParams: () => ({}),
}));
vi.mock('../app/link', () => ({
  A: ({ to, children, ...rest }: { to: string; children?: ReactNode }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
  useGo: () => () => undefined,
}));
vi.mock('../api/hooks', () => ({
  useWorkspaces: () => ({
    data: [
      { id: 'ws1', internalId: 'ulid-ws1', name: 'Acme', ticketPrefix: 'ACME', root: '', projects: [], needsYou: 1 },
      { id: 'ws2', internalId: 'ulid-ws2', name: 'Fernwood', ticketPrefix: 'VS', root: '', projects: [], needsYou: 1 },
    ],
    isError: false,
    refetch: vi.fn(),
  }),
  useWorkspaceProjects: () => ({}),
  useWorkers: () => ({ data: [] }),
  useWorkersMany: (ids: readonly string[]) => ids.map((id) => ({ data: state.workers[id] ?? [] })),
  useIncidents: () => ({ data: { items: [], total: 0 } }),
  useDecisionsMany: (ids: readonly string[]) =>
    ids.map((id) => ({ data: state.decisions.filter((d) => d.workspaceId === id || d.workspaceId === `ulid-${id}`), isError: false, refetch: vi.fn() })),
  useTicketsMany: (ids: readonly string[]) => ids.map(() => ({ data: [] })),
  useAnswerDecision: () => ({ mutate: vi.fn(), isPending: false }),
  useTicketWorkProducts: () => ({ data: [], isLoading: false }),
  useTicketFor: () => ({ data: undefined }),
  useTicketDocument: () => ({ data: undefined, isLoading: false, isError: true }),
  useTicketDocumentById: () => ({ data: undefined, isLoading: false, isError: true }),
  useWeaverMany: (ids: readonly string[]) => ids.map(() => ({ data: { agent: { id: 'weaver1', name: 'Weaver' } } })),
  useRuns: () => ({ data: [] }),
}));
vi.mock('../api/runStream', () => ({
  useRunEventStream: () => ({ events: [], status: { state: 'connected' }, retryNow: vi.fn() }),
}));

const { V2NeedsPage } = await import('../v2/NeedsYouPage');

beforeEach(() => {
  state.path = '/needs';
  state.workers = {};
  state.decisions = [
    makeDecision({ id: 'd1', workspaceId: 'ws1', title: 'Approve the plan for ACME-51', kind: 'plan_approval', options: [{ key: 'approve', label: 'Approve' }] }),
    makeDecision({ id: 'd2', workspaceId: 'ws2', title: 'Where should the theme preference live?', kind: 'question', options: [{ key: 'cookie', label: 'Cookie' }] }),
  ];
});

describe('the V2 Needs you screen', () => {
  it('lists real open decisions from every workspace', () => {
    render(<V2NeedsPage />);
    expect(screen.getByText('Approve the plan for ACME-51')).toBeInTheDocument();
    expect(screen.getByText('Where should the theme preference live?')).toBeInTheDocument();
  });

  it('leads with scope filters and filters the list for real', () => {
    render(<V2NeedsPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Acme' }));
    expect(screen.getByText('Approve the plan for ACME-51')).toBeInTheDocument();
    expect(screen.queryByText('Where should the theme preference live?')).toBeNull();
  });

  it('keeps a decision carrying the internal id when a workspace chip is selected on the global screen', () => {
    state.decisions = [
      makeDecision({ id: 'd1', workspaceId: 'ulid-ws1', title: 'Internal-id decision', kind: 'question', options: [], allowFreeText: true }),
    ];
    render(<V2NeedsPage />);
    expect(screen.getByText('Internal-id decision')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Acme' }));
    expect(screen.getByText('Internal-id decision')).toBeInTheDocument();
    expect(screen.getByText('1 waiting')).toBeInTheDocument();
  });

  it('filters by decision-kind chip', () => {
    render(<V2NeedsPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Questions' }));
    expect(screen.getByText('Where should the theme preference live?')).toBeInTheDocument();
    expect(screen.queryByText('Approve the plan for ACME-51')).toBeNull();
  });

  it('derives the count from the one filtered list', () => {
    render(<V2NeedsPage />);
    expect(screen.getByText('2 waiting')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Fernwood' }));
    expect(screen.getByText('1 waiting')).toBeInTheDocument();
  });

  it('still lists a card the badge leaves out, so only the number changes (VS-411)', () => {
    state.decisions = [
      makeDecision({ id: 'd1', workspaceId: 'ws1', kind: 'plan_approval', weaverReviewStatus: 'unseen', title: 'Unreviewed plan' }),
    ];
    render(<V2NeedsPage />);
    expect(screen.getByText('Unreviewed plan')).toBeInTheDocument();
    // VS-469: the card stays listed and reads as waiting on the weaver, not as plain approvable work.
    expect(screen.getByText(/Weaver hasn't reviewed yet/)).toBeInTheDocument();
    expect(screen.getByText(/Approval waits on the weaver's review/)).toBeInTheDocument();
    expect(screen.getByText('1 waiting')).toBeInTheDocument();
  });

  it('pre-applies the workspace scope from the route', () => {
    state.path = '/w/ws1/needs';
    render(<V2NeedsPage />);
    expect(screen.getByRole('button', { name: 'Acme' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('1 waiting')).toBeInTheDocument();
    expect(screen.queryByText('Where should the theme preference live?')).toBeNull();
  });

  it('shows a decision whose workspace id is the internal id on the workspace-scoped screen', () => {
    state.path = '/w/ws1/needs';
    state.decisions = [
      makeDecision({ id: 'd1', workspaceId: 'ulid-ws1', title: 'Scoped decision', kind: 'question', options: [], allowFreeText: true }),
    ];
    render(<V2NeedsPage />);
    expect(screen.getByText('Scoped decision')).toBeInTheDocument();
    expect(screen.getByText('1 waiting')).toBeInTheDocument();
  });

  it('shows an empty state when nothing is waiting', () => {
    state.decisions = [];
    render(<V2NeedsPage />);
    expect(screen.getByText('Nothing needs you right now.')).toBeInTheDocument();
  });

  it('names the workspace weaver on a question it asked, and stays neutral otherwise', () => {
    state.decisions = [
      makeDecision({ id: 'd1', workspaceId: 'ws1', kind: 'question', options: [], allowFreeText: true, askedByAgentId: 'weaver1', title: 'Asked by the weaver' }),
      makeDecision({ id: 'd2', workspaceId: 'ws2', kind: 'question', options: [], allowFreeText: true, askedByAgentId: 'someone-else', title: 'Asked by nobody we know' }),
    ];
    render(<V2NeedsPage />);
    expect(screen.getByRole('article', { name: 'Weaver asks: Asked by the weaver' })).toBeInTheDocument();
    expect(screen.getByRole('article', { name: 'Needs you: Asked by nobody we know' })).toBeInTheDocument();
    expect(screen.queryByText('Worker question')).toBeNull();
    expect(screen.getByText('tk_1 · Workspace · Weaver')).toBeInTheDocument();
    expect(screen.getByText('tk_1 · Workspace · an agent')).toBeInTheDocument();
  });

  it('shows the asking worker its name, never its raw id, and a neutral label when unknown', () => {
    state.workers = { ws2: [{ id: '01M2F4K267XGRT5F4E8B4F63AD', name: 'Platform Engineer #12' }] };
    state.decisions = [
      makeDecision({ id: 'd1', workspaceId: 'ws2', kind: 'question', options: [], allowFreeText: true, askedByAgentId: '01M2F4K267XGRT5F4E8B4F63AD', title: 'Asked by a worker' }),
      makeDecision({ id: 'd2', workspaceId: 'ws2', kind: 'question', options: [], allowFreeText: true, askedByAgentId: 'nobody-we-know', title: 'Asked by an unknown agent' }),
    ];
    render(<V2NeedsPage />);
    expect(screen.getByText(/Platform Engineer #12/)).toBeInTheDocument();
    expect(screen.queryByText(/01M2F4K267XGRT5F4E8B4F63AD/)).toBeNull();
    expect(screen.queryByText(/nobody-we-know/)).toBeNull();
    expect(screen.getByText(/an agent/)).toBeInTheDocument();
  });
});

describe('the V2 Needs you Held filter', () => {
  it('shows only the decisions the weaver marked with concerns', () => {
    state.decisions = [
      makeDecision({ id: 'd1', workspaceId: 'ws1', kind: 'merge_approval', title: 'Held merge', weaverReviewStatus: 'concerns' }),
      makeDecision({ id: 'd2', workspaceId: 'ws1', kind: 'plan_approval', title: 'Clean plan', weaverReviewStatus: 'looked' }),
    ];
    render(<V2NeedsPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Held' }));
    expect(screen.getByText('Held merge')).toBeInTheDocument();
    expect(screen.queryByText('Clean plan')).toBeNull();
    expect(screen.getByText('1 waiting')).toBeInTheDocument();
  });

  it('combines with a workspace scope chip, including a decision carrying the internal id', () => {
    state.decisions = [
      makeDecision({ id: 'd1', workspaceId: 'ulid-ws1', kind: 'merge_approval', title: 'Acme held', weaverReviewStatus: 'concerns' }),
      makeDecision({ id: 'd2', workspaceId: 'ws2', kind: 'merge_approval', title: 'Fernwood held', weaverReviewStatus: 'concerns' }),
    ];
    render(<V2NeedsPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Held' }));
    expect(screen.getByText('Acme held')).toBeInTheDocument();
    expect(screen.getByText('Fernwood held')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Acme' }));
    expect(screen.getByText('Acme held')).toBeInTheDocument();
    expect(screen.queryByText('Fernwood held')).toBeNull();
  });

  it('is mutually exclusive with the kind chips, in both directions', () => {
    state.decisions = [
      makeDecision({ id: 'd1', workspaceId: 'ws1', kind: 'merge_approval', title: 'Held merge', weaverReviewStatus: 'concerns' }),
      makeDecision({ id: 'd2', workspaceId: 'ws1', kind: 'plan_approval', title: 'Held plan', weaverReviewStatus: 'concerns' }),
      makeDecision({ id: 'd3', workspaceId: 'ws1', kind: 'plan_approval', title: 'Clean plan', weaverReviewStatus: 'looked' }),
    ];
    render(<V2NeedsPage />);
    const held = screen.getByRole('button', { name: 'Held' });
    const plans = screen.getByRole('button', { name: 'Plans' });

    fireEvent.click(held);
    expect(held).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByText('Clean plan')).toBeNull();

    fireEvent.click(plans);
    expect(plans).toHaveAttribute('aria-pressed', 'true');
    expect(held).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByText('Held plan')).toBeInTheDocument();
    expect(screen.queryByText('Held merge')).toBeNull();

    fireEvent.click(held);
    expect(held).toHaveAttribute('aria-pressed', 'true');
    expect(plans).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByText('Held plan')).toBeInTheDocument();
    expect(screen.queryByText('Clean plan')).toBeNull();
  });

  it('shows a held empty state, and keeps the chip visible, when nothing is held', () => {
    state.decisions = [
      makeDecision({ id: 'd1', workspaceId: 'ws1', kind: 'plan_approval', title: 'Clean plan', weaverReviewStatus: 'looked' }),
    ];
    render(<V2NeedsPage />);
    expect(screen.getByRole('button', { name: 'Held' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Held' }));
    expect(screen.getByText('Nothing is held.')).toBeInTheDocument();
    expect(screen.queryByText('Clean plan')).toBeNull();
    expect(screen.getByRole('button', { name: 'Held' })).toBeInTheDocument();
  });

  it('keeps the Held chip visible with no decisions at all', () => {
    state.decisions = [];
    render(<V2NeedsPage />);
    expect(screen.getByRole('button', { name: 'Held' })).toBeInTheDocument();
  });
});

describe('the V2 Needs you route scope (VS-459)', () => {
  // `/w/$ws/needs` reuses the mounted screen when only `$ws` changes, so the route, not the first
  // mount, owns the scope chip. These re-render the same instance with a new `state.path`, which is
  // exactly what a rail click from A's Needs you to B's does.
  it('follows the route when switching from one workspace to another', () => {
    state.path = '/w/ws1/needs';
    const { rerender } = render(<V2NeedsPage />);
    expect(screen.getByText('Approve the plan for ACME-51')).toBeInTheDocument();
    expect(screen.queryByText('Where should the theme preference live?')).toBeNull();

    state.path = '/w/ws2/needs';
    rerender(<V2NeedsPage />);
    expect(screen.getByText('Where should the theme preference live?')).toBeInTheDocument();
    expect(screen.queryByText('Approve the plan for ACME-51')).toBeNull();
    expect(screen.getByRole('button', { name: 'Fernwood' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('shows every workspace when the route moves from a workspace to Everywhere', () => {
    state.path = '/w/ws1/needs';
    const { rerender } = render(<V2NeedsPage />);
    expect(screen.queryByText('Where should the theme preference live?')).toBeNull();

    state.path = '/needs';
    rerender(<V2NeedsPage />);
    expect(screen.getByText('Approve the plan for ACME-51')).toBeInTheDocument();
    expect(screen.getByText('Where should the theme preference live?')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Everywhere' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('respects a chip picked on the page until the route changes again', () => {
    const { rerender } = render(<V2NeedsPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Fernwood' }));
    expect(screen.getByText('Where should the theme preference live?')).toBeInTheDocument();
    expect(screen.queryByText('Approve the plan for ACME-51')).toBeNull();

    // A re-render with no route change keeps the chip the human picked.
    rerender(<V2NeedsPage />);
    expect(screen.getByRole('button', { name: 'Fernwood' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByText('Approve the plan for ACME-51')).toBeNull();

    // The next route change resets it to the route's scope.
    state.path = '/w/ws1/needs';
    rerender(<V2NeedsPage />);
    expect(screen.getByText('Approve the plan for ACME-51')).toBeInTheDocument();
    expect(screen.queryByText('Where should the theme preference live?')).toBeNull();
  });
});
