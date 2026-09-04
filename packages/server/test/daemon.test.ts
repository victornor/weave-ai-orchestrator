/** Smoke test: boot a real daemon over a temp config dir and workspace, then shut it down. */
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import YAML from 'yaml';
import { workspaceLoader, initLogger } from '@agent-conductor/core';
import { pluginSpecifier, startDaemon, type DaemonHandle } from '../src/daemon.js';

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

    const health = await fetch(new URL('/api/health', daemon.loopbackUrl));
    expect(health.status).toBe(200);
    const payload = await health.json();
    expect(payload.ok).toBe(true);
    expect(payload.workspaces.map((w: { id: string }) => w.id)).toContain('smoke');

    const pidFile = join(configDir, 'daemon.json');
    expect(existsSync(pidFile)).toBe(true);
    expect(JSON.parse(readFileSync(pidFile, 'utf8'))).toMatchObject({ pid: process.pid, loopbackUrl: daemon.loopbackUrl });

    await daemon.stop('test');
    expect(existsSync(pidFile)).toBe(false);
    daemon = null;
  }, 30_000);
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
});
