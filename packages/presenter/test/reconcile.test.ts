import { describe, expect, it, vi } from 'vitest';
import type { WorkspaceEvent } from '@agent-conductor/shared';
import type { AgentPresence, AgentView, SurfaceAdapter, SurfaceHandle } from '@agent-conductor/surface-sdk';
import { buildSurfaceContext, createReconciler, pickSurfaceKind, presenceOf, startPresenter } from '../src/index.js';
import { createMemoryHandleStore } from '../src/store.js';
import { toAgentView } from '../src/views.js';
import type { DesiredPresentation, PresenterApi, StoredHandle } from '../src/types.js';

const worker = (id: string, over: Partial<AgentView> = {}): AgentView => ({
  agentId: id, workspaceId: 'acme', name: `worker ${id}`, kind: 'worker',
  projectId: 'web', ticketIdentifier: 'ACME-42', roleName: 'frontend', status: 'running', uiStatus: 'working', ...over,
});

interface FakeSurface extends SurfaceAdapter {
  calls: Array<{ op: string; agentId?: string; reason?: string; cfg?: Record<string, unknown> }>;
  alive: Set<string>;
}

function fakeSurface(kind = 'fake', opts: { verify?: (h: SurfaceHandle) => boolean } = {}): FakeSurface {
  const calls: FakeSurface['calls'] = [];
  const alive = new Set<string>();
  return {
    kind,
    calls,
    alive,
    async detect() { return { available: true }; },
    configSchema() { return { type: 'object' }; },
    async ensureAgentView(agent, cfg) {
      calls.push({ op: 'ensure', agentId: agent.agentId, cfg });
      alive.add(agent.agentId);
      return { kind, agentId: agent.agentId } as SurfaceHandle;
    },
    async ensureConductorView(cfg) {
      calls.push({ op: 'ensureConductor', agentId: 'c-1', cfg });
      alive.add('c-1');
      return { kind, agentId: 'c-1' } as SurfaceHandle;
    },
    async updateAgentView(handle, state: AgentPresence) {
      calls.push({ op: `update:${state.uiStatus}`, agentId: (handle as { agentId: string }).agentId });
    },
    async focusAgentView(handle) { calls.push({ op: 'focus', agentId: (handle as { agentId: string }).agentId }); },
    async closeAgentView(handle, reason) {
      const agentId = (handle as { agentId: string }).agentId;
      calls.push({ op: 'close', agentId, reason });
      alive.delete(agentId);
    },
    async layout(handles, cfg) { calls.push({ op: 'layout', cfg, agentId: String(handles.length) }); },
    async verify(handle) {
      const agentId = (handle as { agentId: string }).agentId;
      return opts.verify ? opts.verify(handle) : alive.has(agentId);
    },
  };
}

function fakeApi(desired: DesiredPresentation): PresenterApi & { emit(ev: Partial<WorkspaceEvent>): void; puts: StoredHandle[][]; desired: DesiredPresentation } {
  const state = { desired, handlers: null as null | { onEvent(ev: WorkspaceEvent): void }, puts: [] as StoredHandle[][] };
  return {
    get desired() { return state.desired; },
    set desired(next: DesiredPresentation) { state.desired = next; },
    puts: state.puts,
    async getDesired() { return state.desired; },
    async putHandles(_id, handles) { state.puts.push(handles); },
    subscribe(handlers) { state.handlers = handlers; return { close() { state.handlers = null; } }; },
    emit(ev) {
      state.handlers?.onEvent({ seq: 1, workspaceId: 'acme', type: 'worker.status', entityType: 'agent', entityId: 'w-1', payload: {}, createdAt: '', ...ev } as WorkspaceEvent);
    },
  };
}

const ctxOf = (log = vi.fn()) =>
  buildSurfaceContext({ workspaceId: 'acme', apiUrl: 'http://127.0.0.1:7433', token: 'tok', block: { terminal: 'foot' }, log });

describe('surface context', () => {
  it('points attach and chat at this daemon and carries the env for spawned terminals', () => {
    const ctx = ctxOf();
    expect(ctx.attachCommand('w-1')).toEqual(['conductor', 'attach', 'w-1', '--workspace', 'acme', '--url', 'http://127.0.0.1:7433']);
    expect(ctx.chatCommand()).toEqual(['conductor', 'chat', '--workspace', 'acme', '--url', 'http://127.0.0.1:7433']);
    expect(ctx.env).toEqual({ AC_API_URL: 'http://127.0.0.1:7433', AC_TOKEN: 'tok', AC_WORKSPACE: 'acme' });
    expect(ctx.terminal()).toMatchObject({ cmd: 'foot', classFlag: '-a', execFlag: '-e' });
  });

  it('builds the presence title surfaces put in window names', () => {
    expect(presenceOf(worker('w-1'))).toEqual({ status: 'running', uiStatus: 'working', title: 'frontend · ACME-42 · working' });
  });

  it('picks the surface from the config unless overridden', () => {
    expect(pickSurfaceKind({ default: 'tmux' })).toBe('tmux');
    expect(pickSurfaceKind({ default: 'tmux', workers: { surface: 'hyprland' } })).toBe('hyprland');
    expect(pickSurfaceKind({ default: 'tmux' }, 'herdr')).toBe('herdr');
    expect(pickSurfaceKind({})).toBe('headless');
  });

  it('normalizes worker payloads into AgentViews', () => {
    expect(toAgentView({ id: 'w-2', name: 'x', kind: 'worker', status: 'running', ticket: { identifier: 'ACME-9' } }, 'acme'))
      .toMatchObject({ agentId: 'w-2', ticketIdentifier: 'ACME-9', uiStatus: 'working' });
    expect(toAgentView({ worker: { id: 'w-3', status: 'paused' } }, 'acme')).toMatchObject({ agentId: 'w-3', uiStatus: 'paused' });
    expect(toAgentView({ nothing: true }, 'acme')).toBeNull();
  });
});

describe('reconciler', () => {
  const desired = (workers: AgentView[], config: DesiredPresentation['config'] = { workers: { surface: 'fake' } }): DesiredPresentation =>
    ({ weaver: null, workers, config });

  it('ensures a view per live worker and lays out when configured', async () => {
    const surface = fakeSurface();
    const r = createReconciler({ surface, ctx: ctxOf(), log: vi.fn() });
    await r.sync(desired([worker('w-1'), worker('w-2'), worker('w-3', { status: 'retired' })], { workers: { surface: 'fake', layout: 'grid' } }));
    expect(surface.calls.filter((c) => c.op === 'ensure').map((c) => c.agentId)).toEqual(['w-1', 'w-2']);
    expect(surface.calls.some((c) => c.op === 'layout')).toBe(true);
    expect(r.handles().map((h) => h.agentId)).toEqual(['w-1', 'w-2']);
  });

  it('ensures the weaver through its own hook when a weaver block exists', async () => {
    const surface = fakeSurface();
    const r = createReconciler({ surface, ctx: ctxOf(), log: vi.fn() });
    await r.sync({
      weaver: worker('c-1', { kind: 'weaver', ticketIdentifier: null }),
      workers: [],
      config: { workers: { surface: 'fake' }, weaver: { surface: 'fake', terminal: 'foot' } },
    });
    expect(surface.calls[0]).toMatchObject({ op: 'ensureConductor', cfg: { terminal: 'foot' } });
  });

  it('updates on status and closes only after the grace period', async () => {
    let clock = 1_000;
    const surface = fakeSurface();
    const r = createReconciler({ surface, ctx: ctxOf(), log: vi.fn(), keepClosedForMs: 120_000, now: () => clock });
    await r.sync(desired([worker('w-1')]));
    await r.update(worker('w-1', { status: 'paused', uiStatus: 'paused' }));
    expect(surface.calls.some((c) => c.op === 'update:paused')).toBe(true);

    r.retire('w-1');
    await r.sweep();
    expect(surface.calls.some((c) => c.op === 'close')).toBe(false);
    expect(r.pendingCloses()).toEqual([{ agentId: 'w-1', dueAt: 121_000 }]);

    clock += 120_001;
    await r.sweep();
    expect(surface.calls.filter((c) => c.op === 'close')).toEqual([{ op: 'close', agentId: 'w-1', reason: 'retired' }]);
    expect(r.handles()).toEqual([]);
  });

  it('cancels a pending close when the worker comes back', async () => {
    let clock = 0;
    const surface = fakeSurface();
    const r = createReconciler({ surface, ctx: ctxOf(), log: vi.fn(), keepClosedForMs: 100, now: () => clock });
    await r.sync(desired([worker('w-1')]));
    r.retire('w-1');
    await r.ensure(worker('w-1'));
    clock += 1000;
    await r.sweep();
    expect(surface.calls.some((c) => c.op === 'close')).toBe(false);
  });

  it('retires views that vanished from the desired set', async () => {
    const surface = fakeSurface();
    const r = createReconciler({ surface, ctx: ctxOf(), log: vi.fn(), keepClosedForMs: 0 });
    await r.sync(desired([worker('w-1'), worker('w-2')]));
    await r.sync(desired([worker('w-1')]));
    await r.sweep();
    expect(surface.calls.filter((c) => c.op === 'close').map((c) => c.agentId)).toEqual(['w-2']);
  });

  it('never lets a surface failure escape', async () => {
    const log = vi.fn();
    const surface = fakeSurface();
    surface.ensureAgentView = async () => { throw new Error('hyprctl exploded'); };
    const r = createReconciler({ surface, ctx: ctxOf(), log });
    await expect(r.sync(desired([worker('w-1')]))).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledWith('warn', 'surface ensure failed', expect.objectContaining({ agentId: 'w-1' }));
    expect(r.handles()).toEqual([]);
  });

  it('keeps verified handles on restore and recreates the missing ones', async () => {
    const surface = fakeSurface();
    surface.alive.add('w-1');
    const stored: StoredHandle[] = [
      { agentId: 'w-1', surfaceKind: 'fake', handle: { kind: 'fake', agentId: 'w-1' }, view: worker('w-1') },
      { agentId: 'w-2', surfaceKind: 'fake', handle: { kind: 'fake', agentId: 'w-2' }, view: worker('w-2') },
      { agentId: 'w-3', surfaceKind: 'other', handle: { kind: 'other' }, view: worker('w-3') },
    ];
    const r = createReconciler({ surface, ctx: ctxOf(), log: vi.fn() });
    await r.restore(stored);
    expect(surface.calls.filter((c) => c.op === 'ensure').map((c) => c.agentId)).toEqual(['w-2']);
    expect(surface.calls.find((c) => c.op === 'ensure')?.cfg).toMatchObject({ reconcile: true });
    expect(r.handles().map((h) => h.agentId).sort()).toEqual(['w-1', 'w-2']);
  });
});

describe('startPresenter', () => {
  const baseDesired = (): DesiredPresentation => ({ weaver: null, workers: [worker('w-1')], config: { workers: { surface: 'fake' } } });

  const start = async (api: ReturnType<typeof fakeApi>, surface: FakeSurface, over: Record<string, unknown> = {}) =>
    startPresenter({
      apiUrl: 'http://127.0.0.1:7433', token: 'tok', workspaceId: 'acme', log: vi.fn(),
      api, surfaces: { fake: surface }, store: createMemoryHandleStore(), installSignalHandlers: false, ...over,
    });

  it('reconciles the desired presentation and persists handles', async () => {
    const surface = fakeSurface();
    const api = fakeApi(baseDesired());
    const store = createMemoryHandleStore();
    const presenter = await start(api, surface, { store });
    expect(surface.calls.filter((c) => c.op === 'ensure').map((c) => c.agentId)).toEqual(['w-1']);
    expect(presenter.handles().map((h) => h.agentId)).toEqual(['w-1']);
    await vi.waitFor(() => expect(api.puts.at(-1)?.map((h) => h.agentId)).toEqual(['w-1']));
    expect(store.current().map((h) => h.agentId)).toEqual(['w-1']);
    await presenter.stop();
  });

  it('follows worker.spawned, worker.status and worker.retired', async () => {
    const surface = fakeSurface();
    const api = fakeApi(baseDesired());
    const presenter = await start(api, surface, { keepClosedForMs: 0, sweepIntervalMs: 5 });

    // Events are only a nudge: the presenter re-reads the daemon's desired list, which is the truth.
    api.desired = { ...api.desired, workers: [...api.desired.workers, worker('w-2')] };
    api.emit({ type: 'worker.spawned', entityId: 'w-2', payload: worker('w-2') });
    await vi.waitFor(() => expect(surface.calls.some((c) => c.op === 'ensure' && c.agentId === 'w-2')).toBe(true), { timeout: 4000 });

    api.desired = { ...api.desired, workers: api.desired.workers.map((w) => (w.agentId === 'w-2' ? worker('w-2', { status: 'paused', uiStatus: 'paused' }) : w)) };
    api.emit({ type: 'worker.status', entityId: 'w-2', payload: worker('w-2', { status: 'paused', uiStatus: 'paused' }) });
    await vi.waitFor(() => expect(surface.calls.some((c) => c.op === 'update:paused')).toBe(true), { timeout: 4000 });

    api.desired = { ...api.desired, workers: api.desired.workers.filter((w) => w.agentId !== 'w-2') };
    api.emit({ type: 'worker.retired', entityId: 'w-2', payload: { id: 'w-2' } });
    await vi.waitFor(() => expect(surface.calls.some((c) => c.op === 'close' && c.agentId === 'w-2')).toBe(true), { timeout: 4000 });
    await presenter.stop();
  });

  it('re-syncs on presentation.updated and drops views when the surface changes', async () => {
    const surface = fakeSurface();
    const api = fakeApi(baseDesired());
    const presenter = await start(api, surface);

    api.desired = { weaver: null, workers: [worker('w-1'), worker('w-9')], config: { workers: { surface: 'fake' } } };
    api.emit({ type: 'presentation.updated', entityId: 'acme', payload: {} });
    await vi.waitFor(() => expect(surface.calls.some((c) => c.op === 'ensure' && c.agentId === 'w-9')).toBe(true));

    api.desired = { weaver: null, workers: [worker('w-1')], config: { workers: { surface: 'other' } } };
    api.emit({ type: 'presentation.updated', entityId: 'acme', payload: {} });
    await vi.waitFor(() => expect(surface.calls.some((c) => c.op === 'close' && c.reason === 'presentation_changed')).toBe(true));
    await presenter.stop();
  });

  it('leaves windows in place when it stops', async () => {
    const surface = fakeSurface();
    const presenter = await start(fakeApi(baseDesired()), surface);
    await presenter.stop();
    expect(surface.calls.some((c) => c.op === 'close')).toBe(false);
  });

  it('refuses an unknown surface', async () => {
    const api = fakeApi(baseDesired());
    await expect(
      startPresenter({
        apiUrl: 'http://x', token: 't', workspaceId: 'acme', log: vi.fn(), api,
        surfaces: { fake: fakeSurface() }, store: createMemoryHandleStore(), installSignalHandlers: false, surface: 'nope',
      }),
    ).rejects.toThrow(/unknown surface "nope"/);
  });
});
