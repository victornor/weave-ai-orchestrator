import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api/client';

const state = vi.hoisted(() => ({
  updates: [] as Array<Record<string, unknown>>,
  role: {} as Record<string, unknown>,
  concurrency: {} as Record<string, unknown> | undefined,
  models: [] as Array<Record<string, unknown>>,
  defaults: {} as Record<string, unknown>,
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
  useRuntimes: () => ({ data: [{ id: 'claude', displayName: 'Claude' }, { id: 'codex', displayName: 'Codex' }] }),
  useRuntimeModels: () => ({ data: state.models }),
  useWorkspaceSummary: () => ({ data: { config: { defaults: state.defaults } } }),
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
  state.models = [{ id: 'claude-opus-5', label: 'Opus 5' }];
  state.defaults = {};
  state.updateError = null;
  state.role = {
    id: 'backend', projectId: 'p1', name: 'Backend Engineer', status: 'active', runtimeId: 'claude', model: null,
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

describe('Team — role runtime and model', () => {
  /** The role sheet, opened; the runtime and model selects live next to max workers. */
  function sheet(): { runtime: HTMLElement; model: HTMLElement } {
    render(<TeamRoute />);
    fireEvent.click(screen.getByText('Charter'));
    return { runtime: screen.getByLabelText('runtime'), model: screen.getByLabelText('model') };
  }

  it('patches `runtime`, the RoleSpec field name, not the `runtimeId` column name', () => {
    const { runtime } = sheet();
    expect(runtime).toHaveValue('claude');
    fireEvent.change(runtime, { target: { value: 'codex' } });
    expect(state.updates).toEqual([{ id: 'backend', patch: { runtime: 'codex' }, reason: 'changed from the web app' }]);
  });

  it('patches the chosen model', () => {
    const { model } = sheet();
    expect(model).toHaveValue('');
    fireEvent.change(model, { target: { value: 'claude-opus-5' } });
    expect(state.updates).toEqual([{ id: 'backend', patch: { model: 'claude-opus-5' }, reason: 'changed from the web app' }]);
  });

  it('clears an override with null rather than the empty string, which would be stored verbatim', () => {
    state.role['model'] = 'claude-opus-5';
    const { model } = sheet();
    expect(model).toHaveValue('claude-opus-5');
    fireEvent.change(model, { target: { value: '' } });
    expect(state.updates).toEqual([{ id: 'backend', patch: { model: null }, reason: 'changed from the web app' }]);
  });

  it('names the model the default resolves to, when the workspace sets one', () => {
    state.defaults = { model: 'claude-sonnet-5' };
    sheet();
    expect(screen.getByRole('option', { name: 'default · claude-sonnet-5' })).toBeInTheDocument();
  });

  it('says only "default" when the workspace leaves the model to the runtime', () => {
    sheet();
    expect(screen.getByRole('option', { name: 'default' })).toBeInTheDocument();
  });

  it('shows the daemon error instead of pretending the change stuck', () => {
    state.updateError = new ApiError(400, { code: 'validation', message: 'unrecognized key: "runtimeId"' });
    const { runtime } = sheet();
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('VALIDATION');
    expect(alert).toHaveTextContent('The role was not changed: unrecognized key: "runtimeId"');
    expect(runtime).toHaveValue('claude');   // still the stored runtime, not the one that failed
  });
});
