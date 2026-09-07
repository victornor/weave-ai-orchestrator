/**
 * The daemon process: config, registries, workspaces, two listeners, graceful shutdown.
 * `conductor daemon start` execs `bin.js`, which calls `startDaemon()`.
 */
import { createServer as createHttpServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { createAdaptorServer } from '@hono/node-server';
import type { ServerType } from '@hono/node-server';
import { openDb } from '@agent-conductor/db';
import type { Db } from '@agent-conductor/db';
import {
  createRegistries, createCore, createAuthService, getLogger, initLogger, workspaceLoader,
  stageWorkspaceImport, importTickets,
  type Registries, type WorkspaceContext,
} from '@agent-conductor/core';
import type { AuthService, CoreServices } from '@agent-conductor/core';
import type { ChannelAdapter, SurfaceAdapter } from '@agent-conductor/plugin-sdk';
import type { RuntimeAdapter } from '@agent-conductor/runtime-sdk';
import type { AgentConductorPlugin, PluginHost, AgentToolDefinition, WorktreeProvider, ForgeAdapter } from '@agent-conductor/plugin-sdk';
import { OcError, type DaemonConfig, type EventType, type WorkspaceEvent } from '@agent-conductor/shared';
import { createApp, type WorkspaceAdmin } from './app.js';
import { createUpdateChecker, runningReleaseRoot } from './release-info.js';
import { createUpgradeService } from './upgrade.js';
import { ChannelManager } from './channels.js';
import { WebhookDispatcher } from './webhooks.js';
import type { AppDeps, WorkspaceRuntime } from './types.js';

const here = dirname(fileURLToPath(import.meta.url));
const log = getLogger('daemon');

const RUNTIME_PACKAGES = ['@agent-conductor/runtime-claude', '@agent-conductor/runtime-codex', '@agent-conductor/runtime-opencode', '@agent-conductor/runtime-gemini'];
const CHANNEL_PACKAGES = ['@agent-conductor/channel-web', '@agent-conductor/channel-cli', '@agent-conductor/channel-telegram'];
const SURFACE_PACKAGES = ['@agent-conductor/surface-headless', '@agent-conductor/surface-tmux', '@agent-conductor/surface-herdr', '@agent-conductor/surface-hyprland'];

export interface StartOptions {
  configDir?: string;
  /** Override the public listen address (`host:port`), e.g. from `conductor daemon start --listen`. */
  listen?: string;
  uiDir?: string | null;
}

export interface DaemonHandle {
  publicUrl: string;
  loopbackUrl: string;
  workspaces: Map<string, WorkspaceRuntime>;
  registries: Registries;
  stop(reason?: string): Promise<void>;
}

export const VERSION: string = readVersion();

export async function startDaemon(opts: StartOptions = {}): Promise<DaemonHandle> {
  const configDir = opts.configDir ?? workspaceLoader.configDir();
  const daemonCfg = withListen(workspaceLoader.readDaemonConfig(configDir), opts.listen);
  initLogger(daemonCfg.logLevel);
  await mkdir(configDir, { recursive: true });

  const daemonDb = openDb(join(configDir, 'daemon.sqlite'));
  const auth = createAuthService(daemonDb, daemonCfg);
  const registries = createRegistries();
  const hooks: Array<{ events: EventType[] | '*'; handler(ev: WorkspaceEvent): Promise<void> }> = [];

  await registerBuiltins(registries);

  const workspaces = new Map<string, WorkspaceRuntime>();
  const { publicUrl, host, port } = resolveUrls(daemonCfg);

  // The loopback listener must exist before workspaces load: its URL goes into every run's env.
  const loopback = await startLoopbackListener();
  // Assigned once the listeners are decided below; the loopback app copies `deps` now, so the hook
  // has to exist before that copy is taken.
  let onOperatorConfigured: (() => void) | null = null;
  const updates = createUpdateChecker({ daemon: daemonCfg, version: VERSION });
  const upgrades = createUpgradeService({
    db: daemonDb, daemon: daemonCfg, configDir, workspaces, updates, version: VERSION, releaseRoot: runningReleaseRoot(),
    runtimes: () => [...registries.runtimes.keys()],
  });
  const deps: AppDeps = {
    auth, daemon: daemonCfg, workspaces, registries, listener: 'public',
    publicUrl, version: VERSION, uiDir: opts.uiDir ?? defaultUiDir(),
    updates, upgrades,
    onOperatorConfigured: () => onOperatorConfigured?.(),
  };
  loopback.setDeps({ ...deps, listener: 'loopback' });

  const admin = makeAdmin(configDir, daemonCfg, registries, workspaces, loopback.url, hooks);
  const registry = workspaceLoader.readRegistry(configDir);
  for (const entry of registry.workspaces) {
    try { await loadWorkspaceInto(workspaces, entry.path, { daemon: daemonCfg, registries, loopbackUrl: loopback.url, ...dirs() }, hooks); }
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
    await startPublic();
  } else {
    // PLAN §4.4: never expose an unauthenticated daemon. Hold the public listener; the loopback
    // listener still serves `POST /api/auth/setup`, and `conductor daemon set-password` on this host opens it.
    log.warn({ host, loopback: loopback.url }, 'public listener held until an operator password is set: run `conductor daemon set-password` on this host');
    onOperatorConfigured = () => { startPublic().catch((e: unknown) => log.error({ err: e }, 'public listener failed to start after setup')); };
    await writePidFile();
  }

  // Now that the daemon is serving again, tell each workspace about an upgrade that has not been
  // reported yet (VS-76). Not awaited: the announcement is a report about a daemon that is already up,
  // and a channel that is slow to take it must not hold the boot.
  void upgrades.announce().catch((e: unknown) => log.error({ err: e }, 'upgrade announcement failed'));

  let stopping: Promise<void> | null = null;
  const stop = (reason = 'shutdown'): Promise<void> => (stopping ??= shutdown(reason));

  async function shutdown(reason: string): Promise<void> {
    log.info({ reason }, 'daemon shutting down');
    for (const ws of new Set(workspaces.values())) {
      await ws.channels?.stop().catch((e: unknown) => log.warn({ err: e, ws: ws.id }, 'channel manager stop failed'));
      await ws.webhooks?.stop().catch((e: unknown) => log.warn({ err: e, ws: ws.id }, 'webhook dispatcher stop failed'));
      await ws.services.dispatcher.stop().catch((e: unknown) => log.warn({ err: e, ws: ws.id }, 'dispatcher stop failed'));
      // Before the db closes below: the ticket service's post-merge follow-up work reads it.
      await ws.services.tickets.stop().catch((e: unknown) => log.warn({ err: e, ws: ws.id }, 'ticket follow-up drain failed'));
      // Same reason: a running job's log tail is only in memory between flushes, and the timer that
      // would write it must not fire against a closed database.
      await ws.services.jobs.stop().catch((e: unknown) => log.warn({ err: e, ws: ws.id }, 'job log drain failed'));
      try { ws.services.supervisor.stop(); } catch (e) { log.warn({ err: e, ws: ws.id }, 'supervisor stop failed'); }
      await cancelRunningRuns(ws);
    }
    await Promise.all([publicServer ? close(publicServer) : Promise.resolve(), close(loopback.server)]);
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
  opts: { daemon: DaemonConfig; registries: Registries; loopbackUrl: string; skillsDir: string; templatesDir: string },
  hooks: Array<{ events: EventType[] | '*'; handler(ev: WorkspaceEvent): Promise<void> }>,
): Promise<WorkspaceRuntime> {
  const ctx: WorkspaceContext = await workspaceLoader.loadWorkspace(path, opts);
  const services: CoreServices = createCore(ctx);
  // `:ws` in the API is the slug from workspace.yaml; the db id is a ULID. Both resolve.
  const runtime: WorkspaceRuntime = { id: ctx.config.id, ctx, services, channels: null, webhooks: null };
  workspaces.set(ctx.config.id, runtime);
  if (ctx.workspaceId !== ctx.config.id) workspaces.set(ctx.workspaceId, runtime);

  for (const hook of hooks) {
    ctx.events.on((ev) => {
      if (hook.events !== '*' && !hook.events.includes(ev.type)) return;
      void hook.handler(ev).catch((e: unknown) => log.warn({ err: e, type: ev.type }, 'plugin hook failed'));
    });
  }

  await loadPlugins(ctx, opts.registries, hooks);
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
  log.info({ workspace: ctx.workspaceId, root: ctx.paths.root }, 'workspace loaded');
  return runtime;
}

async function cancelRunningRuns(ws: WorkspaceRuntime): Promise<void> {
  let running: Array<{ id: string }> = [];
  try { running = ws.services.runs.list({ status: ['running', 'queued'] }).items; } catch { return; }
  for (const run of running) {
    await ws.services.runs.cancel({ kind: 'system', id: null }, run.id, 'interrupt')
      .catch((e: unknown) => log.warn({ err: e, runId: run.id }, 'run cancel failed during shutdown'));
  }
}

function makeAdmin(
  configDir: string, daemon: DaemonConfig, registries: Registries, workspaces: Map<string, WorkspaceRuntime>,
  loopbackUrl: string, hooks: Array<{ events: EventType[] | '*'; handler(ev: WorkspaceEvent): Promise<void> }>,
): WorkspaceAdmin {
  const opts = () => ({ daemon, registries, loopbackUrl, ...dirs() });
  const remember = (id: string, path: string): void => {
    const registry = workspaceLoader.readRegistry(configDir);
    if (!registry.workspaces.some((w) => w.id === id)) registry.workspaces.push({ id, path });
    workspaceLoader.writeRegistry(registry, configDir);
  };
  return {
    async register(path) {
      const ws = await loadWorkspaceInto(workspaces, resolve(path), opts(), hooks);
      remember(ws.id, resolve(path));
      return { id: ws.id, path: resolve(path) };
    },
    async init(input) {
      await workspaceLoader.initWorkspace(resolve(input.path), { id: input.id, name: input.name, ticketPrefix: input.ticketPrefix });
      const ws = await loadWorkspaceInto(workspaces, resolve(input.path), opts(), hooks);
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
      const ws = already ?? await loadWorkspaceInto(workspaces, target, opts(), hooks);
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

/** Best-effort registration: a missing or half-built package logs and is skipped, never fatal. */
async function registerBuiltins(registries: Registries): Promise<void> {
  for (const name of RUNTIME_PACKAGES) {
    const adapter = await loadAdapter<RuntimeAdapter>(name);
    if (adapter?.id) { registries.runtimes.set(adapter.id, adapter); log.info({ runtime: adapter.id }, 'runtime registered'); }
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

async function loadPlugins(
  ctx: WorkspaceContext, registries: Registries,
  hooks: Array<{ events: EventType[] | '*'; handler(ev: WorkspaceEvent): Promise<void> }>,
): Promise<void> {
  for (const entry of ctx.config.plugins) {
    const name = typeof entry === 'string' ? entry : entry.name;
    const config = typeof entry === 'string' ? {} : entry.config ?? {};
    try {
      const mod = (await import(pluginSpecifier(ctx, name))) as Record<string, unknown>;
      const plugin = (mod.default ?? mod.plugin) as AgentConductorPlugin | undefined;
      if (!plugin || typeof plugin.register !== 'function') { log.error({ plugin: name }, 'plugin has no definePlugin default export'); continue; }
      if (plugin.apiVersion !== 1) { log.error({ plugin: name, apiVersion: plugin.apiVersion }, 'unsupported plugin apiVersion'); continue; }
      await plugin.register(pluginHost(name, config, registries, hooks));
      log.info({ plugin: plugin.id, version: plugin.version }, 'plugin registered');
    } catch (e) {
      log.error({ err: e, plugin: name }, 'plugin failed to load; continuing');
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
  name: string, config: Record<string, unknown>, registries: Registries,
  hooks: Array<{ events: EventType[] | '*'; handler(ev: WorkspaceEvent): Promise<void> }>,
): PluginHost {
  const plog = getLogger('plugin', { plugin: name });
  return {
    registerRuntime: (a: RuntimeAdapter) => { registries.runtimes.set(a.id, a); },
    registerChannel: (a: ChannelAdapter) => { registries.channels.set(a.kind, a); },
    registerSurface: (a: SurfaceAdapter) => { registries.surfaces.set(a.kind, a); },
    registerWorktreeProvider: (p: WorktreeProvider) => { registries.worktreeProviders.set(p.id, p); },
    registerForge: (a: ForgeAdapter) => { registries.forges.set(a.id, a); },
    registerHook: (sub) => { hooks.push(sub); },
    registerAgentTool: (t: AgentToolDefinition) => { registries.agentTools.push(t); },
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

function dirs(): { skillsDir: string; templatesDir: string } {
  const repo = resolve(here, '..', '..', '..');
  return {
    skillsDir: process.env.AC_SKILLS_DIR ?? join(repo, 'skills'),
    templatesDir: process.env.AC_TEMPLATES_DIR ?? join(repo, 'templates'),
  };
}

function defaultUiDir(): string | null {
  const candidate = process.env.AC_UI_DIR ?? resolve(here, '..', '..', 'ui', 'dist');
  return existsSync(candidate) ? candidate : null;
}

function readVersion(): string {
  try {
    const require = createRequire(import.meta.url);
    return (require('../package.json') as { version: string }).version;
  } catch { return '0.0.0'; }
}

export type { Db };
