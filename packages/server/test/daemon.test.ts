/** Smoke test: boot a real daemon over a temp config dir and workspace, then shut it down. */
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import YAML from 'yaml';
import { workspaceLoader, initLogger } from '@weave-ai/core';
import { pluginSpecifier, startDaemon, resolveIsolation, type DaemonHandle } from '../src/daemon.js';
import { registerPluginSdkResolveHook } from '../src/register-plugin-sdk-hook.js';

initLogger(process.env.AC_LOG_LEVEL ?? 'silent');

let daemon: DaemonHandle | null = null;
let dirs: string[] = [];
afterEach(async () => {
  await daemon?.stop('test');
  daemon = null;
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs = [];
});

describe('startDaemon', () => {
  it('loads a registered workspace and serves health on both listeners', async () => {
    const configDir = mkdtempSync(join(tmpdir(), 'ac-cfg-'));
    const wsDir = mkdtempSync(join(tmpdir(), 'ac-ws-'));
    dirs = [configDir, wsDir];

    await workspaceLoader.initWorkspace(wsDir, { id: 'smoke', name: 'Smoke', ticketPrefix: 'SMK' });
    workspaceLoader.writeRegistry({ workspaces: [{ id: 'smoke', path: wsDir }] }, configDir);
    workspaceLoader.writeDaemonConfig({ ...workspaceLoader.readDaemonConfig(configDir), http: { listen: '127.0.0.1:0', trustProxy: false, tls: { mode: 'none', domains: [] } } }, configDir);

    daemon = await startDaemon({ configDir });
    expect(daemon.workspaces.has('smoke')).toBe(true);
    // VS-143: a throwaway config dir is isolated by default — see daemon-isolation/credential-scope.
    expect(daemon.workspaces.get('smoke')!.ctx.isolated).toBe(true);
    expect(daemon.workspaces.get('smoke')!.ctx.daemonConfigDir).toBe(configDir);
    // VS-295: every loaded workspace gets its own push dispatcher, listening for decision.created.
    expect(daemon.workspaces.get('smoke')!.push).not.toBeNull();
    // VS-295: a fresh daemon generates its own VAPID key pair before anything else loads.
    expect(existsSync(join(configDir, 'push-vapid.enc'))).toBe(true);
    expect(existsSync(join(configDir, 'push-vapid.key'))).toBe(true);

    const health = await fetch(new URL('/api/health', daemon.loopbackUrl));
    expect(health.status).toBe(200);
    const payload = await health.json();
    expect(payload.ok).toBe(true);
    expect(payload.workspaces.map((w: { id: string }) => w.id)).toContain('smoke');
    // VS-316: so an upgrade's restart runner can tell this process apart from a stray one.
    expect(payload.pid).toBe(process.pid);

    const pidFile = join(configDir, 'daemon.json');
    expect(existsSync(pidFile)).toBe(true);
    expect(JSON.parse(readFileSync(pidFile, 'utf8'))).toMatchObject({ pid: process.pid, loopbackUrl: daemon.loopbackUrl });

    await daemon.stop('test');
    expect(existsSync(pidFile)).toBe(false);
    daemon = null;
  }, 30_000);

  it('drains the ticket service before it closes the workspace database', async () => {
    const configDir = mkdtempSync(join(tmpdir(), 'ac-cfg-'));
    const wsDir = mkdtempSync(join(tmpdir(), 'ac-ws-'));
    dirs = [configDir, wsDir];

    await workspaceLoader.initWorkspace(wsDir, { id: 'drain', name: 'Drain', ticketPrefix: 'DRN' });
    workspaceLoader.writeRegistry({ workspaces: [{ id: 'drain', path: wsDir }] }, configDir);
    workspaceLoader.writeDaemonConfig({ ...workspaceLoader.readDaemonConfig(configDir), http: { listen: '127.0.0.1:0', trustProxy: false, tls: { mode: 'none', domains: [] } } }, configDir);

    daemon = await startDaemon({ configDir });
    const ws = daemon.workspaces.get('drain');
    expect(ws).toBeDefined();

    // The follow-up work a merge schedules reads the workspace db, so the drain has to come first.
    const order: string[] = [];
    const realStop = ws!.services.tickets.stop.bind(ws!.services.tickets);
    ws!.services.tickets.stop = async () => { order.push('tickets.stop'); await realStop(); };
    const realClose = ws!.ctx.db.close.bind(ws!.ctx.db);
    ws!.ctx.db.close = () => { order.push('db.close'); realClose(); };

    await daemon.stop('test');
    daemon = null;
    expect(order).toEqual(['tickets.stop', 'db.close']);
  }, 30_000);

  it('shareHostCredentials makes a throwaway config dir behave as not isolated (VS-143)', async () => {
    const configDir = mkdtempSync(join(tmpdir(), 'ac-cfg-'));
    const wsDir = mkdtempSync(join(tmpdir(), 'ac-ws-'));
    dirs = [configDir, wsDir];

    await workspaceLoader.initWorkspace(wsDir, { id: 'shared', name: 'Shared', ticketPrefix: 'SHR' });
    workspaceLoader.writeRegistry({ workspaces: [{ id: 'shared', path: wsDir }] }, configDir);
    workspaceLoader.writeDaemonConfig({ ...workspaceLoader.readDaemonConfig(configDir), http: { listen: '127.0.0.1:0', trustProxy: false, tls: { mode: 'none', domains: [] } } }, configDir);

    daemon = await startDaemon({ configDir, shareHostCredentials: true });
    expect(daemon.workspaces.get('shared')!.ctx.isolated).toBe(false);
  }, 30_000);
});

describe('resolveIsolation (VS-143)', () => {
  const plainDefault = join(homedir(), '.config', 'agent-conductor');

  it('is not isolated at the plain default config dir', () => {
    expect(resolveIsolation(plainDefault)).toBe(false);
  });

  it('is isolated at any other config dir, with no flag required', () => {
    expect(resolveIsolation('/tmp/ac-cfg-somewhere-else')).toBe(true);
  });

  it('the sharing opt-in restores non-isolated behavior for a custom config dir', () => {
    expect(resolveIsolation('/tmp/ac-cfg-somewhere-else', true)).toBe(false);
  });

  it('the sharing opt-in is a no-op at the plain default, which is already not isolated', () => {
    expect(resolveIsolation(plainDefault, true)).toBe(false);
  });
});

describe('plugin loading', () => {
  const repoRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '..');
  const echoPlugin = join(repoRoot, 'examples', 'plugins', 'echo-channel');

  it('resolves a relative plugin path against the workspace root', () => {
    const ctx = { paths: { root: repoRoot } } as never;
    expect(pluginSpecifier(ctx, './examples/plugins/echo-channel')).toBe(pathToFileURL(join(echoPlugin, 'index.js')).href);
    expect(pluginSpecifier(ctx, echoPlugin)).toBe(pathToFileURL(join(echoPlugin, 'index.js')).href);
    expect(pluginSpecifier(ctx, 'some-package-that-is-not-installed')).toBe('some-package-that-is-not-installed');
  });

  it('loads the example plugin from a relative path and registers its channel and hook', async () => {
    const configDir = mkdtempSync(join(tmpdir(), 'ac-cfg-'));
    const wsDir = mkdtempSync(join(tmpdir(), 'ac-ws-'));
    dirs = [configDir, wsDir];

    await workspaceLoader.initWorkspace(wsDir, { id: 'plugged', name: 'Plugged', ticketPrefix: 'PLG' });
    const cfgPath = join(wsDir, 'workspace.yaml');
    const cfg = YAML.parse(readFileSync(cfgPath, 'utf8')) as Record<string, unknown>;
    // A path relative to the workspace root, which is what the loader has to resolve against.
    cfg.plugins = [{ name: `./${relative(wsDir, echoPlugin)}`, config: { prefix: 'plg' } }];
    cfg.channels = { echo: {} };
    writeFileSync(cfgPath, YAML.stringify(cfg));
    workspaceLoader.writeRegistry({ workspaces: [{ id: 'plugged', path: wsDir }] }, configDir);
    workspaceLoader.writeDaemonConfig({ ...workspaceLoader.readDaemonConfig(configDir), http: { listen: '127.0.0.1:0', trustProxy: false, tls: { mode: 'none', domains: [] } } }, configDir);

    daemon = await startDaemon({ configDir });
    const echo = daemon.registries.channels.get('echo');
    expect(echo?.kind).toBe('echo');
    expect(echo?.capabilities.supportsButtons).toBe(false);
    expect((await echo!.send({ threadExternalId: 't1', message: { parts: [{ type: 'text', text: 'hi' }], text: 'hi' } })).delivered).toBe(true);
  }, 30_000);

  it('resolves a bare @weave-ai/plugin-sdk import from a plugin directory outside the monorepo, with no node_modules (VS-385)', async () => {
    registerPluginSdkResolveHook();

    const configDir = mkdtempSync(join(tmpdir(), 'ac-cfg-'));
    const wsDir = mkdtempSync(join(tmpdir(), 'ac-ws-'));
    // Deliberately outside this repo's own directory tree, with no node_modules of its own — the
    // exact scenario `pluginSpecifier`'s own file resolution cannot help with; only the loader
    // hook registered above can make the plugin's own `import` line succeed.
    const outOfTreeDir = mkdtempSync(join(tmpdir(), 'ac-plugin-oot-'));
    dirs = [configDir, wsDir, outOfTreeDir];
    expect(existsSync(join(outOfTreeDir, 'node_modules'))).toBe(false);

    writeFileSync(join(outOfTreeDir, 'package.json'), JSON.stringify({ name: 'oot-plugin', version: '0.0.0', type: 'module', main: './index.js' }));
    writeFileSync(
      join(outOfTreeDir, 'index.js'),
      "import { definePlugin } from '@weave-ai/plugin-sdk';\n" +
      "export default definePlugin({ id: 'oot', version: '0.0.0', apiVersion: 1, register() {} });\n",
    );

    await workspaceLoader.initWorkspace(wsDir, { id: 'oot-ws', name: 'Out of tree', ticketPrefix: 'OOT' });
    const cfgPath = join(wsDir, 'workspace.yaml');
    const cfg = YAML.parse(readFileSync(cfgPath, 'utf8')) as Record<string, unknown>;
    cfg.plugins = [{ name: outOfTreeDir }];
    writeFileSync(cfgPath, YAML.stringify(cfg));
    workspaceLoader.writeRegistry({ workspaces: [{ id: 'oot-ws', path: wsDir }] }, configDir);
    workspaceLoader.writeDaemonConfig({ ...workspaceLoader.readDaemonConfig(configDir), http: { listen: '127.0.0.1:0', trustProxy: false, tls: { mode: 'none', domains: [] } } }, configDir);

    daemon = await startDaemon({ configDir });
    const loaded = daemon.workspaces.get('oot-ws')!.ctx.plugins.loaded;
    expect(loaded).toContainEqual(expect.objectContaining({ id: 'oot', loaded: true, error: null }));

    // The in-tree example plugin still loads unaffected by the hook being registered.
    const echoResolved = pluginSpecifier({ paths: { root: repoRoot } } as never, './examples/plugins/echo-channel');
    expect(echoResolved).toBe(pathToFileURL(join(echoPlugin, 'index.js')).href);
  }, 30_000);
});
