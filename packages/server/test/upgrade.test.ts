/**
 * The deferred daemon upgrade (PLAN §20). Nothing here clones, builds, backs up, switches a symlink or
 * restarts anything: every one of those is a seam the service takes, and the tests hand it fakes.
 */
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Db, newId, nowIso } from '@weave-ai/db';
import { OcError, type Upgrade } from '@weave-ai/shared';
import { FakeRuntime } from '@weave-ai/runtime-sdk';
import { DaemonConfigSchema } from '@weave-ai/shared';
import { makeHarness as makeCoreHarness, type TestHarness } from '../../core/src/testing/context.js';
import { createWakeService } from '../../core/src/wake/index.js';
import { createRunsService } from '../../core/src/runs/index.js';
import { createDispatcher, type CoreDispatcher } from '../../core/src/runs/dispatcher.js';
import { createUpgradeService, type UpgradeDeps, type UpgradeService } from '../src/upgrade.js';
import type { WorkspaceRuntime } from '../src/types.js';

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

/** Fixture release paths. Each test owns a temp XDG data home whose `current` points at FROM, so rollback does not depend on a host daemon symlink (VS-214). */
const FROM_RELEASE = '/rel/20260101-120000-aaaaaaaaaa';
const TO_RELEASE = '/rel/20260202-120000-bbbbbbbbbb';

/** Wait for a condition the background pipeline reaches, rather than sleeping a guessed interval. */
async function until(predicate: () => boolean, timeoutMs = 4000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('condition was never reached');
    await tick(10);
  }
}

// ---------- a workspace whose dispatcher the test drives ----------

class FakeDispatcher {
  active = 0;
  stops = 0;
  starts = 0;
  running(): number { return this.active; }
  async stop(): Promise<void> { this.stops += 1; }
  start(): void { this.starts += 1; }
  async tick(): Promise<void> { /* not used */ }
}

interface Fixture {
  db: Db;
  dispatchers: Map<string, FakeDispatcher>;
  workspaces: Map<string, WorkspaceRuntime>;
  service(over?: Partial<UpgradeDeps>): UpgradeService;
  addWorkspace(id: string, opts?: { paused?: boolean; runIds?: string[] }): FakeDispatcher;
}

function fixture(): Fixture {
  const db = new Db(':memory:');
  db.migrate();
  const dispatchers = new Map<string, FakeDispatcher>();
  const workspaces = new Map<string, WorkspaceRuntime>();

  const addWorkspace = (id: string, opts: { paused?: boolean; runIds?: string[] } = {}): FakeDispatcher => {
    const wsDb = new Db(':memory:');
    wsDb.migrate();
    wsDb.run('INSERT INTO workspaces (id, slug, name, ticket_prefix, status, root_path, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)',
      [id, id, id, 'TST', opts.paused ? 'paused' : 'active', '/tmp/ws', nowIso(), nowIso()]);
    const dispatcher = new FakeDispatcher();
    dispatchers.set(id, dispatcher);
    const runtime = {
      id,
      ctx: { workspaceId: id, db: wsDb },
      services: { dispatcher, runs: { list: () => ({ items: (opts.runIds ?? []).map((r) => ({ id: r })), total: (opts.runIds ?? []).length }) } },
      channels: null, webhooks: null,
    } as unknown as WorkspaceRuntime;
    workspaces.set(id, runtime);
    return dispatcher;
  };

  const service = (over: Partial<UpgradeDeps> = {}): UpgradeService => createUpgradeService({
    db,
    daemon: DaemonConfigSchema.parse({ upgrade: { source: '/src/agent-conductor', ref: 'main', waitForIdleSec: 30, keep: 3 } }),
    configDir: '/tmp/config',
    workspaces,
    updates: {
      running: () => ({ version: '1.0.0', path: '/rel/a', sha: 'a'.repeat(40) }),
      check: () => ({ configured: true, running: { version: '1.0.0', path: '/rel/a', sha: 'a'.repeat(40) }, source: '/src/agent-conductor', ref: 'main', targetSha: 'b'.repeat(40), updateAvailable: true, checkedAt: nowIso(), error: null }),
    },
    version: '1.0.0',
    releaseRoot: FROM_RELEASE,
    build: () => ({ path: TO_RELEASE, sha: 'bbbbbbbbbb' }),
    backup: () => ['/tmp/config/backups/x/daemon.sqlite'],
    switchTo: () => ({ previous: FROM_RELEASE }),
    prune: () => [],
    spawnRunner: () => undefined,
    ...over,
  });

  return { db, dispatchers, workspaces, service, addWorkspace };
}

let fx: Fixture;
let dataRoot: string;
let savedXdg: string | undefined;

beforeEach(() => {
  savedXdg = process.env['XDG_DATA_HOME'];
  dataRoot = mkdtempSync(join(tmpdir(), 'ac-upgrade-xdg-'));
  process.env['XDG_DATA_HOME'] = dataRoot;
  mkdirSync(join(dataRoot, 'agent-conductor'), { recursive: true });
  symlinkSync(FROM_RELEASE, join(dataRoot, 'agent-conductor', 'current'));
  fx = fixture();
});
afterEach(() => {
  fx.db.close();
  if (savedXdg === undefined) delete process.env['XDG_DATA_HOME'];
  else process.env['XDG_DATA_HOME'] = savedXdg;
  rmSync(dataRoot, { recursive: true, force: true });
});

const state = (svc: UpgradeService): string | undefined => svc.status().upgrade?.state;
const row = (svc: UpgradeService): Upgrade => svc.status().upgrade!;

// ---------- 4.1 the record ----------

describe('requesting an upgrade', () => {
  it('creates a queued record naming the requester, the source and the ref', async () => {
    fx.addWorkspace('ws1');
    const svc = fx.service();
    const created = svc.request({ requestedBy: 'op1' });
    expect(created).toMatchObject({
      state: 'queued', source: '/src/agent-conductor', ref: 'main',
      targetSha: 'b'.repeat(40), requestedBy: 'op1', fromRelease: '/rel/20260101-120000-aaaaaaaaaa',
      log: [], backups: [], finishedAt: null,
    });
    await svc.settled();
  });

  it('records the target even when the source cannot be resolved right now', async () => {
    fx.addWorkspace('ws1');
    const svc = fx.service({ updates: { running: () => ({ version: '1.0.0', path: '/rel/a', sha: null }), check: () => { throw new Error('offline'); } } });
    expect(svc.request({ requestedBy: 'op1' }).targetSha).toBeNull();
    await svc.settled();
  });

  it('rejects a second request while one is in flight, and creates no second row', async () => {
    const d = fx.addWorkspace('ws1');
    d.active = 1; // keeps the first one waiting
    const svc = fx.service();
    svc.request({ requestedBy: 'op1' });
    await until(() => state(svc) === 'waiting');
    expect(() => svc.request({ requestedBy: 'op1' })).toThrow(OcError);
    expect(fx.db.all('SELECT id FROM upgrades')).toHaveLength(1);
    expect(state(svc)).toBe('waiting');
    svc.cancel();
    await svc.settled();
  });

  it('accepts a new request once the previous record is terminal', async () => {
    const d = fx.addWorkspace('ws1');
    d.active = 1;
    const svc = fx.service();
    svc.request({ requestedBy: 'op1' });
    await until(() => state(svc) === 'waiting');
    svc.cancel();
    d.active = 0;
    const second = svc.request({ requestedBy: 'op1' });
    expect(second.state).toBe('queued');
    expect(fx.db.all('SELECT id FROM upgrades')).toHaveLength(2);
    await svc.settled();
  });

  it('refuses to record anything when no source is configured', async () => {
    fx.addWorkspace('ws1');
    const svc = fx.service({ daemon: DaemonConfigSchema.parse({}) });
    expect(() => svc.request({ requestedBy: 'op1' })).toThrow(/no release source/);
    expect(fx.db.all('SELECT id FROM upgrades')).toHaveLength(0);
    await svc.settled();
  });
});

// ---------- 4.2 / 4.3 holding dispatch and the idle gate ----------

describe('holding dispatch and waiting for idle', () => {
  it('holds every loaded workspace as soon as the record exists', async () => {
    const a = fx.addWorkspace('ws1');
    const b = fx.addWorkspace('ws2');
    a.active = 1;
    const svc = fx.service();
    svc.request({ requestedBy: 'op1' });
    await until(() => a.stops === 1 && b.stops === 1);
    expect(state(svc)).toBe('waiting');
    svc.cancel();
    await svc.settled();
  });

  it('reports the work it is waiting for while it waits', async () => {
    const a = fx.addWorkspace('ws1', { runIds: ['run_1', 'run_2'] });
    fx.addWorkspace('ws2');
    a.active = 2;
    const svc = fx.service();
    svc.request({ requestedBy: 'op1' });
    await until(() => state(svc) === 'waiting');
    expect(svc.status().waitingFor).toEqual([{ workspace: 'ws1', running: 2, runIds: ['run_1', 'run_2'] }]);
    svc.cancel();
    await svc.settled();
  });

  it('proceeds as soon as the last executing run finishes', async () => {
    const a = fx.addWorkspace('ws1');
    a.active = 1;
    const svc = fx.service();
    svc.request({ requestedBy: 'op1' });
    await until(() => state(svc) === 'waiting');
    a.active = 0;
    await svc.settled();
    expect(state(svc)).toBe('restarting');
  });

  it('proceeds without waiting when nothing is executing', async () => {
    fx.addWorkspace('ws1');
    const svc = fx.service();
    svc.request({ requestedBy: 'op1' });
    await svc.settled();
    expect(state(svc)).toBe('restarting');
  });

  it('is not held by a run row an earlier daemon process left behind', async () => {
    // The row says running; nothing is executing in this process, which is what the gate reads.
    const a = fx.addWorkspace('ws1', { runIds: ['run_stale'] });
    a.active = 0;
    const svc = fx.service();
    svc.request({ requestedBy: 'op1' });
    await svc.settled();
    expect(state(svc)).toBe('restarting');
    expect(svc.status().waitingFor).toEqual([]);
  });

  it('proceeds to build once the wait expires, recording how many runs were still executing', async () => {
    const a = fx.addWorkspace('ws1');
    a.active = 1;
    let built = 0;
    let switched = 0;
    const svc = fx.service({
      daemon: DaemonConfigSchema.parse({ upgrade: { source: '/src', ref: 'main', waitForIdleSec: 0 } }),
      build: () => { built += 1; return { path: '/rel/new', sha: 'n' }; },
      switchTo: () => { switched += 1; return { previous: null }; },
    });
    svc.request({ requestedBy: 'op1' });
    await svc.settled();
    // Proceeds exactly as the idle outcome does: no failure, dispatch is not resumed by this process —
    // the run still executing is ended and resumed by the restart, not by this upgrade (VS-115).
    expect(row(svc)).toMatchObject({ state: 'restarting', reason: null, interruptedRuns: 1 });
    expect(built).toBe(1);
    expect(switched).toBe(1);
    expect(a.starts).toBe(0);
  });

  it('leaves a workspace that was already paused paused when dispatch resumes', async () => {
    const active = fx.addWorkspace('ws1');
    const paused = fx.addWorkspace('ws2', { paused: true });
    active.active = 1;
    const svc = fx.service();
    svc.request({ requestedBy: 'op1' });
    await until(() => state(svc) === 'waiting');
    svc.cancel();
    expect(active.starts).toBe(1);
    expect(paused.starts).toBe(0);
    await svc.settled();
  });
});

// ---------- 4.4 cancellation ----------

describe('cancelling', () => {
  it('cancels a waiting upgrade and resumes dispatch', async () => {
    const a = fx.addWorkspace('ws1');
    a.active = 1;
    const svc = fx.service();
    svc.request({ requestedBy: 'op1' });
    await until(() => state(svc) === 'waiting');
    const cancelled = svc.cancel();
    expect(cancelled.state).toBe('cancelled');
    expect(cancelled.finishedAt).not.toBeNull();
    expect(a.starts).toBe(1);
    a.active = 0;
    await svc.settled();
    // The pipeline noticed and stopped: it never moved past cancelled.
    expect(state(svc)).toBe('cancelled');
    expect(svc.status().waitingFor).toEqual([]);
  });

  it('refuses to cancel once the build has started, and the build carries on', async () => {
    fx.addWorkspace('ws1');
    let finishBuild: (() => void) = () => undefined;
    const building = new Promise<void>((r) => { finishBuild = r; });
    const svc = fx.service({
      // Holds the pipeline inside `building`, so cancellation is attempted at exactly that point.
      build: async () => { await building; return { path: '/rel/new', sha: 'n' }; },
    });
    svc.request({ requestedBy: 'op1' });
    await until(() => state(svc) === 'building');

    expect(() => svc.cancel()).toThrow(OcError);
    expect(state(svc)).toBe('building');

    finishBuild();
    await svc.settled();
    expect(state(svc)).toBe('restarting');
  });

  it('reports no upgrade to cancel when none is in flight', () => {
    fx.addWorkspace('ws1');
    const svc = fx.service();
    expect(() => svc.cancel()).toThrow(/no upgrade is in flight/);
  });

  it('leaves no pending upgrade behind', async () => {
    const a = fx.addWorkspace('ws1');
    a.active = 1;
    const svc = fx.service();
    svc.request({ requestedBy: 'op1' });
    await until(() => state(svc) === 'waiting');
    svc.cancel();
    a.active = 0;
    // A cancelled record is terminal, so the next request is accepted rather than rejected as a conflict.
    expect(() => svc.request({ requestedBy: 'op1' })).not.toThrow();
    await svc.settled();
  });
});

// ---------- 4.5 the build ----------

describe('building', () => {
  it('keeps a bounded tail of the build output on the record', async () => {
    fx.addWorkspace('ws1');
    const svc = fx.service({
      build: (o) => {
        for (let i = 0; i < 250; i += 1) o.onOutput(`line ${i}`);
        return { path: '/rel/new', sha: 'n' };
      },
    });
    svc.request({ requestedBy: 'op1' });
    await svc.settled();
    const log = row(svc).log;
    expect(log).toHaveLength(200);
    expect(log[0]).toBe('line 50');
    expect(log[log.length - 1]).toBe('line 249');
  });

  it('fails with the reason and the output, resumes dispatch and touches no symlink', async () => {
    const a = fx.addWorkspace('ws1');
    let switched = 0;
    const svc = fx.service({
      build: (o) => { o.onOutput('$ pnpm build'); o.onOutput('error TS1005'); throw new Error('pnpm build exited 1'); },
      switchTo: () => { switched += 1; return { previous: null }; },
    });
    svc.request({ requestedBy: 'op1' });
    await svc.settled();
    expect(row(svc)).toMatchObject({ state: 'failed', reason: 'build_failed', message: 'pnpm build exited 1' });
    expect(row(svc).log).toEqual(['$ pnpm build', 'error TS1005']);
    expect(switched).toBe(0);
    expect(a.starts).toBe(1);
  });

  it('passes --test through to the build when it was asked for', async () => {
    fx.addWorkspace('ws1');
    const seen: boolean[] = [];
    const svc = fx.service({ build: (o) => { seen.push(o.test); return { path: '/rel/new', sha: 'n' }; } });
    svc.request({ requestedBy: 'op1', test: true });
    await svc.settled();
    expect(seen).toEqual([true]);
  });
});

// ---------- 4.6 backups and the switch ----------

describe('switching', () => {
  it('backs the databases up before the symlink moves and records where they went', async () => {
    fx.addWorkspace('ws1');
    const order: string[] = [];
    const svc = fx.service({
      backup: () => { order.push('backup'); return ['/backups/daemon.sqlite', '/backups/workspace-ws1.sqlite']; },
      switchTo: () => { order.push('switch'); return { previous: '/rel/old' }; },
    });
    svc.request({ requestedBy: 'op1' });
    await svc.settled();
    expect(order).toEqual(['backup', 'switch']);
    expect(row(svc).backups).toEqual(['/backups/daemon.sqlite', '/backups/workspace-ws1.sqlite']);
  });

  it('fails before the symlink moves when a backup cannot be written', async () => {
    const a = fx.addWorkspace('ws1');
    let switched = 0;
    const svc = fx.service({
      backup: () => { throw new Error('EACCES: permission denied'); },
      switchTo: () => { switched += 1; return { previous: null }; },
    });
    svc.request({ requestedBy: 'op1' });
    await svc.settled();
    expect(row(svc)).toMatchObject({ state: 'failed', reason: 'backup_failed' });
    expect(row(svc).message).toContain('EACCES');
    expect(switched).toBe(0);
    expect(a.starts).toBe(1);
  });

  it('prunes to the configured keep after switching', async () => {
    fx.addWorkspace('ws1');
    const keeps: number[] = [];
    const svc = fx.service({ prune: (k) => { keeps.push(k); return []; } });
    svc.request({ requestedBy: 'op1' });
    await svc.settled();
    expect(keeps).toEqual([3]);
  });
});

// ---------- 4.7 the hand-off ----------

describe('handing off the restart', () => {
  it('reaches restarting with the target recorded and asks for the runner', async () => {
    fx.addWorkspace('ws1');
    const spawns: Array<{ upgradeId: string; release: string }> = [];
    const svc = fx.service({ spawnRunner: (o) => { spawns.push(o); } });
    const created = svc.request({ requestedBy: 'op1' });
    await svc.settled();
    expect(row(svc)).toMatchObject({ state: 'restarting', toRelease: TO_RELEASE, toSha: 'bbbbbbbbbb' });
    expect(spawns).toEqual([{ upgradeId: created.id, release: TO_RELEASE }]);
  });

  it('answers the request before the restart is handed off, and does not terminate answering it', async () => {
    fx.addWorkspace('ws1');
    const order: string[] = [];
    const svc = fx.service({ spawnRunner: () => { order.push('spawn'); } });
    const created = svc.request({ requestedBy: 'op1' });
    order.push('answered');
    expect(created.state).toBe('queued');
    await svc.settled();
    expect(order).toEqual(['answered', 'spawn']);
  });

  it('puts `current` back and fails when the runner cannot be started', async () => {
    const a = fx.addWorkspace('ws1');
    const switches: string[] = [];
    const svc = fx.service({
      switchTo: (p) => { switches.push(p); return { previous: null }; },
      spawnRunner: () => { throw new Error('systemd-run: not found'); },
    });
    svc.request({ requestedBy: 'op1' });
    await svc.settled();
    expect(row(svc)).toMatchObject({ state: 'failed', reason: 'restart_failed' });
    expect(row(svc).message).toContain('systemd-run: not found');
    expect(switches).toEqual([TO_RELEASE, FROM_RELEASE]);
    expect(a.starts).toBe(1);
  });
});

// ---------- 4.8 reconciliation at startup ----------

describe('reconciling at startup', () => {
  const seed = (over: Partial<Upgrade>): string => {
    const id = newId();
    fx.db.insert('upgrades', {
      id, state: 'restarting', source: '/src', ref: 'main', requestedBy: 'op1',
      requestedAt: nowIso(), startedAt: nowIso(), logJson: [], backupsJson: [], ...over,
    });
    return id;
  };

  it('completes a restarting record when this process is running its target', () => {
    seed({ toRelease: '/rel/20260202-120000-bbbbbbbbbb', toSha: 'bbbbbbbbbb' });
    const svc = fx.service({ releaseRoot: '/rel/20260202-120000-bbbbbbbbbb', version: '1.1.0' });
    svc.reconcile();
    expect(row(svc)).toMatchObject({ state: 'completed', cameBackVersion: '1.1.0', reason: null });
  });

  it('leaves a restarting record alone while the runner may still be working', () => {
    seed({ toRelease: '/rel/new', toSha: 'nnnn', startedAt: nowIso() });
    const svc = fx.service({ releaseRoot: '/rel/20260101-120000-aaaaaaaaaa' });
    svc.reconcile();
    expect(state(svc)).toBe('restarting');
  });

  it('fails a restarting record that came back on another release past the verify window', () => {
    seed({ toRelease: '/rel/new', toSha: 'nnnn', startedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString() });
    const svc = fx.service({ releaseRoot: '/rel/20260101-120000-aaaaaaaaaa' });
    svc.reconcile();
    expect(row(svc)).toMatchObject({ state: 'failed', reason: 'restart_unverified' });
    expect(row(svc).message).toContain('/rel/new');
  });

  it('fails a record abandoned before the restart, so it cannot block the next upgrade', () => {
    fx.addWorkspace('ws1');
    for (const state of ['queued', 'waiting', 'building', 'switching'] as const) {
      fx.db.run('DELETE FROM upgrades');
      seed({ state });
      const svc = fx.service();
      svc.reconcile();
      expect(row(svc)).toMatchObject({ state: 'failed', reason: 'abandoned' });
      expect(() => svc.request({ requestedBy: 'op1' })).not.toThrow();
      fx.db.run('DELETE FROM upgrades');
    }
  });

  it('does nothing when the last record is already terminal', () => {
    seed({ state: 'completed', finishedAt: nowIso() });
    const svc = fx.service();
    svc.reconcile();
    expect(state(svc)).toBe('completed');
  });

  // An upgrade is recorded daemon-level, but the changelog (PLAN §13.6) is per workspace, so a
  // completed upgrade has to be pushed outward into each one.
  describe('the changelog entry a completed upgrade leaves', () => {
    // Aliasing details_json would bypass the db wrapper's JSON decoding, so it is parsed here instead.
    const upgradeRows = (id: string) =>
      (fx.workspaces.get(id)!.ctx.db as Db).all<{ entityId: string; ticketId: string | null; projectId: string | null; actorKind: string; details: string }>(
        "SELECT entity_id, ticket_id, project_id, actor_kind, details_json AS details FROM activity WHERE action = 'daemon.upgraded'")
        .map((r) => ({ ...r, details: JSON.parse(r.details) as Record<string, unknown> }));

    it('writes one entry in every registered workspace', () => {
      fx.addWorkspace('ws1');
      fx.addWorkspace('ws2');
      const upgradeId = seed({ toRelease: '/rel/new', toSha: 'nnnn', fromRelease: '/rel/old' });
      fx.service({ releaseRoot: '/rel/new', version: '1.1.0' }).reconcile();

      for (const ws of ['ws1', 'ws2']) {
        const rows = upgradeRows(ws);
        expect(rows).toHaveLength(1);
        // It belongs to no project and no ticket: it is a workspace-level event.
        expect(rows[0]).toMatchObject({ entityId: upgradeId, ticketId: null, projectId: null, actorKind: 'system' });
        expect(rows[0]!.details).toMatchObject({ fromRelease: '/rel/old', toRelease: '/rel/new', version: '1.1.0' });
      }
    });

    it('writes nothing a second time when the same upgrade is reconciled again', () => {
      fx.addWorkspace('ws1');
      seed({ toRelease: '/rel/new', toSha: 'nnnn' });
      const svc = fx.service({ releaseRoot: '/rel/new', version: '1.1.0' });
      svc.reconcile();
      svc.reconcile();
      fx.service({ releaseRoot: '/rel/new', version: '1.1.0' }).reconcile();
      expect(upgradeRows('ws1')).toHaveLength(1);
    });

    it('leaves no entry for an upgrade that did not complete', () => {
      fx.addWorkspace('ws1');
      seed({ toRelease: '/rel/new', toSha: 'nnnn', startedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString() });
      fx.service({ releaseRoot: '/rel/other' }).reconcile();
      expect(state(fx.service({ releaseRoot: '/rel/other' }))).toBe('failed');
      expect(upgradeRows('ws1')).toEqual([]);
    });
  });
});

// ---------- the gate against the real dispatcher ----------

describe('the idle gate against a real dispatcher', () => {
  let h: TestHarness;
  let runtime: FakeRuntime;
  let dispatcher: CoreDispatcher;
  let svc: UpgradeService;

  beforeEach(() => {
    h = makeCoreHarness();
    runtime = new FakeRuntime();
    h.ctx.registries.runtimes.set('fake', runtime);
    h.ctx.config.models = { weaver: { runtime: 'fake', model: null }, workers: { runtime: 'fake', model: null }, workerOptions: [] };
    h.services.wake = createWakeService(h.ctx, h.deps);
    h.services.runs = createRunsService(h.ctx, h.deps);
    dispatcher = createDispatcher(h.ctx, h.deps);
    h.services.dispatcher = dispatcher;

    const workspaces = new Map<string, WorkspaceRuntime>([['test', {
      id: 'test', ctx: h.ctx, services: h.deps(), channels: null, webhooks: null,
    } as unknown as WorkspaceRuntime]]);
    svc = createUpgradeService({
      db: fx.db,
      daemon: DaemonConfigSchema.parse({ upgrade: { source: '/src', ref: 'main', waitForIdleSec: 30 } }),
      configDir: '/tmp/config', workspaces,
      updates: {
        running: () => ({ version: '1.0.0', path: '/rel/a', sha: null }),
        check: () => ({ configured: true, running: { version: '1.0.0', path: '/rel/a', sha: null }, source: '/src', ref: 'main', targetSha: null, updateAvailable: false, checkedAt: null, error: null }),
      },
      version: '1.0.0', releaseRoot: '/rel/20260101-120000-aaaaaaaaaa',
      build: () => ({ path: '/rel/new', sha: 'n' }),
      backup: () => [], switchTo: () => ({ previous: null }), prune: () => [], spawnRunner: () => undefined,
    });
  });
  afterEach(async () => { await dispatcher.stop(); h.cleanup(); });

  it('lets a turn that is already running finish instead of cancelling it', async () => {
    runtime.delayMs = 150;
    runtime.queue.push({ structured: { state: 'done', summary: 'finished', tickets: [], knowledge: { recorded: false, reason: 'test fixture' } } });
    h.services.wake!.enqueue(h.conductorId, { source: 'human_message', reason: 'do a thing' });

    await dispatcher.tick();
    expect(dispatcher.running()).toBe(1);

    svc.request({ requestedBy: 'op1' });
    await svc.settled();

    const run = h.db.get<{ status: string; summary: string | null }>('SELECT * FROM runs ORDER BY created_at DESC LIMIT 1');
    expect(run?.status).toBe('succeeded');
    expect(run?.summary).toBe('finished');
    expect(svc.status().upgrade?.state).toBe('restarting');
  });

  it('starts no run for a wake raised while the upgrade is pending, and leaves the wake queued', async () => {
    runtime.delayMs = 200;
    runtime.queue.push({ structured: { state: 'done', summary: 'first', tickets: [], knowledge: { recorded: false, reason: 'test fixture' } } });
    h.services.wake!.enqueue(h.conductorId, { source: 'human_message', reason: 'first' });
    await dispatcher.tick();

    svc.request({ requestedBy: 'op1' });
    const held = h.services.wake!.enqueue(h.conductorId, { source: 'human_message', reason: 'while the upgrade waits' });
    await svc.settled();

    expect(h.db.get<{ status: string }>('SELECT status FROM wakeups WHERE id = ?', [held.id])?.status).toBe('queued');
    expect(h.db.all('SELECT id FROM runs')).toHaveLength(1);
  });

  it('dispatches the held wake once a cancellation resumes the dispatcher', async () => {
    runtime.delayMs = 100;
    runtime.queue.push({ structured: { state: 'done', summary: 'first', tickets: [], knowledge: { recorded: false, reason: 'test fixture' } } });
    runtime.queue.push({ structured: { state: 'done', summary: 'second', tickets: [], knowledge: { recorded: false, reason: 'test fixture' } } });
    h.services.wake!.enqueue(h.conductorId, { source: 'human_message', reason: 'first' });
    await dispatcher.tick();

    svc.request({ requestedBy: 'op1' });
    const held = h.services.wake!.enqueue(h.conductorId, { source: 'human_message', reason: 'held' });
    await until(() => svc.status().upgrade?.state === 'waiting');
    svc.cancel();
    await svc.settled();
    await dispatcher.drain();

    await dispatcher.tick();
    await dispatcher.drain();
    expect(h.db.get<{ status: string }>('SELECT status FROM wakeups WHERE id = ?', [held.id])?.status).toBe('completed');
    expect(h.db.all('SELECT id FROM runs')).toHaveLength(2);
  });
});
