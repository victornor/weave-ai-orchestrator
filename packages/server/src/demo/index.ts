import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { openDb } from '@weave-ai/db';
import { workspacePaths, workspaceLoader } from '@weave-ai/core';
import { OcError } from '@weave-ai/shared';
import { startDaemon, type DaemonHandle } from '../daemon.js';
import { seedLumen, seedDaemonIncidents } from './seed.js';
import { seedKnowledge } from './knowledge.js';
import { seedFernwood } from './seedFernwood.js';
import { buildProjectRepo } from './clones.js';

/** Written into a demo directory so a later run may wipe it, and so nothing else ever is. */
export const DEMO_MARKER = '.weave-demo';
/** The port the live daemon listens on by default; a demo never takes it. */
export const LIVE_PORT = 7433;

export interface DemoOptions {
  /** Where the demo's config directory goes. Default: a fresh temporary directory. */
  dir?: string;
  /** Loopback port. Default `0`: pick a free one. */
  port?: number;
  uiDir?: string | null;
}

/**
 * VS-770: a demo daemon must never share a port or a directory with the live one. Both checks run
 * before anything is created, so a mistaken invocation changes nothing.
 */
export function assertDemoTarget(dir: string, port: number): void {
  if (port === LIVE_PORT) throw new OcError('validation', `demo mode refuses port ${LIVE_PORT}: that is the live daemon's port`);
  const resolved = resolve(dir);
  const live = [workspaceLoader.configDir(), process.env['AC_CONFIG_HOME']].filter((d): d is string => !!d).map((d) => resolve(d));
  if (workspaceLoader.isDefaultConfigDir(resolved) || live.includes(resolved)) {
    throw new OcError('validation', `demo mode refuses ${resolved}: that is the live config directory`);
  }
  if (existsSync(resolved) && readdirSync(resolved).length > 0 && !existsSync(join(resolved, DEMO_MARKER))) {
    throw new OcError('validation', `demo mode refuses ${resolved}: it is not empty and was not created by demo mode`);
  }
}

/** Creates (or wipes, when it is an earlier demo's) the directory, then seeds every workspace into it. */
export async function prepareDemoDir(dir: string, port: number): Promise<void> {
  assertDemoTarget(dir, port);
  const root = resolve(dir);
  if (existsSync(root)) for (const entry of readdirSync(root)) rmSync(join(root, entry), { recursive: true, force: true });
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, DEMO_MARKER), 'created by `weave demo`; safe to delete\n');

  const cfg = workspaceLoader.ensureFreshDaemonConfig(root);
  workspaceLoader.writeDaemonConfig({ ...cfg, http: { ...cfg.http, listen: `127.0.0.1:${port}` }, auth: { ...cfg.auth, loopbackTrusted: true } }, root);

  const registry: Array<{ id: string; path: string }> = [];
  for (const spec of [
    { id: 'lumen', name: 'Lumen Labs', prefix: 'LUM', seed: seedLumen },
    { id: 'fernwood', name: 'Fernwood Studio', prefix: 'FRN', seed: seedFernwood },
  ]) {
    const wsRoot = join(root, 'workspaces', spec.id);
    await workspaceLoader.initWorkspace(wsRoot, { id: spec.id, name: spec.name, ticketPrefix: spec.prefix });
    const db = openDb(workspacePaths(wsRoot).db);
    let seeded;
    try { seeded = spec.seed({ db, root: wsRoot }); } finally { db.close(); }
    // A real (local, throwaway) repository per project, so the pages that read git have something to read.
    for (const slug of Object.keys(seeded.projectIds)) buildProjectRepo(slug, join(root, 'remotes', spec.id), join(wsRoot, 'projects', slug));
    registry.push({ id: spec.id, path: wsRoot });
  }
  workspaceLoader.writeRegistry({ workspaces: registry }, root);
  const daemonDb = openDb(join(root, 'daemon.sqlite'));
  try { seedDaemonIncidents(daemonDb); } finally { daemonDb.close(); }
}

export interface DemoHandle extends DaemonHandle { dir: string }

/** Prepares the directory, starts the daemon in demo mode and fills in what only the running services can write. */
export async function startDemo(opts: DemoOptions = {}): Promise<DemoHandle> {
  const port = opts.port ?? 0;
  const dir = resolve(opts.dir ?? mkdtempSync(join(tmpdir(), 'weave-demo-')));
  await prepareDemoDir(dir, port);
  const handle = await startDaemon({ configDir: dir, listen: `127.0.0.1:${port}`, uiDir: opts.uiDir, demo: true });
  for (const ws of new Set(handle.workspaces.values())) {
    seedKnowledge(ws);
    // The specs pages are an index of each clone's `openspec/` folder.
    for (const p of ws.ctx.db.all<{ id: string }>('SELECT id FROM projects')) {
      try { await ws.services.specs.index(p.id); } catch (e) { ws.ctx.log('knowledge').warn({ err: String(e), project: p.id }, 'demo specs could not be indexed'); }
    }
  }
  return { ...handle, dir };
}
