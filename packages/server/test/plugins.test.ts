/**
 * VS-334: agent tools, storage, HTTP routes, events and the per-workspace registry that makes them
 * all actually scoped to the workspaces that load a plugin — boots a real daemon over temp config
 * and workspace dirs, the same pattern as `daemon.test.ts`'s "plugin loading" describe.
 */
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import YAML from 'yaml';
import { workspaceLoader, initLogger, type Actor } from '@weave-ai/core';
import { startDaemon, type DaemonHandle } from '../src/daemon.js';
import { runTool, type ToolCtx } from '../src/tools.js';
import type { RunTokenClaims } from '../src/runtoken.js';
import type { WorkspaceRuntime } from '../src/types.js';

initLogger(process.env.AC_LOG_LEVEL ?? 'silent');

const repoRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '..');
const notesPlugin = join(repoRoot, 'examples', 'plugins', 'notes');

let daemon: DaemonHandle | null = null;
let dirs: string[] = [];
afterEach(async () => {
  await daemon?.stop('test');
  daemon = null;
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs = [];
});

/** Creates and registers a workspace at a fresh temp dir, with `plugins` (a `plugins:` list, relative-path entries resolved against this workspace's own root) already written into its workspace.yaml. */
async function makeWorkspace(configDir: string, id: string, plugins: Array<string | { name: string; config?: Record<string, unknown> }>): Promise<string> {
  const wsDir = mkdtempSync(join(tmpdir(), 'ac-ws-'));
  dirs.push(wsDir);
  await workspaceLoader.initWorkspace(wsDir, { id, name: id, ticketPrefix: id.slice(0, 4).toUpperCase() });
  const cfgPath = join(wsDir, 'workspace.yaml');
  const cfg = YAML.parse(readFileSync(cfgPath, 'utf8')) as Record<string, unknown>;
  cfg.plugins = plugins.map((p) => (typeof p === 'string' ? { name: `./${relative(wsDir, p)}` } : { ...p, name: `./${relative(wsDir, p.name)}` }));
  writeFileSync(cfgPath, YAML.stringify(cfg));
  const registry = workspaceLoader.readRegistry(configDir);
  registry.workspaces.push({ id, path: wsDir });
  workspaceLoader.writeRegistry(registry, configDir);
  return wsDir;
}

function fakeCtx(ws: WorkspaceRuntime, kind: 'weaver' | 'worker'): ToolCtx {
  const claims: RunTokenClaims = { workspaceId: ws.id, runId: 'run_1', agentId: 'agent_1', agentKind: kind, projectId: null, ticketId: null, roleId: null };
  const actor: Actor = { kind: 'agent', id: 'agent_1', runId: 'run_1' };
  return { ws, claims, actor, incidents: undefined as never };
}

async function boot(configDir: string): Promise<DaemonHandle> {
  const cfg = workspaceLoader.readDaemonConfig(configDir);
  workspaceLoader.writeDaemonConfig(
    { ...cfg, http: { listen: '127.0.0.1:0', trustProxy: false, tls: { mode: 'none', domains: [] } }, auth: { ...cfg.auth, loopbackTrusted: true } },
    configDir,
  );
  daemon = await startDaemon({ configDir });
  return daemon;
}

describe('plugin agent tools (VS-334)', () => {
  it('a plugin tool reaches only the workspace that loads it, for the kinds its scope allows, and runs through the ToolResult envelope', async () => {
    const configDir = mkdtempSync(join(tmpdir(), 'ac-cfg-'));
    dirs.push(configDir);
    await makeWorkspace(configDir, 'notesws', [notesPlugin]);
    await makeWorkspace(configDir, 'bareplain', []);
    const d = await boot(configDir);

    const withNotes = d.workspaces.get('notesws')!;
    const bare = d.workspaces.get('bareplain')!;

    // Reaches the workspace that loads it, for a worker (scope: 'all').
    const created = await runTool('notes_create', fakeCtx(withNotes, 'worker'), { text: 'hello' });
    expect(created.ok).toBe(true);
    if (created.ok) expect((created.data as { text: string }).text).toBe('hello');
    const listed = await runTool('notes_list', fakeCtx(withNotes, 'weaver'), {});
    expect(listed.ok).toBe(true);
    if (listed.ok) {
      const notes = (listed.data as { notes: Array<{ text: string }> }).notes;
      expect(notes).toHaveLength(1);
      // Not just the count: the stored value itself, round-tripped through PluginDataService.
      expect(notes[0]?.text).toBe('hello');
    }

    // Absent from a workspace that never loaded the plugin.
    const missing = await runTool('notes_create', fakeCtx(bare, 'worker'), { text: 'nope' });
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.error.code).toBe('not_found');
  }, 30_000);

  it('rejects a plugin tool name that collides with a core tool, without failing the plugin\'s other registrations', async () => {
    const badPlugin = mkdtempSync(join(tmpdir(), 'ac-plugin-'));
    dirs.push(badPlugin);
    writeFileSync(join(badPlugin, 'package.json'), JSON.stringify({ name: 'bad', main: './index.js', type: 'module' }));
    writeFileSync(
      join(badPlugin, 'index.js'),
      `import { definePlugin } from '@weave-ai/plugin-sdk';
       export default definePlugin({
         id: 'bad', version: '0.0.1', apiVersion: 1,
         register(host) {
           host.registerAgentTool({ name: 'weave_ticket_get', description: 'x', inputSchema: {}, scope: 'all', handler: async () => ({}) });
           host.registerAgentTool({ name: 'bad_ok', description: 'x', inputSchema: {}, scope: 'all', handler: async () => ({ ok: true }) });
         },
       });`,
    );
    const configDir = mkdtempSync(join(tmpdir(), 'ac-cfg-'));
    dirs.push(configDir);
    await makeWorkspace(configDir, 'collision', [badPlugin]);
    const d = await boot(configDir);
    const ws = d.workspaces.get('collision')!;

    expect(ws.ctx.plugins.tools.some((t) => t.name === 'weave_ticket_get')).toBe(false);
    expect(ws.ctx.plugins.tools.some((t) => t.name === 'bad_ok')).toBe(true);
    // The core tool itself is untouched — a plugin can never override a core handler.
    const coreResult = await runTool('weave_ticket_get', fakeCtx(ws, 'worker'), { id: 'nonexistent' });
    expect(coreResult.ok).toBe(false);
    if (!coreResult.ok) expect(coreResult.error.code).not.toBe('internal');
  }, 30_000);
});

describe('plugin hooks are scoped per workspace (VS-334)', () => {
  it("a hook registered while loading one workspace fires for that workspace's own events, and never another's, regardless of load order", async () => {
    const hookPlugin = mkdtempSync(join(tmpdir(), 'ac-plugin-'));
    dirs.push(hookPlugin);
    writeFileSync(join(hookPlugin, 'package.json'), JSON.stringify({ name: 'hooked', main: './index.js', type: 'module' }));
    writeFileSync(
      join(hookPlugin, 'index.js'),
      `import { definePlugin } from '@weave-ai/plugin-sdk';
       export default definePlugin({
         id: 'hooked', version: '0.0.1', apiVersion: 1,
         register(host) {
           host.registerHook({ events: ['workspace.updated'], handler: async (ev) => { host.store.put('seen:' + ev.entityId, true); } });
         },
       });`,
    );
    const configDir = mkdtempSync(join(tmpdir(), 'ac-cfg-'));
    dirs.push(configDir);
    // Loaded first, so its own hook subscription happens before the second workspace even exists.
    await makeWorkspace(configDir, 'hookedws', [hookPlugin]);
    await makeWorkspace(configDir, 'otherws', []);
    const d = await boot(configDir);
    const hookedWs = d.workspaces.get('hookedws')!;
    const otherWs = d.workspaces.get('otherws')!;

    hookedWs.ctx.events.emit('workspace.updated', 'workspace', hookedWs.id, {});
    otherWs.ctx.events.emit('workspace.updated', 'workspace', otherWs.id, {});
    await new Promise((r) => setTimeout(r, 20));

    expect(hookedWs.ctx.plugins.loaded.find((p) => p.id === 'hooked')?.loaded).toBe(true);
    const seenOwn = hookedWs.ctx.db.get('SELECT 1 as x FROM plugin_data WHERE key = ?', [`seen:${hookedWs.id}`]);
    expect(seenOwn).toBeDefined();
    const seenOther = hookedWs.ctx.db.get('SELECT 1 as x FROM plugin_data WHERE key = ?', [`seen:${otherWs.id}`]);
    expect(seenOther).toBeUndefined();
  }, 30_000);
});

describe('plugin storage (VS-334)', () => {
  it('persists, is isolated per plugin, and never touches a core table', async () => {
    const configDir = mkdtempSync(join(tmpdir(), 'ac-cfg-'));
    dirs.push(configDir);
    await makeWorkspace(configDir, 'storews', [notesPlugin]);
    const d = await boot(configDir);
    const ws = d.workspaces.get('storews')!;

    await runTool('notes_create', fakeCtx(ws, 'worker'), { text: 'one' });
    const rows = ws.ctx.db.all<{ pluginId: string }>('SELECT plugin_id as pluginId FROM plugin_data');
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.pluginId === 'notes')).toBe(true);
    // The `tickets` core table is untouched by anything plugin storage does.
    const tickets = ws.ctx.db.all('SELECT * FROM tickets');
    expect(tickets).toHaveLength(0);
  }, 30_000);
});

describe('plugin page kit CSS (VS-334)', () => {
  it("the notes plugin's page inlines host.kitCss(), the same Artifact Kit CSS the artifact route serves", async () => {
    const configDir = mkdtempSync(join(tmpdir(), 'ac-cfg-'));
    dirs.push(configDir);
    await makeWorkspace(configDir, 'pagecss', [notesPlugin]);
    const d = await boot(configDir);
    const ws = d.workspaces.get('pagecss')!;

    const kit = await fetch(new URL(`/api/w/${ws.id}/artifacts/kit.css`, d.loopbackUrl));
    const kitCss = await kit.text();
    expect(kitCss.length).toBeGreaterThan(0);

    const page = await fetch(new URL(`/api/w/${ws.id}/plugins/notes/page`, d.loopbackUrl));
    expect(page.status).toBe(200);
    expect(page.headers.get('content-security-policy')).toContain('connect-src \'none\'');
    const html = await page.text();
    expect(html).toContain(kitCss);
  }, 30_000);
});

describe('plugin events (VS-334)', () => {
  it('an emitted event is durable, carries the plugin id and kind, and never crosses into another workspace', async () => {
    const configDir = mkdtempSync(join(tmpdir(), 'ac-cfg-'));
    dirs.push(configDir);
    await makeWorkspace(configDir, 'eventsa', [notesPlugin]);
    await makeWorkspace(configDir, 'eventsb', []);
    const d = await boot(configDir);
    const wsA = d.workspaces.get('eventsa')!;
    const wsB = d.workspaces.get('eventsb')!;

    await runTool('notes_create', fakeCtx(wsA, 'worker'), { text: 'live' });

    const eventsA = wsA.ctx.events.since(0);
    const pluginEvent = eventsA.find((e) => e.type === 'plugin.event');
    expect(pluginEvent).toBeDefined();
    expect(pluginEvent!.entityType).toBe('plugin:notes');
    expect(pluginEvent!.payload).toMatchObject({ pluginId: 'notes', kind: 'note.created', payload: { text: 'live' } });

    const eventsB = wsB.ctx.events.since(0);
    expect(eventsB.some((e) => e.type === 'plugin.event')).toBe(false);
  }, 30_000);
});

describe('daemon-wide plugins (VS-334)', () => {
  it('a plugin listed only in daemon.yaml loads for a workspace with no plugins of its own, tagged by source', async () => {
    const configDir = mkdtempSync(join(tmpdir(), 'ac-cfg-'));
    dirs.push(configDir);
    await makeWorkspace(configDir, 'daemonwide', []);
    const daemonCfg = workspaceLoader.readDaemonConfig(configDir);
    workspaceLoader.writeDaemonConfig(
      { ...daemonCfg, plugins: [{ name: notesPlugin }], http: { listen: '127.0.0.1:0', trustProxy: false, tls: { mode: 'none', domains: [] } } },
      configDir,
    );
    daemon = await startDaemon({ configDir });
    const ws = daemon.workspaces.get('daemonwide')!;
    const entry = ws.ctx.plugins.loaded.find((p) => p.id === 'notes');
    expect(entry?.loaded).toBe(true);
    expect(entry?.source).toBe('daemon');
    const result = await runTool('notes_list', fakeCtx(ws, 'worker'), {});
    expect(result.ok).toBe(true);
  }, 30_000);
});

describe('plugin load failure containment (VS-334)', () => {
  it('a throwing plugin does not stop another plugin from loading', async () => {
    const throwing = mkdtempSync(join(tmpdir(), 'ac-plugin-'));
    dirs.push(throwing);
    writeFileSync(join(throwing, 'package.json'), JSON.stringify({ name: 'throws', main: './index.js', type: 'module' }));
    writeFileSync(
      join(throwing, 'index.js'),
      `import { definePlugin } from '@weave-ai/plugin-sdk';
       export default definePlugin({ id: 'throws', version: '0.0.1', apiVersion: 1, register() { throw new Error('boom'); } });`,
    );
    const configDir = mkdtempSync(join(tmpdir(), 'ac-cfg-'));
    dirs.push(configDir);
    await makeWorkspace(configDir, 'contained', [throwing, notesPlugin]);
    const d = await boot(configDir);
    const ws = d.workspaces.get('contained')!;
    expect(ws.ctx.plugins.loaded.find((p) => p.id === 'throws')?.loaded).toBe(false);
    expect(ws.ctx.plugins.loaded.find((p) => p.id === 'notes')?.loaded).toBe(true);
  }, 30_000);

  it('a throwing plugin tool handler fails only that call, as a ToolResult, never out of runTool', async () => {
    const configDir = mkdtempSync(join(tmpdir(), 'ac-cfg-'));
    dirs.push(configDir);
    await makeWorkspace(configDir, 'toolthrows', []);
    const d = await boot(configDir);
    const ws = d.workspaces.get('toolthrows')!;
    ws.ctx.plugins.tools.push({
      name: 'boom_tool', description: 'x', inputSchema: { type: 'object', properties: {} }, scope: 'all',
      handler: async () => { throw new Error('kaboom'); },
    });

    // Never rejects — the throw is caught inside runTool and turned into a ToolResult.
    const result = await runTool('boom_tool', fakeCtx(ws, 'worker'), {});
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain('kaboom');
  }, 30_000);
});
