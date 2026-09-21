/**
 * The daemon process: config, registries, workspaces, two listeners, graceful shutdown.
 * `weave daemon start` execs `bin.js`, which calls `startDaemon()`.
 */
import { createServer as createHttpServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { releaseVersion } from '@weave-ai/release';
import { createAdaptorServer } from '@hono/node-server';
import type { ServerType } from '@hono/node-server';
import { nowIso, openDb } from '@weave-ai/db';
import type { Db } from '@weave-ai/db';
import {
  createRegistries, createCore, createAuthService, createIncidentsService, getLogger, initLogger, workspaceLoader,
  stageWorkspaceImport, importTickets, ensureHostToolPath, startHostToolProbe,
  daemonSecretStore,
  isNamespacedToolName, PLUGIN_ID_RE, PluginDataService, ARTIFACT_KIT_CSS, generateV2PluginCss,
  type Registries, type WorkspaceContext, type PluginRuntime,
} from '@weave-ai/core';
import type { AuthService, CoreServices, IncidentsService } from '@weave-ai/core';
import type { ChannelAdapter, SurfaceAdapter } from '@weave-ai/plugin-sdk';
import type { RuntimeAdapter, RuntimeHost } from '@weave-ai/runtime-sdk';
import type { WeaveAIPlugin, PluginHost, AgentToolDefinition, WorktreeProvider, ForgeAdapter } from '@weave-ai/plugin-sdk';
import {
  OcError, SHUTDOWN_CANCEL_GRACE_MS, SHUTDOWN_DRAIN_GRACE_MS, COMMON_TOOLS, WEAVER_TOOLS, WORKER_ONLY_TOOLS,
  type DaemonConfig, type EventType, type ProviderProfile, type WorkspaceEvent,
} from '@weave-ai/shared';
import { createApp, type WorkspaceAdmin } from './app.js';
import { createUpdateChecker, runningReleaseRoot } from './release-info.js';
import { createUpgradeService } from './upgrade.js';
import { toolContractProvider } from './tool-contract.js';
import { announceRestart, markBooted, observeBoot, recordShutdown, recordStartFailure } from './restart-notice.js';
import { ChannelManager } from './channels.js';
import { WebhookDispatcher } from './webhooks.js';
import { PushDispatcher } from './pushDispatcher.js';
import { ensurePushKeys, type PushKeys } from './vapid.js';
import type { AppDeps, WorkspaceRuntime } from './types.js';

const here = dirname(fileURLToPath(import.meta.url));
const log = getLogger('daemon');

const RUNTIME_PACKAGES = ['@weave-ai/runtime-claude', '@weave-ai/runtime-codex', '@weave-ai/runtime-opencode', '@weave-ai/runtime-gemini', '@weave-ai/runtime-cursor', '@weave-ai/runtime-weave'];
const CHANNEL_PACKAGES = ['@weave-ai/channel-web', '@weave-ai/channel-cli', '@weave-ai/channel-telegram'];
const SURFACE_PACKAGES = ['@weave-ai/surface-headless', '@weave-ai/surface-tmux', '@weave-ai/surface-herdr', '@weave-ai/surface-hyprland'];

export interface StartOptions {
  configDir?: string;
  /** Override the public listen address (`host:port`), e.g. from `weave daemon start --listen`. */
  listen?: string;
  uiDir?: string | null;
  /**
   * VS-143: opt out of isolation for a daemon whose config directory is not the host's plain
   * default — shares the host's runtime credentials and dispatches autonomously, exactly as a
   * daemon at the default config directory does. Default false: isolation is otherwise automatic,
   * with no flag required to get it. See `daemon-isolation/credential-scope` and
   * `daemon-isolation/dispatch-gate`.
   */
  shareHostCredentials?: boolean;
  /**
   * VS-262 test-only seam: override `shutdown()`'s natural-drain and post-cancel grace periods
   * instead of the shipped `SHUTDOWN_DRAIN_GRACE_MS`/`SHUTDOWN_CANCEL_GRACE_MS` constants, so a test
   * can exercise the bounded-then-cancel sequence without waiting real minutes for it.
   */
  shutdownGraceMs?: { drain: number; cancel: number };
}

export interface DaemonHandle {
  publicUrl: string;
  loopbackUrl: string;
  workspaces: Map<string, WorkspaceRuntime>;
  registries: Registries;
  stop(reason?: string): Promise<void>;
}

export const VERSION: string = readVersion();

/**
 * VS-143: a daemon whose config directory is not the host's plain default is isolated by default —
 * no flag required to get the safe behavior. `shareHostCredentials` is the explicit opt-out. Exported
 * standalone so this decision is testable without booting a daemon or touching the real default path.
 */
export function resolveIsolation(configDir: string, shareHostCredentials?: boolean): boolean {
  return !workspaceLoader.isDefaultConfigDir(configDir) && !shareHostCredentials;
}

export async function startDaemon(opts: StartOptions = {}): Promise<DaemonHandle> {
  const configDir = opts.configDir ?? workspaceLoader.configDir();
  const isolated = resolveIsolation(configDir, opts.shareHostCredentials);
  await mkdir(configDir, { recursive: true });
  const daemonCfg = withListen(workspaceLoader.ensureFreshDaemonConfig(configDir), opts.listen);
  initLogger(daemonCfg.logLevel);

  // VS-318: the service manager's PATH is not the user's. Resolve the daemon user's login-shell
  // PATH before any workspace loads or host tool spawns, then keep the detection snapshot fresh so
  // an unavailable tool is visible without anyone probing /api/health.
  try { await ensureHostToolPath(daemonCfg.hostToolPaths); }
  catch (e) { log.warn({ err: String(e) }, 'host tool PATH resolution failed; using the inherited PATH'); }
  const hostToolProbe = startHostToolProbe();

  // Generated once per installation, never written back to daemon.yaml — see vapid.ts and
  // AppDeps.pushKeys for why the private half stays off DaemonConfigSchema entirely.
  const pushKeys = ensurePushKeys(configDir);
  if (pushKeys) daemonCfg.push.vapidPublicKey = pushKeys.publicKey;

  const daemonDb = openDb(join(configDir, 'daemon.sqlite'));
  const releaseRoot = runningReleaseRoot();
  // VS-339: read what the durable lifecycle says about the process this one replaced, before writing
  // anything. `markBooted` happens once the daemon is actually serving, so a failed attempt leaves the
  // previous boot record in place and is reported by the next successful boot.
  const bootObservation = observeBoot(daemonDb, { now: nowIso(), release: releaseRoot, pid: process.pid });
  const auth = createAuthService(daemonDb, daemonCfg);
  const registries = createRegistries();

  const workspaces = new Map<string, WorkspaceRuntime>();
  await registerBuiltins(registries, createRuntimeHost(workspaces, configDir, daemonCfg));
  const { publicUrl, host, port } = resolveUrls(daemonCfg);

  // The loopback listener must exist before workspaces load: its URL goes into every run's env.
  const loopback = await startLoopbackListener();
  // Assigned once the listeners are decided below; the loopback app copies `deps` now, so the hook
  // has to exist before that copy is taken.
  let onOperatorConfigured: (() => void) | null = null;
  const updates = createUpdateChecker({ daemon: daemonCfg, version: VERSION });
  const upgrades = createUpgradeService({
    db: daemonDb, daemon: daemonCfg, configDir, workspaces, updates, version: VERSION, releaseRoot,
    runtimes: () => [...registries.runtimes.keys()],
  });
  const incidents = createIncidentsService(daemonDb);
  const deps: AppDeps = {
    auth, daemon: daemonCfg, workspaces, registries, listener: 'public',
    publicUrl, version: VERSION, uiDir: opts.uiDir ?? defaultUiDir(),
    updates, upgrades, incidents, daemonConfigDir: configDir, pushKeys,
    onOperatorConfigured: () => onOperatorConfigured?.(),
  };
  loopback.setDeps({ ...deps, listener: 'loopback' });

  const admin = makeAdmin(configDir, isolated, daemonCfg, registries, workspaces, loopback.url, pushKeys, incidents);
  const registry = workspaceLoader.readRegistry(configDir);
  for (const entry of registry.workspaces) {
    try { await loadWorkspaceInto(workspaces, entry.path, { daemon: daemonCfg, registries, loopbackUrl: loopback.url, daemonConfigDir: configDir, isolated, pushKeys, incidents, ...dirs() }); }
    catch (e) { log.error({ err: e, workspace: entry.id, path: entry.path }, 'workspace failed to load'); }
  }

  // An upgrade record left behind by the process this one replaced: settle it now, before anything can
  // request another one and be told a stale upgrade is still in flight.
  try { upgrades.reconcile(); } catch (e) { log.error({ err: e }, 'upgrade reconciliation failed'); }

  const app = createApp(deps, admin);
  const pidFile = join(configDir, 'daemon.json');
  let publicServer: ServerType | null = null;
  const writePidFile = () => writeFile(pidFile, JSON.stringify({
    pid: process.pid, publicUrl: deps.publicUrl, loopbackUrl: loopback.url, setupRequired: publicServer === null, startedAt: new Date().toISOString(),
  }, null, 2));
  const startPublic = async (): Promise<void> => {
    if (publicServer) return;
    publicServer = await listen(app.fetch as never, { host, port, tls: await tlsOptions(daemonCfg, configDir) });
    if (port === 0) {
      const bound = publicServer.address();
      if (typeof bound === 'object' && bound) deps.publicUrl = publicUrl.replace(/:0$/, `:${bound.port}`);
    }
    log.info({ url: deps.publicUrl, loopback: loopback.url, workspaces: [...new Set([...workspaces.values()].map((w) => w.id))] }, 'daemon listening');
    await writePidFile();
  };

  if (publicListenerAllowed(daemonCfg, auth, host)) {
    try {
      await startPublic();
    } catch (e) {
      // VS-339: a start that cannot bind — the 2026-09-13 `EADDRNOTAVAIL` — is recorded so the next
      // successful boot can report it. The error still fails this boot.
      try { recordStartFailure(daemonDb, e instanceof Error ? e.message : String(e), nowIso()); }
      catch (re) { log.warn({ err: re }, 'could not record the failed start'); }
      throw e;
    }
  } else {
    // PLAN §4.4: never expose an unauthenticated daemon. Hold the public listener; the loopback
    // listener still serves `POST /api/auth/setup`, and `weave daemon set-password` on this host opens it.
    log.warn({ host, loopback: loopback.url }, 'public listener held until an operator password is set: run `weave daemon set-password` on this host');
    onOperatorConfigured = () => { startPublic().catch((e: unknown) => log.error({ err: e }, 'public listener failed to start after setup')); };
    await writePidFile();
  }

  // Now that the daemon is serving again, record this boot (which resets the failed-start count) and
  // tell each workspace what happened. An upgrade has its own announcement (VS-76) and must not get a
  // second notice; a boot on a different release than the previous boot's is an upgrade restart, so
  // only a same-release restart gets the restart notice (VS-339). Not awaited: these are reports about
  // a daemon that is already up, and a slow channel must not hold the boot.
  markBooted(daemonDb, { now: bootObservation.bootAt, release: releaseRoot, pid: process.pid });
  void upgrades.announce().catch((e: unknown) => log.error({ err: e }, 'upgrade announcement failed'));
  if (bootObservation.previousBootAt !== null && bootObservation.previousBootRelease === releaseRoot) {
    void announceRestart({ db: daemonDb, workspaces, observation: bootObservation })
      .catch((e: unknown) => log.error({ err: e }, 'restart announcement failed'));
  }

  const drainGraceMs = opts.shutdownGraceMs?.drain ?? SHUTDOWN_DRAIN_GRACE_MS;
  const cancelGraceMs = opts.shutdownGraceMs?.cancel ?? SHUTDOWN_CANCEL_GRACE_MS;

  let stopping: Promise<void> | null = null;
  const stop = (reason = 'shutdown'): Promise<void> => (stopping ??= shutdown(reason));

  async function shutdown(reason: string): Promise<void> {
    log.info({ reason }, 'daemon shutting down');
    // VS-339: mark every workspace and record the deliberate shutdown before the first await. systemd
    // signals the whole control group, so a runtime child can exit and its turn finalize before the
    // async stop below ever reaches the dispatcher; the synchronous mark is what catches it. The
    // durable record is what lets the next boot tell a deliberate stop from a crash.
    for (const ws of new Set(workspaces.values())) {
      try { ws.services.dispatcher.beginShutdown(reason); }
      catch (e) { log.warn({ err: e, ws: ws.id }, 'could not mark the workspace as shutting down'); }
    }
    try { recordShutdown(daemonDb, reason, nowIso()); }
    catch (e) { log.warn({ err: e }, 'could not record the shutdown'); }
    // VS-262: one workspace at a time, sequentially, would multiply the bounded drain below by the
    // number of registered workspaces — `SHUTDOWN_KILL_GRACE_MS` assumes the per-workspace bound is
    // the *total* bound. Every workspace's own sequence still runs in its documented order; nothing
    // between workspaces is ordered (the db.close() loop below is a separate pass that only starts
    // once every workspace's own sequence has settled), so running them concurrently is safe.
    await Promise.all([...new Set(workspaces.values())].map(async (ws) => {
      await ws.channels?.stop().catch((e: unknown) => log.warn({ err: e, ws: ws.id }, 'channel manager stop failed'));
      await ws.webhooks?.stop().catch((e: unknown) => log.warn({ err: e, ws: ws.id }, 'webhook dispatcher stop failed'));
      try { ws.push?.stop(); } catch (e) { log.warn({ err: e, ws: ws.id }, 'push dispatcher stop failed'); }
      let drained = await ws.services.dispatcher.stop(drainGraceMs).catch((e: unknown) => { log.warn({ err: e, ws: ws.id }, 'dispatcher stop failed'); return false; });
      if (!drained) {
        log.warn({ ws: ws.id }, 'drain grace period exhausted; cancelling running turns');
        await cancelRunningRuns(ws);
        drained = await ws.services.dispatcher.stop(cancelGraceMs).catch(() => false);
        if (!drained) log.warn({ ws: ws.id }, 'a cancelled turn did not finish within the shutdown grace period; continuing to close anyway');
      }
      // Before the db closes below: the ticket service's post-merge follow-up work reads it.
      await ws.services.tickets.stop().catch((e: unknown) => log.warn({ err: e, ws: ws.id }, 'ticket follow-up drain failed'));
      // Same reason: a running job's log tail is only in memory between flushes, and the timer that
      // would write it must not fire against a closed database.
      await ws.services.jobs.stop().catch((e: unknown) => log.warn({ err: e, ws: ws.id }, 'job log drain failed'));
      try { ws.services.supervisor.stop(); } catch (e) { log.warn({ err: e, ws: ws.id }, 'supervisor stop failed'); }
      await cancelRunningRuns(ws);
    }));
    await Promise.all([publicServer ? close(publicServer) : Promise.resolve(), close(loopback.server)]);
    hostToolProbe.stop();
    for (const ws of new Set(workspaces.values())) { try { ws.ctx.db.close(); } catch (e) { log.warn({ err: e }, 'db close failed'); } }
    try { daemonDb.close(); } catch (e) { log.warn({ err: e }, 'daemon db close failed'); }
    await rm(pidFile, { force: true }).catch(() => undefined);
  }

  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(signal, () => { void stop(signal).then(() => process.exit(0)); });
  }

  return { publicUrl: deps.publicUrl, loopbackUrl: loopback.url, workspaces, registries, stop };
}

// ---------- workspaces ----------

async function loadWorkspaceInto(
  workspaces: Map<string, WorkspaceRuntime>,
  path: string,
  opts: { daemon: DaemonConfig; registries: Registries; loopbackUrl: string; skillsDir: string; templatesDir: string; v2ThemeCss: string; daemonConfigDir: string; isolated: boolean; pushKeys: PushKeys | null; incidents?: IncidentsService },
): Promise<WorkspaceRuntime> {
  const ctx: WorkspaceContext = await workspaceLoader.loadWorkspace(path, opts);
  const services: CoreServices = createCore(ctx);
  // VS-579: the run engine files daemon-level incidents it observes itself (a repeated worker
  // memory kill); the server owns the incidents service, so it hands it to this workspace's core.
  if (opts.incidents) services.incidents = opts.incidents;
  // `:ws` in the API is the slug from workspace.yaml; the db id is a ULID. Both resolve.
  const runtime: WorkspaceRuntime = { id: ctx.config.id, ctx, services, channels: null, webhooks: null, push: null };
  workspaces.set(ctx.config.id, runtime);
  if (ctx.workspaceId !== ctx.config.id) workspaces.set(ctx.workspaceId, runtime);

  // VS-334: a plugin's tools, routes and hooks land in this workspace's own `ctx.plugins`, populated
  // fresh by `loadPlugins` below — never the shared `registries`, and never a hooks array any other
  // workspace's load loop could also iterate. Subscribing only after `loadPlugins` returns means a
  // plugin's own hook fires for its own workspace, unlike the pre-VS-334 ordering bug where it never
  // did (subscription ran before that workspace's plugins had registered anything).
  await loadPlugins(ctx, opts.registries);
  // VS-542: the tool surface is fixed once plugins are loaded, so compute each agent kind's contract
  // fingerprint here — before `ensureConductor` (and any spawn) reads it — and record it on sessions.
  ctx.toolContractHash = toolContractProvider(runtime);
  for (const hook of ctx.plugins.hooks) {
    ctx.events.on((ev) => {
      if (hook.events !== '*' && !hook.events.includes(ev.type)) return;
      void hook.handler(ev).catch((e: unknown) => log.warn({ err: e, type: ev.type, plugin: hook.pluginId }, 'plugin hook failed'));
    });
  }

  // A job still `running` belongs to a process that is gone; fail it before anything reads it.
  try { services.jobs.reconcile(); } catch (e) { log.error({ err: e, ws: ctx.workspaceId }, 'job reconciliation failed'); }
  // Asks which runtime the workers setting should hold when the VS-77 migration could not settle it.
  try { services.models.reconcile(); } catch (e) { log.error({ err: e, ws: ctx.workspaceId }, 'model settings reconciliation failed'); }
  await services.workers.ensureConductor().catch((e: unknown) => log.error({ err: e, ws: ctx.workspaceId }, 'ensureConductor failed'));
  try { services.dispatcher.start(); } catch (e) { log.error({ err: e, ws: ctx.workspaceId }, 'dispatcher failed to start'); }
  try { services.supervisor.start(); } catch (e) { log.error({ err: e, ws: ctx.workspaceId }, 'supervisor failed to start'); }

  const channels = new ChannelManager(ctx, services);
  runtime.channels = channels;
  await channels.start().catch((e: unknown) => log.error({ err: e, ws: ctx.workspaceId }, 'channel manager failed to start'));

  const webhooks = new WebhookDispatcher(ctx);
  runtime.webhooks = webhooks;
  try { webhooks.start(); } catch (e) { log.error({ err: e, ws: ctx.workspaceId }, 'webhook dispatcher failed to start'); }

  const push = new PushDispatcher(ctx, services, () => opts.pushKeys);
  runtime.push = push;
  try { push.start(); } catch (e) { log.error({ err: e, ws: ctx.workspaceId }, 'push dispatcher failed to start'); }

  log.info({ workspace: ctx.workspaceId, root: ctx.paths.root }, 'workspace loaded');
  return runtime;
}

/** Exported for `routes/daemon.ts`'s `/api/daemon/drain` to reuse (VS-262) rather than re-implement. */
export async function cancelRunningRuns(ws: WorkspaceRuntime): Promise<void> {
  let running: Array<{ id: string }> = [];
  try { running = ws.services.runs.list({ status: ['running', 'queued'] }).items; } catch { return; }
  for (const run of running) {
    await ws.services.runs.cancel({ kind: 'system', id: null }, run.id, 'interrupt')
      .catch((e: unknown) => log.warn({ err: e, runId: run.id }, 'run cancel failed during shutdown'));
  }
}

function makeAdmin(
  configDir: string, isolated: boolean, daemon: DaemonConfig, registries: Registries, workspaces: Map<string, WorkspaceRuntime>,
  loopbackUrl: string, pushKeys: PushKeys | null, incidents: IncidentsService,
): WorkspaceAdmin {
  const opts = () => ({ daemon, registries, loopbackUrl, daemonConfigDir: configDir, isolated, pushKeys, incidents, ...dirs() });
  const remember = (id: string, path: string): void => {
    const registry = workspaceLoader.readRegistry(configDir);
    if (!registry.workspaces.some((w) => w.id === id)) registry.workspaces.push({ id, path });
    workspaceLoader.writeRegistry(registry, configDir);
  };
  return {
    async register(path) {
      const ws = await loadWorkspaceInto(workspaces, resolve(path), opts());
      remember(ws.id, resolve(path));
      return { id: ws.id, path: resolve(path) };
    },
    async init(input) {
      await workspaceLoader.initWorkspace(resolve(input.path), { id: input.id, name: input.name, ticketPrefix: input.ticketPrefix });
      const ws = await loadWorkspaceInto(workspaces, resolve(input.path), opts());
      remember(ws.id, resolve(input.path));
      return { id: ws.id, path: resolve(input.path) };
    },
    async importPackage(input) {
      const from = resolve(input.path);
      const target = resolve(input.target);
      const staged = stageWorkspaceImport(from, target);
      const already = workspaces.get(staged.workspaceId);
      if (already && already.ctx.paths.root !== target) {
        throw new OcError('conflict', `workspace ${staged.workspaceId} is already loaded from ${already.ctx.paths.root}`);
      }
      const ws = already ?? await loadWorkspaceInto(workspaces, target, opts());
      remember(ws.id, target);
      const tickets = importTickets(ws.services, from);
      log.info({ workspace: ws.id, from, target, ...tickets }, 'workspace package imported');
      return { id: ws.id, path: target, created: staged.created, roles: staged.roles, knowledgeFiles: staged.knowledgeFiles, tickets: tickets.imported, skipped: tickets.skipped };
    },

    async unregister(id) {
      const ws = workspaces.get(id);
      if (ws) {
        await ws.services.dispatcher.stop().catch(() => undefined);
        try { ws.services.supervisor.stop(); } catch { /* ignore */ }
        try { await ws.channels?.stop(); } catch { /* ignore */ }
        try { await ws.webhooks?.stop(); } catch { /* ignore */ }
        try { ws.push?.stop(); } catch { /* ignore */ }
        await ws.services.jobs.stop().catch(() => undefined);
        for (const [key, rt] of [...workspaces.entries()]) if (rt === ws) workspaces.delete(key);
        try { ws.ctx.db.close(); } catch { /* ignore */ }
      }
      const registry = workspaceLoader.readRegistry(configDir);
      registry.workspaces = registry.workspaces.filter((w) => w.id !== id && w.id !== ws?.ctx.config.id);
      workspaceLoader.writeRegistry(registry, configDir);
      return { ok: true as const, id };
    },
  };
}

// ---------- plugins and built-in adapters ----------

/**
 * VS-619 / VS-654: the provider profiles and keys a runtime asks for. Providers are daemon-only,
 * so both answer from `daemon.yaml` and the daemon secret store; the optional workspace id on the
 * host surface SHALL NOT select a profile or a key, and a legacy workspace provider block changes
 * nothing. `workspaces` is kept in the signature so the call sites (and the surface the runtime SDK
 * declares) do not churn.
 */
export function createRuntimeHost(workspaces: Map<string, WorkspaceRuntime>, configDir?: string, daemon?: DaemonConfig): RuntimeHost {
  void workspaces;
  const providers = (_workspaceId?: string): Record<string, ProviderProfile> => ({ ...(daemon?.providers ?? {}) });
  const providerKey = (providerId: string, _workspaceId?: string): string | undefined => {
    const profile = daemon?.providers?.[providerId];
    if (!profile?.apiKeySecret) return undefined;
    return daemonSecretStore(configDir ?? '')?.get(profile.apiKeySecret) ?? undefined;
  };
  return { providers, providerKey, ...(configDir ? { configDir } : {}) };
}

/** Best-effort registration: a missing or half-built package logs and is skipped, never fatal. */
async function registerBuiltins(registries: Registries, host: RuntimeHost): Promise<void> {
  for (const name of RUNTIME_PACKAGES) {
    const adapter = await loadAdapter<RuntimeAdapter>(name);
    if (adapter?.id) { adapter.attach?.(host); registries.runtimes.set(adapter.id, adapter); log.info({ runtime: adapter.id }, 'runtime registered'); }
  }
  for (const name of CHANNEL_PACKAGES) {
    const adapter = await loadAdapter<ChannelAdapter>(name);
    if (adapter?.kind) { registries.channels.set(adapter.kind, adapter); log.info({ channel: adapter.kind }, 'channel registered'); }
  }
  for (const name of SURFACE_PACKAGES) {
    const adapter = await loadAdapter<SurfaceAdapter>(name);
    if (adapter?.kind) { registries.surfaces.set(adapter.kind, adapter); log.info({ surface: adapter.kind }, 'surface registered'); }
  }
}

async function loadAdapter<T>(specifier: string): Promise<T | null> {
  try {
    const mod = (await import(specifier)) as Record<string, unknown>;
    const candidate = (mod.adapter ?? mod.default ?? null) as T | null;
    if (!candidate) { log.warn({ package: specifier }, 'package exports neither `adapter` nor `default`'); return null; }
    return candidate;
  } catch (e) {
    log.warn({ package: specifier, err: (e as Error).message }, 'optional package not available; continuing');
    return null;
  }
}

async function loadPlugins(ctx: WorkspaceContext, registries: Registries): Promise<void> {
  // VS-334: daemon-wide plugins first, so they reach every workspace; a workspace's own list is
  // appended after and may repeat one of them harmlessly (the repeat is rejected below as a
  // duplicate id, same as two distinct plugins colliding on id).
  const merged: Array<{ entry: (typeof ctx.config.plugins)[number]; source: PluginRuntime['source'] }> = [
    ...ctx.daemon.plugins.map((entry) => ({ entry, source: 'daemon' as const })),
    ...ctx.config.plugins.map((entry) => ({ entry, source: 'workspace' as const })),
  ];
  for (const { entry, source } of merged) {
    const name = typeof entry === 'string' ? entry : entry.name;
    const config = typeof entry === 'string' ? {} : entry.config ?? {};
    let plugin: WeaveAIPlugin | undefined;
    try {
      const mod = (await import(pluginSpecifier(ctx, name))) as Record<string, unknown>;
      plugin = (mod.default ?? mod.plugin) as WeaveAIPlugin | undefined;
      if (!plugin || typeof plugin.register !== 'function') { log.error({ plugin: name }, 'plugin has no definePlugin default export'); continue; }
      const p = plugin;
      if (p.apiVersion !== 1) { log.error({ plugin: name, apiVersion: p.apiVersion }, 'unsupported plugin apiVersion'); continue; }
      if (!PLUGIN_ID_RE.test(p.id)) { log.error({ plugin: p.id }, 'plugin id is not a valid slug; skipped'); continue; }
      if (ctx.plugins.loaded.some((loaded) => loaded.id === p.id)) {
        log.error({ plugin: p.id }, 'duplicate plugin id for this workspace; skipped');
        ctx.plugins.loaded.push({ id: p.id, version: p.version ?? null, name: p.name ?? null, source, loaded: false, error: `duplicate plugin id: ${p.id} is already loaded for this workspace`, hasPage: false });
        continue;
      }
      const routesBefore = ctx.plugins.routes.length;
      await p.register(pluginHost(p.id, config, ctx, registries));
      const hasPage = ctx.plugins.routes.slice(routesBefore).some((r) => r.method === 'GET' && r.path === '/page');
      ctx.plugins.loaded.push({ id: p.id, version: p.version, name: p.name ?? null, source, loaded: true, error: null, hasPage });
      log.info({ plugin: p.id, version: p.version, source }, 'plugin registered');
    } catch (e) {
      log.error({ err: e, plugin: name }, 'plugin failed to load; continuing');
      ctx.plugins.loaded.push({ id: plugin?.id ?? name, version: plugin?.version ?? null, name: plugin?.name ?? null, source, loaded: false, error: (e as Error).message, hasPage: false });
    }
  }
}

/**
 * Turn a `plugins:` entry into something `import()` can take. A relative or absolute path is
 * resolved against the workspace root (and through Node's package resolution, so a directory with a
 * `package.json` main or an `index.js` works); a bare package name is resolved from the workspace's
 * own `node_modules` first and otherwise left to the daemon's resolution.
 */
export function pluginSpecifier(ctx: Pick<WorkspaceContext, 'paths'>, name: string): string {
  const req = createRequire(join(ctx.paths.root, 'package.json'));
  const relative = name.startsWith('.') || isAbsolute(name) || name.startsWith('file:');
  if (name.startsWith('file:')) return name;
  const target = relative ? resolve(ctx.paths.root, name) : name;
  try { return pathToFileURL(req.resolve(target)).href; }
  catch { return relative ? pathToFileURL(target).href : name; }
}

function pluginHost(
  pluginId: string, config: Record<string, unknown>, ctx: WorkspaceContext, registries: Registries,
): PluginHost {
  const plog = getLogger('plugin', { plugin: pluginId });
  const store = new PluginDataService(ctx.db);
  return {
    registerRuntime: (a: RuntimeAdapter) => { registries.runtimes.set(a.id, a); },
    registerChannel: (a: ChannelAdapter) => { registries.channels.set(a.kind, a); },
    registerSurface: (a: SurfaceAdapter) => { registries.surfaces.set(a.kind, a); },
    registerWorktreeProvider: (p: WorktreeProvider) => { registries.worktreeProviders.set(p.id, p); },
    registerForge: (a: ForgeAdapter) => { registries.forges.set(a.id, a); },
    registerHook: (sub) => { ctx.plugins.hooks.push({ pluginId, events: sub.events, handler: sub.handler }); },
    registerAgentTool: (t: AgentToolDefinition) => {
      if (!isNamespacedToolName(t.name, pluginId)) { plog.error({ tool: t.name }, `plugin tool name must match ${pluginId}_<name>; skipped`); return; }
      const coreNames: readonly string[] = [...COMMON_TOOLS, ...WEAVER_TOOLS, ...WORKER_ONLY_TOOLS];
      if (coreNames.includes(t.name)) { plog.error({ tool: t.name }, 'plugin tool name collides with a core tool; skipped'); return; }
      if (ctx.plugins.tools.some((existing) => existing.name === t.name)) { plog.error({ tool: t.name }, 'plugin tool name collides with another plugin\'s tool in this workspace; skipped'); return; }
      ctx.plugins.tools.push(t);
    },
    registerHttpRoute: (method, path, handler) => { ctx.plugins.routes.push({ pluginId, method, path, handler }); },
    store: {
      get: async (key) => store.get(pluginId, key),
      put: async (key, value) => { store.put(pluginId, key, value); },
      delete: async (key) => { store.delete(pluginId, key); },
      list: async (prefix) => store.list(pluginId, prefix),
    },
    emit: (kind, entityId, payload) => { ctx.events.emit('plugin.event', `plugin:${pluginId}`, entityId, { pluginId, kind, payload }); },
    kitCss: () => ARTIFACT_KIT_CSS,
    themeCss: () => ctx.v2ThemeCss,
    config: <T>() => config as T,
    logger: {
      debug: (m, d) => plog.debug(d ?? {}, m), info: (m, d) => plog.info(d ?? {}, m),
      warn: (m, d) => plog.warn(d ?? {}, m), error: (m, d) => plog.error(d ?? {}, m),
    },
  };
}

// ---------- listeners ----------

interface LoopbackListener { url: string; server: ServerType; setDeps(deps: AppDeps): void }

/**
 * Loopback listener: run tokens, the MCP endpoint and `ctx.loopbackUrl`. `AC_LOOPBACK_SOCKET`
 * switches it to a unix socket; `AC_LOOPBACK_PORT` pins the port (0 = pick a free one).
 */
async function startLoopbackListener(): Promise<LoopbackListener> {
  let deps: AppDeps | null = null;
  const fetch = (req: Request, env: unknown): Promise<Response> | Response => {
    if (!deps) return new Response(JSON.stringify({ error: { code: 'internal', message: 'daemon still starting', retryable: true } }), { status: 503, headers: { 'content-type': 'application/json' } });
    return app!.fetch(req, env as never) as Promise<Response>;
  };
  let app: ReturnType<typeof createApp> | null = null;
  const socket = process.env.AC_LOOPBACK_SOCKET;
  const server = createAdaptorServer({ fetch: fetch as never });
  const url = await new Promise<string>((res, rej) => {
    server.once('error', rej);
    if (socket) server.listen(socket, () => res(`http+unix://${socket}`));
    else server.listen(Number(process.env.AC_LOOPBACK_PORT ?? 0), '127.0.0.1', () => {
      const addr = server.address();
      res(typeof addr === 'object' && addr ? `http://127.0.0.1:${addr.port}` : 'http://127.0.0.1');
    });
  });
  return {
    url, server,
    setDeps(next) { deps = next; app = createApp(next, null); },
  };
}

async function listen(fetch: (req: Request, env: unknown) => Response | Promise<Response>, o: { host: string; port: number; tls: { cert: string; key: string } | null }): Promise<ServerType> {
  const server = o.tls
    ? createAdaptorServer({ fetch: fetch as never, createServer: createHttpsServer, serverOptions: { cert: o.tls.cert, key: o.tls.key } })
    : createAdaptorServer({ fetch: fetch as never, createServer: createHttpServer });
  await new Promise<void>((res, rej) => { server.once('error', rej); server.listen(o.port, o.host, () => res()); });
  return server;
}

function close(server: ServerType): Promise<void> {
  return new Promise((res) => { server.close(() => res()); });
}

/** PLAN §4.4: the public listener never starts unauthenticated on a non-loopback bind. */
function publicListenerAllowed(cfg: DaemonConfig, auth: AuthService, host: string): boolean {
  const loopbackBind = host === '127.0.0.1' || host === '::1' || host === 'localhost';
  return loopbackBind || auth.hasOperator() || cfg.auth.loopbackTrusted;
}

async function tlsOptions(cfg: DaemonConfig, configDir: string): Promise<{ cert: string; key: string } | null> {
  const tls = cfg.http.tls;
  if (tls.mode === 'none') return null;
  if (tls.mode === 'files') {
    if (!tls.cert || !tls.key) throw new Error('http.tls.mode is "files" but cert/key are not configured');
    return { cert: await readFile(tls.cert, 'utf8'), key: await readFile(tls.key, 'utf8') };
  }
  if (tls.mode === 'self-signed') {
    const certPath = join(configDir, 'self-signed.crt');
    const keyPath = join(configDir, 'self-signed.key');
    if (existsSync(certPath) && existsSync(keyPath)) return { cert: await readFile(certPath, 'utf8'), key: await readFile(keyPath, 'utf8') };
    const selfsigned = (await import('selfsigned')) as { generate: (attrs: unknown, opts: unknown) => { cert: string; private: string } };
    const domains = tls.domains.length ? tls.domains : ['localhost'];
    const pems = selfsigned.generate([{ name: 'commonName', value: domains[0]! }], {
      days: 3650, keySize: 2048,
      extensions: [{ name: 'subjectAltName', altNames: [...domains.map((d) => ({ type: 2, value: d })), { type: 7, ip: '127.0.0.1' }] }],
    });
    await writeFile(certPath, pems.cert, { mode: 0o600 });
    await writeFile(keyPath, pems.private, { mode: 0o600 });
    log.info({ certPath, domains }, 'generated a self-signed certificate');
    return { cert: pems.cert, key: pems.private };
  }
  throw new Error(`http.tls.mode "${tls.mode}" is not implemented; use a reverse proxy or mode "files"`);
}

// ---------- small helpers ----------

function withListen(cfg: DaemonConfig, listen?: string): DaemonConfig {
  const effective = listen ?? process.env['AC_LISTEN'];
  return effective ? { ...cfg, http: { ...cfg.http, listen: effective } } : cfg;
}

function resolveUrls(cfg: DaemonConfig): { publicUrl: string; host: string; port: number } {
  const [rawHost = '127.0.0.1', rawPort = '7433'] = splitListen(cfg.http.listen);
  const port = Number(rawPort);
  const scheme = cfg.http.tls.mode === 'none' ? 'http' : 'https';
  const displayHost = rawHost === '0.0.0.0' || rawHost === '::' ? '127.0.0.1' : rawHost;
  return { publicUrl: cfg.http.publicUrl ?? `${scheme}://${displayHost}:${port}`, host: rawHost, port };
}

function splitListen(listen: string): [string, string] {
  const idx = listen.lastIndexOf(':');
  if (idx < 0) return ['127.0.0.1', listen];
  return [listen.slice(0, idx) || '127.0.0.1', listen.slice(idx + 1)];
}

function dirs(): { skillsDir: string; templatesDir: string; v2ThemeCss: string } {
  const repo = resolve(here, '..', '..', '..');
  return {
    skillsDir: process.env.AC_SKILLS_DIR ?? join(repo, 'skills'),
    templatesDir: process.env.AC_TEMPLATES_DIR ?? join(repo, 'templates'),
    v2ThemeCss: cachedV2ThemeCss(join(repo, 'packages', 'ui', 'src', 'index.css')),
  };
}

/**
 * A minimal, always-safe stylesheet a plugin page falls back to if the app's stylesheet is
 * unexpectedly missing from this release's checkout (VS-385) — enough that a page using the
 * vocabulary still reads, never a crash and never a fully unstyled page.
 */
const V2_THEME_CSS_FALLBACK =
  ":root, [data-theme='dark'] { color-scheme: dark; --bg-0: #08090b; --bg-1: #101114; --text-1: #e9eaec; --line-1: #1c1e22; --accent: #3d4148; --accent-on: #fff; }\n" +
  "[data-theme='light'] { color-scheme: light; --bg-0: #f7f8f9; --bg-1: #fff; --text-1: #16181c; --line-1: #e6e8eb; --accent: #3d4148; --accent-on: #fff; }\n" +
  ':root, body { background: var(--bg-0); color: var(--text-1); font-family: ui-sans-serif, system-ui, sans-serif; }\n' +
  '*, *::before, *::after { box-sizing: border-box; }';

let v2ThemeCssCache: string | undefined;

/** Reads the app's single stylesheet and generates the plugin stylesheet once per process, caching the result. */
function cachedV2ThemeCss(indexCssPath: string): string {
  if (v2ThemeCssCache !== undefined) return v2ThemeCssCache;
  try {
    v2ThemeCssCache = generateV2PluginCss(readFileSync(indexCssPath, 'utf8'));
  } catch (e) {
    log.warn({ err: e, path: indexCssPath }, 'index.css unreadable; plugin pages fall back to a minimal stylesheet');
    v2ThemeCssCache = V2_THEME_CSS_FALLBACK;
  }
  return v2ThemeCssCache;
}

function defaultUiDir(): string | null {
  const candidate = process.env.AC_UI_DIR ?? resolve(here, '..', '..', 'ui', 'dist');
  return existsSync(candidate) ? candidate : null;
}

function readVersion(): string {
  return releaseVersion(runningReleaseRoot());
}

export type { Db };
