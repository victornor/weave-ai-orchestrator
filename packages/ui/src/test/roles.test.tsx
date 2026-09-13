import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api/client';

const state = vi.hoisted(() => ({
  updates: [] as Array<Record<string, unknown>>,
  role: {} as Record<string, unknown>,
  concurrency: {} as Record<string, unknown> | undefined,
  updateError: null as Error | null,
  startSession: vi.fn(),
  workers: [] as Array<Record<string, unknown>>,
}));

vi.mock('../api/context', () => ({ useWs: () => 'ws1', useHookWs: (o?: string) => o ?? 'ws1' }));
vi.mock('../app/link', () => ({ useGo: () => vi.fn() }));
vi.mock('../api/hooks', () => ({
  useProjects: () => ({ data: [{ id: 'p1', slug: 'api' }] }),
  useRoles: () => ({ data: [state.role], isError: false }),
  useWorkers: () => ({ data: state.workers }),
  useWeaver: () => ({ data: null, isLoading: false }),
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
  useStartSession: () => ({ mutate: state.startSession, isPending: false }),
  useRollbackCharter: () => ({ mutate: vi.fn() }),
}));

const { RolesRoute } = await import('../routes/Roles');

function openSheet(): void {
  render(<RolesRoute />);
  fireEvent.click(screen.getByText('Charter'));
}

beforeEach(() => {
  state.updates = [];
  state.updateError = null;
  state.workers = [];
  state.role = {
    id: 'backend', projectId: 'p1', name: 'Backend Engineer', status: 'active',
    maxWorkers: 2, charterSummary: 'Owns the api service.',
  };
  state.concurrency = { roleMax: 2, projectMax: 4, effective: 2, live: 1, projectLive: 1, free: 1 };
  state.startSession = vi.fn();
});

describe('Roles — start an interactive session (VS-101)', () => {
  it('opens the form, requires a title, and starts against the role\'s own project and role', () => {
    render(<RolesRoute />);
    expect(screen.getByText('Weaver')).toBeInTheDocument();
    expect(screen.queryByLabelText('Session title')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Start session' }));
    const startButton = screen.getByRole('button', { name: 'Start' });
    expect(startButton).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Session title'), { target: { value: 'Debug the flaky test' } });
    expect(startButton).not.toBeDisabled();
    fireEvent.click(startButton);

    expect(state.startSession).toHaveBeenCalledWith(
      { projectId: 'p1', roleId: 'backend', kind: 'task', title: 'Debug the flaky test', description: undefined },
      expect.anything(),
    );
  });

  it('cancel closes the form without starting anything', () => {
    render(<RolesRoute />);
    fireEvent.click(screen.getByRole('button', { name: 'Start session' }));
    fireEvent.change(screen.getByLabelText('Session title'), { target: { value: 'Something' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByLabelText('Session title')).not.toBeInTheDocument();
    expect(state.startSession).not.toHaveBeenCalled();
  });
});

describe('Roles — role max workers', () => {
  it('does not offer a per-role max-workers editor', () => {
    openSheet();
    expect(screen.queryByLabelText('max workers')).not.toBeInTheDocument();
    expect(screen.queryByText(/effective/)).not.toBeInTheDocument();
    expect(screen.queryByText(/\d+\/\d+ workers/)).not.toBeInTheDocument();
  });

  it('shows a live worker count without a per-role denominator', () => {
    render(<RolesRoute />);
    expect(screen.getByText('0 workers')).toBeInTheDocument();
    expect(screen.queryByText(/0\/2 workers/)).not.toBeInTheDocument();
  });
});

describe('Roles — a role offers no runtime or model', () => {
  /** The role sheet, where the per-role runtime and model selects used to live (VS-77). */
  function sheet(): void {
    render(<RolesRoute />);
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

describe('Roles — live instances only, with kept work surfaced (VS-333)', () => {
  function worker(over: Record<string, unknown>): Record<string, unknown> {
    return {
      id: 'w1', workspaceId: 'ws1', kind: 'worker', projectId: 'p1', roleId: 'backend', ticketId: 'TST-1',
      name: 'Backend Engineer #1', runtimeId: 'claude', status: 'active', errorText: null,
      interactiveSession: false, scheduledWake: null, createdAt: 't0', updatedAt: 't0', ...over,
    };
  }

  it('lists only live workers and counts them in the header', () => {
    state.workers = [
      worker({ id: 'live', name: 'Backend Engineer #1', status: 'active' }),
      worker({ id: 'clean', name: 'Finished Engineer', status: 'done', errorText: null }),
    ];
    render(<RolesRoute />);
    expect(screen.getByText('1 roles · 1 workers')).toBeInTheDocument();
    expect(screen.queryByText('Finished Engineer')).not.toBeInTheDocument();
  });

  it('shows a done worker whose work is kept in a finished group with the reason', () => {
    state.workers = [
      worker({ id: 'kept', name: 'Kept Engineer', status: 'done', errorText: '2 commit(s) are not contained in main' }),
    ];
    render(<RolesRoute />);
    expect(screen.getByText('Finished, work kept (1)')).toBeInTheDocument();
    expect(screen.getByText('2 commit(s) are not contained in main')).toBeInTheDocument();
    expect(screen.getByText('Kept Engineer')).toBeInTheDocument();
  });

  it('does not show the finished group when nothing is kept', () => {
    state.workers = [worker({ id: 'clean', status: 'done', errorText: null })];
    render(<RolesRoute />);
    expect(screen.queryByText(/Finished, work kept/)).not.toBeInTheDocument();
  });
});
