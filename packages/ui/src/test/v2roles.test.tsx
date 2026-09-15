/**
 * VS-351: the V2 Roles screen — roles grouped by project, a working worker's feed expanding in
 * place, the Hire a role modal whose preview is the sent message, and the kept management actions.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type { Project, Run, RunEvent } from '@weave-ai/shared';
import { agent, project, role, run as makeRun, ticket } from './factories';

const state = vi.hoisted(() => ({
  projects: [] as unknown[],
  roles: [] as unknown[],
  workers: [] as unknown[],
  tickets: [] as unknown[],
  runs: [] as unknown[],
  roleDetail: undefined as unknown,
  threads: [] as unknown[],
  go: vi.fn(),
  roleAction: vi.fn(),
  updateRole: vi.fn(),
  putCharter: vi.fn(),
  rollback: vi.fn(),
  startSession: vi.fn(),
  createThread: vi.fn(),
  post: vi.fn(),
  events: [] as unknown[],
  roleActionError: false,
  postPending: false,
  createPending: false,
  startSessionError: null as string | null,
}));

vi.mock('../app/link', () => ({
  A: ({ to, children, ...rest }: { to: string; children?: ReactNode }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
  useGo: () => state.go,
}));
vi.mock('../api/context', () => ({
  useWs: () => 'ws1',
}));
vi.mock('../api/hooks', () => ({
  useWs: () => 'ws1',
  useProjects: () => ({ data: state.projects, isLoading: false, isError: false, refetch: vi.fn() }),
  useRoles: () => ({ data: state.roles, isLoading: false, isError: false, refetch: vi.fn() }),
  useWorkers: () => ({ data: state.workers }),
  useTickets: () => ({ data: state.tickets }),
  useRuns: (params: { status?: string } = {}) => ({
    data: (state.runs as Run[]).filter((r) => !params.status || r.status === params.status),
  }),
  useRole: () => ({ data: state.roleDetail, isLoading: false, isError: false }),
  useRoleAction: () => ({
    mutate: state.roleAction,
    isPending: false,
    isError: state.roleActionError,
    error: state.roleActionError ? new Error('nope') : null,
  }),
  useUpdateRole: () => ({ mutate: state.updateRole, isPending: false, isError: false, error: null, reset: vi.fn() }),
  usePutCharter: () => ({ mutate: state.putCharter, isPending: false, isError: false, error: null, reset: vi.fn() }),
  useRollbackCharter: () => ({ mutate: state.rollback, isPending: false, isError: false, error: null, reset: vi.fn() }),
  useStartSession: () => ({
    mutate: state.startSession,
    isPending: false,
    isError: state.startSessionError !== null,
    error: state.startSessionError ? new Error(state.startSessionError) : null,
  }),
  useThreads: () => ({ data: state.threads }),
  useCreateThread: () => ({ mutateAsync: state.createThread, isPending: state.createPending }),
  usePostThreadMessage: () => ({ mutate: state.post, isPending: state.postPending, isError: false, error: null }),
}));
vi.mock('../api/runStream', () => ({
  useRunEventStream: () => ({ events: state.events as RunEvent[], status: { state: 'connected' }, retryNow: vi.fn() }),
}));

const { V2RolesScreen, buildHireRequest, groupRolesByProject, liveWorkersOf, roleStateLabel } = await import('../v2/RolesPage');
const { defaultThread } = await import('../lib/threads');

const apiProject = (): Project => project({ id: 'p1', slug: 'api', name: 'api' });
const webProject = (): Project => project({ id: 'p2', slug: 'web', name: 'web' });

const textEvent: RunEvent = {
  id: 'e1',
  runId: 'run_1',
  seq: 1,
  ts: '2026-09-13T10:00:00.000Z',
  type: 'assistant.text',
  stream: 'stdout',
  level: 'info',
  payload: { text: 'Writing the migration.' },
};

beforeEach(() => {
  state.projects = [apiProject(), webProject()];
  state.roles = [role({ id: 'r1', projectId: 'p1', name: 'Backend Engineer' }), role({ id: 'r2', projectId: 'p2', name: 'Codebase Scout' })];
  state.workers = [];
  state.tickets = [ticket({ id: 'tk_1', identifier: 'ACME-42', title: 'Dark mode' })];
  state.runs = [];
  state.roleDetail = undefined;
  state.threads = [{ id: 't1', agentId: 'weaver1' }];
  state.events = [textEvent];
  state.roleActionError = false;
  state.postPending = false;
  state.createPending = false;
  state.startSessionError = null;
  state.createThread.mockReset();
  state.createThread.mockResolvedValue({ id: 't_new' });
  state.post.mockReset();
  state.post.mockImplementation((_v: unknown, opts?: { onSuccess?: () => void }) => opts?.onSuccess?.());
  state.go.mockClear();
  state.roleAction.mockClear();
  state.updateRole.mockClear();
  state.putCharter.mockClear();
  state.rollback.mockClear();
  state.startSession.mockClear();
});

describe('the Roles helpers', () => {
  it('groups roles under the project they were hired for', () => {
    const groups = groupRolesByProject([apiProject(), webProject()], [role({ id: 'r1', projectId: 'p1' }), role({ id: 'r2', projectId: 'p2' })]);
    expect(groups.map((g) => g.project.id)).toEqual(['p1', 'p2']);
    expect(groups[0]!.roles.map((r) => r.id)).toEqual(['r1']);
    expect(groups[1]!.roles.map((r) => r.id)).toEqual(['r2']);
  });

  it('names pending activation as awaiting hire approval', () => {
    expect(roleStateLabel('pending_activation')).toBe('awaiting hire approval');
    expect(roleStateLabel('active')).toBe('active');
  });

  it('counts only live workers', () => {
    const workers = [
      agent({ id: 'a1', roleId: 'r1', status: 'running' }),
      agent({ id: 'a2', roleId: 'r1', status: 'done' }),
      agent({ id: 'a3', roleId: 'r1', status: 'retired' }),
      agent({ id: 'a4', roleId: 'r2', status: 'running' }),
    ];
    expect(liveWorkersOf(workers, 'r1').map((w) => w.id)).toEqual(['a1']);
  });

  it('builds the exact hire message', () => {
    expect(buildHireRequest('api', 'Own the migrations.')).toBe('/hire-role project=api\n\nOwn the migrations.');
    expect(buildHireRequest('api', '  spaced  ')).toBe('/hire-role project=api\n\nspaced');
  });

  it('opens the default thread the chat would open', () => {
    const threads = [{ id: 't_recent', agentId: 'weaver1' }, { id: 't_older', agentId: 'weaver1' }];
    expect(defaultThread(threads as never)?.id).toBe('t_recent');
    expect(defaultThread([])).toBeNull();
  });
});

describe('the V2 Roles screen', () => {
  it('renders roles under their projects and an empty group when none is hired', () => {
    state.roles = [role({ id: 'r1', projectId: 'p1', name: 'Backend Engineer' })];
    render(<V2RolesScreen />);
    expect(screen.getByText('Backend Engineer')).toBeInTheDocument();
    expect(screen.queryByText('Codebase Scout')).toBeNull();
    expect(screen.getByText('No role hired for this project yet.')).toBeInTheDocument();
  });

  it('shows awaiting hire approval for a pending role', () => {
    state.roles = [role({ id: 'r1', projectId: 'p1', name: 'Backend Engineer', status: 'pending_activation' })];
    render(<V2RolesScreen />);
    expect(screen.getByText('awaiting hire approval')).toBeInTheDocument();
  });

  it('expands a working worker’s feed in place', () => {
    state.roles = [role({ id: 'r1', projectId: 'p1', name: 'Backend Engineer' })];
    state.workers = [agent({ id: 'a1', roleId: 'r1', status: 'running', name: 'Backend Engineer #7', ticketId: 'tk_1' })];
    state.runs = [makeRun({ id: 'run_1', agentId: 'a1', status: 'running', model: 'sonnet-4.6', usage: { inputTokens: 1000, outputTokens: 500, cachedInputTokens: 0, basis: 'test' } })];
    render(<V2RolesScreen />);
    expect(document.querySelector('[data-role-worker-live="true"]')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Backend Engineer #7/ }));
    const feed = document.querySelector('[data-worker-feed]');
    expect(feed).not.toBeNull();
    expect(screen.getByText('sonnet-4.6')).toBeInTheDocument();
    expect(screen.getByText('Open in Live')).toBeInTheDocument();
    expect(screen.getAllByText('1.5k tok').length).toBeGreaterThan(0);
  });

  it('expands each working worker independently', () => {
    state.roles = [role({ id: 'r1', projectId: 'p1', name: 'Backend Engineer' })];
    state.workers = [
      agent({ id: 'a1', roleId: 'r1', status: 'running', name: 'Backend Engineer #7' }),
      agent({ id: 'a2', roleId: 'r1', status: 'running', name: 'Backend Engineer #8' }),
    ];
    state.runs = [
      makeRun({ id: 'run_1', agentId: 'a1', status: 'running' }),
      makeRun({ id: 'run_2', agentId: 'a2', status: 'running' }),
    ];
    render(<V2RolesScreen />);
    fireEvent.click(screen.getByRole('button', { name: /Backend Engineer #7/ }));
    expect(document.querySelectorAll('[data-worker-feed]')).toHaveLength(1);
    expect(document.querySelector('[data-role-worker="a1"]')!.querySelector('[data-worker-feed]')).not.toBeNull();
    expect(document.querySelector('[data-role-worker="a2"]')!.querySelector('[data-worker-feed]')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Backend Engineer #7/ }));
    expect(document.querySelectorAll('[data-worker-feed]')).toHaveLength(0);
  });

  it('opens the worker page for a worker with neither a live session nor a ticket', () => {
    state.roles = [role({ id: 'r1', projectId: 'p1', name: 'Backend Engineer' })];
    state.workers = [agent({ id: 'a9', roleId: 'r1', status: 'paused', name: 'Backend Engineer #9', ticketId: null })];
    render(<V2RolesScreen />);
    fireEvent.click(screen.getByRole('button', { name: /Backend Engineer #9/ }));
    expect(state.go).toHaveBeenCalledWith('/w/$ws/workers/$workerId', { params: { ws: 'ws1', workerId: 'a9' } });
    expect(document.querySelector('[data-worker-feed]')).toBeNull();
  });

  it('expands a worker that is not running when it has a ticket, with a resize grip (VS-409)', () => {
    state.roles = [role({ id: 'r1', projectId: 'p1', name: 'Backend Engineer' })];
    state.workers = [agent({ id: 'a9', roleId: 'r1', status: 'paused', name: 'Backend Engineer #9', ticketId: 'tk_1' })];
    state.runs = [makeRun({ id: 'run_9', agentId: 'a9', status: 'succeeded', createdAt: '2026-09-13T10:00:00.000Z' })];
    render(<V2RolesScreen />);
    expect(document.querySelector('[data-role-worker-live="false"]')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Backend Engineer #9/ }));
    expect(state.go).not.toHaveBeenCalled();
    expect(document.querySelector('[data-role-worker="a9"] [data-worker-feed]')).not.toBeNull();
    expect(screen.getByRole('separator', { name: 'Resize trace pane' })).toBeInTheDocument();
  });

  it('renders the hire preview from the same function it sends', () => {
    render(<V2RolesScreen />);
    fireEvent.click(screen.getByRole('button', { name: 'Hire a role' }));
    const send = screen.getByRole('button', { name: 'Send to weaver' });
    expect(send).toBeDisabled();
    fireEvent.change(screen.getByLabelText('What should this role own?'), { target: { value: 'Own the migrations.' } });
    expect(screen.getByText((_, el) => el?.tagName === 'PRE' && el.textContent === '/hire-role project=api\n\nOwn the migrations.')).toBeInTheDocument();
    fireEvent.click(send);
    expect(state.post).toHaveBeenCalledWith(
      { threadId: 't1', body: buildHireRequest('api', 'Own the migrations.') },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
  });

  it('posts the hire request to the thread the chat would open when several exist', () => {
    state.threads = [
      { id: 't_recent', agentId: 'weaver1' },
      { id: 't_older', agentId: 'weaver1' },
    ];
    render(<V2RolesScreen />);
    fireEvent.click(screen.getByRole('button', { name: 'Hire a role' }));
    fireEvent.change(screen.getByLabelText('What should this role own?'), { target: { value: 'Own the migrations.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send to weaver' }));
    expect(state.post).toHaveBeenCalledWith(
      { threadId: 't_recent', body: buildHireRequest('api', 'Own the migrations.') },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
  });

  it('keeps the modal open with the error when the post fails', () => {
    state.post.mockImplementation((_v: unknown, opts?: { onError?: (e: Error) => void }) => opts?.onError?.(new Error('nope')));
    render(<V2RolesScreen />);
    fireEvent.click(screen.getByRole('button', { name: 'Hire a role' }));
    fireEvent.change(screen.getByLabelText('What should this role own?'), { target: { value: 'Own the migrations.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send to weaver' }));
    expect(screen.getByText('The request was not sent: nope')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send to weaver' })).toBeInTheDocument();
  });

  it('shows an error when creating the thread fails', async () => {
    state.threads = [];
    state.createThread.mockRejectedValue(new Error('no thread'));
    render(<V2RolesScreen />);
    fireEvent.click(screen.getByRole('button', { name: 'Hire a role' }));
    fireEvent.change(screen.getByLabelText('What should this role own?'), { target: { value: 'Own the migrations.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send to weaver' }));
    expect(await screen.findByText('The request was not sent: no thread')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send to weaver' })).toBeInTheDocument();
  });

  it('disables Send while the hire request is in flight', () => {
    state.postPending = true;
    render(<V2RolesScreen />);
    fireEvent.click(screen.getByRole('button', { name: 'Hire a role' }));
    fireEvent.change(screen.getByLabelText('What should this role own?'), { target: { value: 'Own the migrations.' } });
    expect(screen.getByRole('button', { name: 'Send to weaver' })).toBeDisabled();
  });

  it('pauses and resumes a role from the overflow menu', () => {
    state.roles = [role({ id: 'r1', projectId: 'p1', name: 'Backend Engineer', status: 'active' })];
    render(<V2RolesScreen />);
    fireEvent.click(screen.getByRole('button', { name: 'Actions for Backend Engineer' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Pause' }));
    expect(state.roleAction).toHaveBeenCalledWith({ id: 'r1', action: 'pause', reason: 'paused from the V2 Roles page' });
  });

  it('resumes a paused role from the overflow menu', () => {
    state.roles = [role({ id: 'r1', projectId: 'p1', name: 'Backend Engineer', status: 'paused' })];
    render(<V2RolesScreen />);
    fireEvent.click(screen.getByRole('button', { name: 'Actions for Backend Engineer' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Resume' }));
    expect(state.roleAction).toHaveBeenCalledWith({ id: 'r1', action: 'resume', reason: 'resumed from the V2 Roles page' });
  });

  it('shows a failed role action instead of swallowing it', () => {
    state.roleActionError = true;
    state.roles = [role({ id: 'r1', projectId: 'p1', name: 'Backend Engineer' })];
    render(<V2RolesScreen />);
    expect(screen.getByText('The role was not changed: nope')).toBeInTheDocument();
  });

  it('edits the charter, rolls back a revision and changes max workers in the drawer', () => {
    state.roles = [role({ id: 'r1', projectId: 'p1', name: 'Backend Engineer', maxWorkers: 4 })];
    state.roleDetail = {
      role: role({ id: 'r1', projectId: 'p1', name: 'Backend Engineer', maxWorkers: 4, specRevision: 2 }),
      charter: 'Own the API.',
      revisions: [
        { revision: 2, createdAt: '2026-09-02T09:00:00.000Z', reason: 'tightened the scope' },
        { revision: 1, createdAt: '2026-09-01T09:00:00.000Z', reason: null },
      ],
      workers: [],
    };
    render(<V2RolesScreen />);
    fireEvent.click(screen.getByRole('button', { name: 'Charter' }));

    fireEvent.change(screen.getByLabelText('Charter'), { target: { value: 'Own the API and its migrations.' } });
    fireEvent.change(screen.getByLabelText('Reason for the charter change'), { target: { value: 'cover migrations' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save charter' }));
    expect(state.putCharter).toHaveBeenCalledWith({ id: 'r1', charter: 'Own the API and its migrations.', reason: 'cover migrations' });

    fireEvent.click(screen.getAllByRole('button', { name: 'Roll back' })[0]!);
    expect(state.rollback).toHaveBeenCalledWith({ id: 'r1', revision: 2 });

    fireEvent.change(screen.getByLabelText('Max workers'), { target: { value: '6' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(state.updateRole).toHaveBeenCalledWith({ id: 'r1', patch: { maxWorkers: 6 }, reason: 'max workers set from the V2 Roles page' });
  });

  it('starts a session against a role and opens the new worker', () => {
    state.roles = [role({ id: 'r1', projectId: 'p1', name: 'Backend Engineer' })];
    state.startSession.mockImplementation((_body: unknown, opts: { onSuccess: (a: { id: string }) => void }) => opts.onSuccess({ id: 'a_new' }));
    render(<V2RolesScreen />);
    fireEvent.click(screen.getByRole('button', { name: 'Start session' }));
    fireEvent.change(screen.getByLabelText('Session title'), { target: { value: 'Rotate credentials' } });
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    expect(state.startSession).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: 'p1', roleId: 'r1', kind: 'task', title: 'Rotate credentials' }),
      expect.anything(),
    );
    expect(state.go).toHaveBeenCalledWith('/w/$ws/workers/$workerId', { params: { ws: 'ws1', workerId: 'a_new' } });
  });

  it('shows the error when starting a session fails', () => {
    state.roles = [role({ id: 'r1', projectId: 'p1', name: 'Backend Engineer' })];
    state.startSessionError = 'boom';
    render(<V2RolesScreen />);
    fireEvent.click(screen.getByRole('button', { name: 'Start session' }));
    expect(screen.getByText('The session was not started: boom')).toBeInTheDocument();
  });

  it('filters to projects with workers when Has workers is on', () => {
    state.workers = [agent({ id: 'a1', roleId: 'r1', status: 'running' })];
    render(<V2RolesScreen />);
    fireEvent.click(screen.getByRole('button', { name: 'Has workers' }));
    expect(screen.getByText('Backend Engineer')).toBeInTheDocument();
    expect(screen.queryByText('Codebase Scout')).toBeNull();
  });
});
