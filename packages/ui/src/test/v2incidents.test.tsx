/** VS-350: the V2 Incidents list — filters, pulsing dot, expansion and no action controls. */
import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Incident } from '@weave-ai/shared';

const state = vi.hoisted(() => ({ items: [] as Incident[] }));

vi.mock('@tanstack/react-router', () => ({
  useRouterState: (o?: { select?: (s: { location: { pathname: string } }) => unknown }) => (o?.select ? o.select({ location: { pathname: '/v2/incidents' } }) : '/v2/incidents'),
  useParams: () => ({}),
}));
vi.mock('../app/link', () => ({ useSearchParams: () => ({}), useGo: () => vi.fn() }));
vi.mock('../api/hooks', () => ({
  useIncidents: () => ({ data: { items: state.items, total: state.items.length }, isLoading: false, isError: false, refetch: vi.fn() }),
  useWorkspaces: () => ({
    data: [
      { id: 'ws1', internalId: '01M2F5WS1ULID', name: 'Acme' },
      { id: 'ws2', internalId: '01M2F5WS2ULID', name: 'Fernwood' },
    ],
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useWorkers: () => ({ data: [] }),
}));

const { IncidentsBody } = await import('../v2/IncidentsPage');

const incident = (over: Partial<Incident> = {}): Incident => ({
  id: 'i1',
  reporterKind: 'worker',
  title: 'Runtime unreachable',
  whatFailed: 'The runtime could not be reached.',
  tryingToDo: 'Run the turn',
  evidence: 'error: connect ECONNREFUSED',
  workspaceId: 'ws1',
  projectId: null,
  ticketId: null,
  agentId: 'a1',
  runId: 'r1',
  roleId: null,
  createdAt: '2026-09-13T10:00:00.000Z',
  resolvedAt: null,
  resolvedByAgentId: null,
  resolution: null,
  resolutionTicketId: null,
  ...over,
});

beforeEach(() => {
  state.items = [
    incident({ id: 'i1', title: 'Runtime unreachable' }),
    incident({ id: 'i2', title: 'Old outage', resolvedAt: '2026-09-12T10:00:00.000Z' }),
  ];
});

describe('V2 Incidents', () => {
  it('filters by open and resolved', () => {
    render(<IncidentsBody />);
    expect(screen.getByText('2 shown')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(screen.getByText('1 shown')).toBeInTheDocument();
    expect(screen.getByText('Runtime unreachable')).toBeInTheDocument();
    expect(screen.queryByText('Old outage')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Resolved' }));
    expect(screen.getByText('Old outage')).toBeInTheDocument();
  });

  it('resolves the workspace name from whichever id the incident carries, never the ULID', () => {
    // The run-token claim stores the workspace's internal id; the slug is what the list sends as `id`.
    state.items = [
      incident({ id: 'i1', workspaceId: 'ws1' }),
      incident({ id: 'i2', title: 'Internal-id incident', workspaceId: '01M2F5WS2ULID' }),
    ];
    render(<IncidentsBody />);
    expect(screen.getByText('Acme')).toBeInTheDocument();
    expect(screen.getByText('Fernwood')).toBeInTheDocument();
    expect(screen.queryByText(/01M2F5WS2ULID/)).toBeNull();
  });

  it('pulses the dot only while open', () => {
    render(<IncidentsBody />);
    const open = document.querySelector('[data-v2-incident="i1"] [data-pulse="true"]');
    const resolved = document.querySelector('[data-v2-incident="i2"] [data-pulse="false"]');
    expect(open).toBeTruthy();
    expect(resolved).toBeTruthy();
  });

  it('expands to show what failed, the evidence and the weaver note, with no controls', () => {
    render(<IncidentsBody />);
    const card = document.querySelector('[data-v2-incident="i1"]') as HTMLElement;
    fireEvent.click(card.querySelector('button') as HTMLElement);
    expect(card.querySelector('[data-v2-incident-what]')?.textContent).toContain('could not be reached');
    expect(card.querySelector('[data-v2-incident-evidence]')?.textContent).toContain('ECONNREFUSED');
    expect(screen.getByText(/The weaver is handling this/)).toBeInTheDocument();
    expect(within(card).queryByRole('button', { name: 'Retry' })).toBeNull();
    expect(within(card).queryByRole('button', { name: 'Resolve' })).toBeNull();
    expect(card.querySelectorAll('button')).toHaveLength(1);
  });
});
