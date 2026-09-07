import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api/client';

const state = vi.hoisted(() => ({
  updates: [] as Array<Record<string, unknown>>,
  role: {} as Record<string, unknown>,
  concurrency: {} as Record<string, unknown> | undefined,
  updateError: null as Error | null,
}));

vi.mock('../api/context', () => ({ useWs: () => 'ws1' }));
vi.mock('../app/link', () => ({ useGo: () => vi.fn() }));
vi.mock('../api/hooks', () => ({
  useProjects: () => ({ data: [{ id: 'p1', slug: 'api' }] }),
  useRoles: () => ({ data: [state.role], isError: false }),
  useWorkers: () => ({ data: [] }),
  useConductor: () => ({ data: null, isLoading: false }),
  useRole: () => ({ data: { role: state.role, charter: '# Charter', revisions: [], workers: [], concurrency: state.concurrency }, isLoading: false }),
  useUpdateRole: () => ({
    mutate: (v: Record<string, unknown>) => state.updates.push(v),
    isPending: false,
    isError: state.updateError !== null,
    error: state.updateError,
    reset: vi.fn(),
  }),
  useRoleAction: () => ({ mutate: vi.fn() }),
  useWorkerAction: () => ({ mutate: vi.fn(), isPending: false }),
  useRollbackCharter: () => ({ mutate: vi.fn() }),
}));

const { TeamRoute } = await import('../routes/Team');

/** Open the role sheet, which is where the max-workers control lives. */
function openSheet(): HTMLElement {
  render(<TeamRoute />);
  fireEvent.click(screen.getByText('Charter'));
  return screen.getByLabelText('max workers');
}

beforeEach(() => {
  state.updates = [];
  state.updateError = null;
  state.role = {
    id: 'backend', projectId: 'p1', name: 'Backend Engineer', status: 'active',
    maxWorkers: 2, charterSummary: 'Owns the api service.',
  };
  state.concurrency = { roleMax: 2, projectMax: 4, effective: 2, live: 1, projectLive: 1, free: 1 };
});

describe('Team — role max workers', () => {
  it('shows the current limit and the effective concurrency', () => {
    const input = openSheet();
    expect(input).toHaveValue(2);
    expect(screen.getByText(/2 effective · 1 live · 1 free/)).toBeInTheDocument();
  });

  it('says which limit is doing the capping when the project is the smaller one', () => {
    state.role['maxWorkers'] = 8;
    state.concurrency = { roleMax: 8, projectMax: 4, effective: 4, live: 1, projectLive: 1, free: 3 };
    openSheet();
    expect(screen.getByText(/capped by the project limit of 4/)).toBeInTheDocument();
  });

  it('patches the role once, on blur, with the new limit', () => {
    const input = openSheet();
    fireEvent.change(input, { target: { value: '6' } });
    expect(state.updates).toEqual([]);          // nothing per keystroke
    fireEvent.blur(input);
    expect(state.updates).toEqual([{ id: 'backend', patch: { maxWorkers: 6 }, reason: 'changed from the web app' }]);
  });

  it('says nothing to the daemon for an unchanged or out-of-range value, and snaps back', () => {
    const input = openSheet();
    fireEvent.blur(input);
    fireEvent.change(input, { target: { value: '2' } });
    fireEvent.blur(input);
    fireEvent.change(input, { target: { value: '99' } });
    fireEvent.blur(input);
    expect(input).toHaveValue(2);
    fireEvent.change(input, { target: { value: '0' } });
    fireEvent.blur(input);
    expect(state.updates).toEqual([]);
  });

  it('renders without the concurrency block when the daemon predates it', () => {
    state.concurrency = undefined;
    expect(openSheet()).toHaveValue(2);
    expect(screen.queryByText(/effective/)).not.toBeInTheDocument();
  });
});

describe('Team — a role offers no runtime or model', () => {
  /** The role sheet, where the per-role runtime and model selects used to live (VS-77). */
  function sheet(): void {
    render(<TeamRoute />);
    fireEvent.click(screen.getByText('Charter'));
  }

  it('offers neither control', () => {
    sheet();
    expect(screen.queryByLabelText('runtime')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('model')).not.toBeInTheDocument();
  });

  it('shows the daemon error instead of pretending a change stuck', () => {
    state.updateError = new ApiError(400, { code: 'validation', message: 'unrecognized key: "runtimeId"' });
    sheet();
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('VALIDATION');
    expect(alert).toHaveTextContent('The role was not changed: unrecognized key: "runtimeId"');
  });
});
