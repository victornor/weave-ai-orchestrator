import type { AgentPresence, AgentView, SurfaceAdapter, SurfaceContext, SurfaceHandle } from '@agent-conductor/surface-sdk';
import type { DesiredPresentation, LogFn, PresentationBlockView, StoredHandle } from './types.js';

export const DEFAULT_KEEP_CLOSED_FOR_MS = 120_000;

export function presenceOf(view: AgentView): AgentPresence {
  const label = [view.roleName ?? view.name, view.ticketIdentifier, view.uiStatus].filter(Boolean).join(' · ');
  return { status: view.status, uiStatus: view.uiStatus, title: label };
}

export interface ReconcilerOptions {
  surface: SurfaceAdapter;
  ctx: SurfaceContext;
  log: LogFn;
  keepClosedForMs?: number;
  now?(): number;
  onChange?(handles: StoredHandle[]): void;
}

interface Entry { view: AgentView; handle: SurfaceHandle }

export interface Reconciler {
  readonly surfaceKind: string;
  sync(desired: DesiredPresentation, opts?: { force?: boolean }): Promise<void>;
  ensure(view: AgentView, opts?: { force?: boolean }): Promise<void>;
  update(view: AgentView): Promise<void>;
  retire(agentId: string): void;
  sweep(): Promise<void>;
  focus(agentId: string): Promise<void>;
  restore(stored: StoredHandle[]): Promise<void>;
  closeAll(reason: 'retired' | 'presentation_changed'): Promise<void>;
  handles(): StoredHandle[];
  pendingCloses(): Array<{ agentId: string; dueAt: number }>;
}

/**
 * Surface-agnostic reconciliation between the daemon's desired presentation and the
 * views this presenter owns. Surface failures are logged, never thrown at the caller.
 */
export function createReconciler(opts: ReconcilerOptions): Reconciler {
  const { surface, ctx, log } = opts;
  const now = opts.now ?? (() => Date.now());
  const keepClosedForMs = opts.keepClosedForMs ?? DEFAULT_KEEP_CLOSED_FOR_MS;
  const entries = new Map<string, Entry>();
  const closing = new Map<string, number>();
  let workersCfg: PresentationBlockView = {};
  let conductorCfg: PresentationBlockView | null = null;

  const changed = (): void => opts.onChange?.(handles());

  const handles = (): StoredHandle[] =>
    [...entries.entries()].map(([agentId, e]) => ({ agentId, surfaceKind: surface.kind, handle: e.handle, view: e.view, kindOfAgent: e.view.kind }));

  const cfgFor = (view: AgentView): Record<string, unknown> =>
    (view.kind === 'weaver' ? conductorCfg ?? workersCfg : workersCfg) as Record<string, unknown>;

  const ensure = async (view: AgentView, o: { force?: boolean } = {}): Promise<void> => {
    closing.delete(view.agentId);
    const existing = entries.get(view.agentId);
    try {
      const cfg = { ...cfgFor(view), ...(o.force ? { reconcile: true } : {}) };
      const handle = view.kind === 'weaver' && surface.ensureConductorView
        ? await surface.ensureConductorView(cfg, ctx)
        : await surface.ensureAgentView(view, cfg, ctx, existing?.handle);
      entries.set(view.agentId, { view, handle });
      changed();
    } catch (err) {
      log('warn', 'surface ensure failed', { agentId: view.agentId, surface: surface.kind, error: (err as Error)?.message });
    }
  };

  const update = async (view: AgentView): Promise<void> => {
    const entry = entries.get(view.agentId);
    if (!entry) return ensure(view);
    entry.view = view;
    try {
      await surface.updateAgentView(entry.handle, presenceOf(view), ctx);
      changed();
    } catch (err) {
      log('debug', 'surface update failed', { agentId: view.agentId, error: (err as Error)?.message });
    }
  };

  const close = async (agentId: string, reason: 'retired' | 'presentation_changed'): Promise<void> => {
    const entry = entries.get(agentId);
    closing.delete(agentId);
    if (!entry) return;
    try {
      await surface.closeAgentView(entry.handle, reason, ctx);
    } catch (err) {
      log('debug', 'surface close failed', { agentId, error: (err as Error)?.message });
    }
    entries.delete(agentId);
    changed();
  };

  const retire = (agentId: string): void => {
    if (!entries.has(agentId) || closing.has(agentId)) return;
    // Grace period so the human can still read the finished worker's last screen.
    closing.set(agentId, now() + keepClosedForMs);
  };

  const sweep = async (): Promise<void> => {
    const due = [...closing.entries()].filter(([, at]) => at <= now()).map(([id]) => id);
    for (const agentId of due) await close(agentId, 'retired');
  };

  const layout = async (): Promise<void> => {
    if (!surface.layout || !workersCfg.layout) return;
    try {
      await surface.layout(handles().map((h) => h.handle), workersCfg as Record<string, unknown>, ctx);
    } catch (err) {
      log('debug', 'surface layout failed', { error: (err as Error)?.message });
    }
  };

  const sync = async (desired: DesiredPresentation, o: { force?: boolean } = {}): Promise<void> => {
    workersCfg = { ...(desired.config.workers ?? {}) };
    conductorCfg = desired.config.weaver ? { ...desired.config.weaver } : null;

    if (desired.weaver && conductorCfg) await ensure(desired.weaver, o);
    const live = desired.workers.filter((w) => w.status !== 'retired');
    for (const worker of live) { if (!o.force && entries.has(worker.agentId)) await update(worker); else await ensure(worker, o); }

    const desiredIds = new Set(live.map((w) => w.agentId));
    if (desired.weaver && conductorCfg) desiredIds.add(desired.weaver.agentId);
    for (const agentId of entries.keys()) if (!desiredIds.has(agentId)) retire(agentId);

    await layout();
  };

  const restore = async (stored: StoredHandle[]): Promise<void> => {
    for (const item of stored) {
      if (item.surfaceKind !== surface.kind) continue;
      let alive = true;
      try {
        alive = surface.verify ? await surface.verify(item.handle, ctx) : true;
      } catch (err) {
        alive = false;
        log('debug', 'surface verify threw', { agentId: item.agentId, error: (err as Error)?.message });
      }
      if (alive && item.view) {
        entries.set(item.agentId, { view: item.view, handle: item.handle });
      } else if (item.view) {
        log('debug', 'stored surface handle is gone; recreating', { agentId: item.agentId });
        await ensure(item.view, { force: true });
      }
    }
    changed();
  };

  return {
    surfaceKind: surface.kind,
    sync,
    ensure,
    update,
    retire,
    sweep,
    async focus(agentId) {
      const entry = entries.get(agentId);
      if (!entry) return;
      try { await surface.focusAgentView(entry.handle, ctx); }
      catch (err) { log('debug', 'surface focus failed', { agentId, error: (err as Error)?.message }); }
    },
    restore,
    async closeAll(reason) {
      for (const agentId of [...entries.keys()]) await close(agentId, reason);
    },
    handles,
    pendingCloses: () => [...closing.entries()].map(([agentId, dueAt]) => ({ agentId, dueAt })),
  };
}
