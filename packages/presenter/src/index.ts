import { hostname } from 'node:os';
import type { WorkspaceEvent } from '@agent-conductor/shared';
import type { SurfaceAdapter, SurfaceContext } from '@agent-conductor/surface-sdk';
import headless from '@agent-conductor/surface-headless';
import tmux from '@agent-conductor/surface-tmux';
import herdr from '@agent-conductor/surface-herdr';
import hyprland from '@agent-conductor/surface-hyprland';
import { createHttpPresenterApi } from './api.js';
import { createReconciler, DEFAULT_KEEP_CLOSED_FOR_MS, type Reconciler } from './reconcile.js';
import { createFileHandleStore, defaultHandleStorePath } from './store.js';
import { resolveTerminal, type TerminalSpec } from './terminal.js';
import { agentIdOf, toAgentView } from './views.js';
import type { DesiredPresentation, HandleStore, LogFn, PresenterApi, PresentationBlockView, StoredHandle } from './types.js';

export * from './api.js';
export * from './reconcile.js';
export * from './store.js';
export * from './terminal.js';
export * from './types.js';
export * from './views.js';

/** The four built-in surfaces; plugins can add more through `surfaces`. */
export function builtinSurfaces(): Record<string, SurfaceAdapter> {
  return { headless, tmux, herdr, hyprland };
}

export interface StartPresenterOptions {
  apiUrl: string;
  token: string;
  workspaceId: string;
  /** Override the surface from the workspace config. */
  surface?: string;
  presenterId?: string;
  /** How to invoke the conductor CLI on this machine (default ['conductor']); the CLI passes its own executable so source checkouts work. */
  ocCommand?: string[];
  log: LogFn;
  keepClosedForMs?: number;
  sweepIntervalMs?: number;
  /** Injected for tests. */
  api?: PresenterApi;
  surfaces?: Record<string, SurfaceAdapter>;
  store?: HandleStore;
  installSignalHandlers?: boolean;
  now?(): number;
}

export interface RunningPresenter {
  readonly presenterId: string;
  readonly surfaceKind: string;
  /** Refetch the desired presentation and re-apply it (recreating views the human closed). */
  reconcile(): Promise<void>;
  handles(): StoredHandle[];
  /** Stops watching. Windows are deliberately left in place. */
  stop(): Promise<void>;
}

const sanitize = (s: string): string => s.replace(/[^A-Za-z0-9_.-]+/g, '-');

export function defaultPresenterId(surfaceKind: string): string {
  return sanitize(`${hostname() || 'local'}-${surfaceKind}`);
}

export function pickSurfaceKind(config: DesiredPresentation['config'], override?: string): string {
  return override ?? config.workers?.surface ?? config.default ?? 'headless';
}

export interface BuildContextOptions {
  ocCommand?: string[];
  workspaceId: string;
  apiUrl: string;
  token: string;
  block: PresentationBlockView;
  log: LogFn;
  terminal?: TerminalSpec | null;
}

/**
 * The SurfaceContext handed to adapters: how a terminal attaches to *this* daemon, and
 * the env the spawned terminal needs to reach it (surfaces pass it through where they can).
 */
export function buildSurfaceContext(opts: BuildContextOptions): SurfaceContext & { env: Record<string, string> } {
  const configured = typeof opts.block.terminal === 'string' ? opts.block.terminal : null;
  const terminal = opts.terminal !== undefined ? opts.terminal : resolveTerminal({ configured });
  const env = { AC_API_URL: opts.apiUrl, AC_TOKEN: opts.token, AC_WORKSPACE: opts.workspaceId };
  const conductor = opts.ocCommand && opts.ocCommand.length ? opts.ocCommand : ['conductor'];
  const base = (agentId: string): string[] => [...conductor, 'attach', agentId, '--workspace', opts.workspaceId, '--url', opts.apiUrl];
  return {
    workspaceId: opts.workspaceId,
    daemonUrl: opts.apiUrl,
    env,
    attachCommand: (agentId: string) => base(agentId),
    chatCommand: () => [...conductor, 'chat', '--workspace', opts.workspaceId, '--url', opts.apiUrl],
    terminal: () => terminal,
    log: opts.log,
  };
}

export async function startPresenter(opts: StartPresenterOptions): Promise<RunningPresenter> {
  const log = opts.log;
  const api = opts.api ?? createHttpPresenterApi({ apiUrl: opts.apiUrl, token: opts.token, workspaceId: opts.workspaceId });
  const registry = opts.surfaces ?? builtinSurfaces();

  let desired = await api.getDesired();
  const surfaceKind = pickSurfaceKind(desired.config, opts.surface);
  const surface = registry[surfaceKind];
  if (!surface) throw new Error(`presenter: unknown surface "${surfaceKind}" (have: ${Object.keys(registry).sort().join(', ')})`);

  const detection = await surface.detect().catch((err: unknown) => ({ available: false, notes: (err as Error)?.message }));
  if (!detection.available) log('warn', 'surface reports it is not available', { surface: surfaceKind, notes: detection.notes });

  const presenterId = opts.presenterId ?? defaultPresenterId(surfaceKind);
  const store = opts.store ?? createFileHandleStore(defaultHandleStorePath(opts.workspaceId, presenterId));

  const block: PresentationBlockView = desired.config.workers ?? desired.config.conductor ?? {};
  const ctx = buildSurfaceContext({ workspaceId: opts.workspaceId, apiUrl: opts.apiUrl, token: opts.token, block, log, ocCommand: opts.ocCommand });
  if (!ctx.terminal() && (surfaceKind === 'hyprland' || block.terminal)) {
    log('warn', 'no terminal emulator resolved; set presentation.<block>.terminal, $TERMINAL, or install xdg-terminal-exec', { surface: surfaceKind });
  }

  let persisting: Promise<void> = Promise.resolve();
  const persist = (handles: StoredHandle[]): void => {
    persisting = persisting
      .then(() => store.save(handles))
      .then(() => api.putHandles(presenterId, handles))
      .catch((err: unknown) => log('debug', 'persisting surface handles failed', { error: (err as Error)?.message }));
  };

  const reconciler: Reconciler = createReconciler({
    surface,
    ctx,
    log,
    keepClosedForMs: opts.keepClosedForMs ?? DEFAULT_KEEP_CLOSED_FOR_MS,
    ...(opts.now ? { now: opts.now } : {}),
    onChange: persist,
  });

  const liveAgentIds = new Set<string>([...desired.workers.filter((w) => w.status !== 'retired').map((w) => w.agentId), ...(desired.conductor ? [desired.conductor.agentId] : [])]);
  await reconciler.restore((await store.load()).filter((h) => liveAgentIds.has(h.agentId)));
  await reconciler.sync(desired);

  let resyncTimer: ReturnType<typeof setTimeout> | null = null;
  const scheduleResync = (): void => {
    if (resyncTimer) return;
    resyncTimer = setTimeout(() => {
      resyncTimer = null;
      void (async () => {
        try { desired = await api.getDesired(); await reconciler.sync(desired); }
        catch (err) { log('warn', 'resync failed', { error: (err as Error)?.message }); }
      })();
    }, 400);
  };

  const onEvent = (ev: WorkspaceEvent): void => {
    void (async () => {
      try {
        switch (ev.type) {
          case 'worker.spawned':
          case 'worker.status':
          case 'worker.stalled':
          case 'worker.retired': {
            // Never trust event payloads (they may be replays); the daemon's desired list is the truth.
            scheduleResync();
            break;
          }
          case 'presentation.updated': {
            desired = await api.getDesired();
            const next = pickSurfaceKind(desired.config, opts.surface);
            if (next !== surfaceKind) {
              log('info', 'presentation surface changed; closing views owned by the old surface', { from: surfaceKind, to: next });
              await reconciler.closeAll('presentation_changed');
              break;
            }
            await reconciler.sync(desired);
            break;
          }
          default:
            break;
        }
      } catch (err) {
        log('warn', 'presenter failed to handle event', { type: ev.type, error: (err as Error)?.message });
      }
    })();
  };

  const subscription = api.subscribe({
    onEvent,
    onError: (err) => log('debug', 'presenter event stream error (will reconnect)', { error: (err as Error)?.message ?? String(err) }),
  });

  const sweepInterval = opts.sweepIntervalMs ?? 10_000;
  const timer = setInterval(() => { void reconciler.sweep(); }, sweepInterval);
  timer.unref?.();

  let stopped = false;
  let signalHandler: (() => void) | null = null;
  const stop = async (): Promise<void> => {
    if (stopped) return;
    stopped = true;
    clearInterval(timer);
    subscription.close();
    // Windows are the human's; never kill them on shutdown.
    await persisting;
    if (signalHandler) {
      process.off('SIGINT', signalHandler);
      process.off('SIGTERM', signalHandler);
    }
    log('info', 'presenter stopped; terminal windows left in place', { presenterId });
  };

  if (opts.installSignalHandlers !== false) {
    signalHandler = (): void => { void stop(); };
    process.on('SIGINT', signalHandler);
    process.on('SIGTERM', signalHandler);
  }

  log('info', 'presenter started', { presenterId, surface: surfaceKind, workers: desired.workers.length });

  return {
    presenterId,
    surfaceKind,
    async reconcile() {
      desired = await api.getDesired();
      await reconciler.sync(desired, { force: true });
      await reconciler.sweep();
    },
    handles: () => reconciler.handles(),
    stop,
  };
}
