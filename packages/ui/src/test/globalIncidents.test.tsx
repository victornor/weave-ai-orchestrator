/** VS-174: daemon-wide Incidents page. */
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Incident } from '@weave-ai/shared';

const state = vi.hoisted(() => ({
  search: {} as Record<string, string | undefined>,
  go: vi.fn(),
  items: [] as Incident[] | undefined,
  isError: false,
  refetch: vi.fn(),
  workspaces: [] as Array<{ id: string; name: string }>,
}));

vi.mock('../api/hooks', () => ({
  useIncidents: () => ({
    data: state.items === undefined ? undefined : { items: state.items, total: state.items.length },
    isError: state.isError,
    error: state.isError ? new Error('could not load') : undefined,
    refetch: state.refetch,
  }),
  useWorkspaces: () => ({ data: state.workspaces }),
}));

vi.mock('../app/link', () => ({
  useGo: () => state.go,
  useSearchParams: () => state.search,
}));

const { GlobalIncidentsRoute } = await import('../routes/GlobalIncidents');

const incident = (over: Partial<Incident> = {}): Incident => ({
  id: 'i1',
  reporterKind: 'worker',
  title: 'MCP call failed',
  whatFailed: 'weave_ticket_get returned not_found',
  tryingToDo: 'read the bound ticket',
  evidence: 'OcError not_found',
  workspaceId: 'alpha',
  projectId: 'p1',
  ticketId: 't1',
  agentId: 'ag1',
  runId: 'run1',
  roleId: 'r1',
  createdAt: '2026-09-10T12:00:00.000Z',
  resolvedAt: null,
  resolvedByAgentId: null,
  resolution: null,
  resolutionTicketId: null,
  ...over,
});

beforeEach(() => {
  state.search = {};
  state.go = vi.fn();
  state.items = [];
  state.isError = false;
  state.refetch = vi.fn();
  state.workspaces = [{ id: 'alpha', name: 'Alpha' }];
});

describe('GlobalIncidentsRoute', () => {
  it('shows a filed worker incident title labelled worker', () => {
    state.items = [incident()];
    render(<GlobalIncidentsRoute />);
    expect(screen.getByText('MCP call failed')).toBeInTheDocument();
    expect(screen.getByText('worker')).toBeInTheDocument();
  });

  it('shows both kinds labelled', () => {
    state.items = [
      incident({ id: 'w', title: 'Worker fail', reporterKind: 'worker' }),
      incident({ id: 'c', title: 'Weaver fail', reporterKind: 'weaver' }),
    ];
    render(<GlobalIncidentsRoute />);
    expect(screen.getByText('Worker fail')).toBeInTheDocument();
    expect(screen.getByText('Weaver fail')).toBeInTheDocument();
    expect(screen.getByText('worker')).toBeInTheDocument();
    expect(screen.getByText('weaver')).toBeInTheDocument();
  });

  it('weaver filter navigates with ?reporter=weaver', () => {
    state.items = [incident()];
    render(<GlobalIncidentsRoute />);
    fireEvent.click(screen.getByRole('button', { name: 'Weaver' }));
    expect(state.go).toHaveBeenCalledWith('/incidents', { search: { reporter: 'weaver' }, replace: true });
  });

  it('worker filter navigates with ?reporter=worker', () => {
    state.items = [incident()];
    render(<GlobalIncidentsRoute />);
    fireEvent.click(screen.getByRole('button', { name: 'Worker' }));
    expect(state.go).toHaveBeenCalledWith('/incidents', { search: { reporter: 'worker' }, replace: true });
  });

  it('says so when nothing has been filed', () => {
    state.items = [];
    render(<GlobalIncidentsRoute />);
    expect(screen.getByText('No incidents have been filed.')).toBeInTheDocument();
  });

  it('says so when the weaver filter matches nothing', () => {
    state.search = { reporter: 'weaver' };
    state.items = [];
    render(<GlobalIncidentsRoute />);
    expect(screen.getByText('No weaver incidents.')).toBeInTheDocument();
  });

  it('shows an error, not the empty wording, when the list fails', () => {
    state.isError = true;
    state.items = undefined;
    render(<GlobalIncidentsRoute />);
    expect(screen.queryByText('No incidents have been filed.')).toBeNull();
    expect(screen.getByRole('alert')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(state.refetch).toHaveBeenCalled();
  });

  it('expands a row to show whatFailed, tryingToDo and evidence', () => {
    state.items = [incident()];
    render(<GlobalIncidentsRoute />);
    expect(screen.queryByText(/weave_ticket_get returned not_found/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /MCP call failed/ }));
    expect(screen.getByText(/weave_ticket_get returned not_found/)).toBeInTheDocument();
    expect(screen.getByText(/read the bound ticket/)).toBeInTheDocument();
    expect(screen.getByText('OcError not_found')).toBeInTheDocument();
  });
});
