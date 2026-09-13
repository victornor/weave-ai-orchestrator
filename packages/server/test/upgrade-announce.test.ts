/**
 * The upgrade announcement (VS-76, `daemon-upgrade/upgrade-announcement`). No release directory, no
 * channel and no daemon: the upgrade row and the workspace databases are real, and the two things the
 * announcement reaches — the primary chat thread and the conductor's wake queue — are recorded by fakes.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Db, newId, nowIso } from '@weave-ai/db';
import { DaemonConfigSchema, type Upgrade, type UpgradeAnnouncement, type UpgradeState } from '@weave-ai/shared';
import { createUpgradeService, type UpgradeDeps, type UpgradeService } from '../src/upgrade.js';
import { announcementReason, announcementText, releaseBuiltAt, releaseWindow, upgradeMigrations } from '../src/upgrade-announce.js';
import type { WorkspaceRuntime } from '../src/types.js';

const FROM = '/rel/20260101-120000-aaaaaaaaaa';   // built 2026-01-01 12:00 local
const TO = '/rel/20260202-120000-bbbbbbbbbb';     // built 2026-02-02 12:00 local

/** Release directories built by a test, removed afterwards. */
const tmpDirs: string[] = [];

/** An instant `days` after the release directory `path` says it was built. */
const afterBuild = (path: string, days: number): string =>
  new Date(Date.parse(releaseBuiltAt(path)!) + days * 24 * 3600 * 1000).toISOString();

interface Sent { text: string }
interface Woken { agentId: string; source: string; reason: string; payload: UpgradeAnnouncement }

interface Workspace {
  id: string;
  db: Db;
  runtime: WorkspaceRuntime;
  sent: Sent[];
  woken: Woken[];
  supervisorRunning: boolean;
  /** Land a ticket at `at`: the delivery record the announcement reads. */
  land(identifier: string, title: string, at: string): void;
  /** A wake sitting in the queue that no interrupted run owns. */
  queueWake(): void;
  /** A run the previous shutdown recorded `interrupted_by_shutdown`, with a wake left queued (VS-339). */
  interruptRun(at: string, opts?: { resume?: boolean }): void;
}

interface Fixture {
  db: Db;
  workspaces: Map<string, WorkspaceRuntime>;
  list: Workspace[];
  service(over?: Partial<UpgradeDeps>): UpgradeService;
  addWorkspace(id: string): Workspace;
  seed(over?: Partial<Upgrade>): Upgrade;
}

function fixture(): Fixture {
  const db = new Db(':memory:');
  db.migrate();
  const workspaces = new Map<string, WorkspaceRuntime>();
  const list: Workspace[] = [];

  const addWorkspace = (id: string): Workspace => {
    const wsDb = new Db(':memory:');
    wsDb.migrate();
    wsDb.run('INSERT INTO workspaces (id, slug, name, ticket_prefix, status, root_path, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)',
      [id, id, id, 'TST', 'active', '/tmp/ws', nowIso(), nowIso()]);
    wsDb.run('INSERT INTO agents (id, workspace_id, kind, name, runtime_id, status, home_path, turn_epoch, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
      [`${id}-conductor`, id, 'weaver', 'Weaver', 'claude', 'active', '/tmp/home', 0, nowIso(), nowIso()]);

    const ws: Workspace = {
      id, db: wsDb, sent: [], woken: [], supervisorRunning: true,
      runtime: null as unknown as WorkspaceRuntime,
      land(identifier, title, at) {
        const ticketId = newId();
        wsDb.run(`INSERT INTO tickets (id, workspace_id, number, identifier, kind, title, status, created_by_kind, created_at, updated_at)
                  VALUES (?,?,?,?,?,?,?,?,?,?)`,
          [ticketId, id, wsDb.all('SELECT id FROM tickets').length + 1, identifier, 'task', title, 'done', 'agent', at, at]);
        wsDb.run(`INSERT INTO activity (id, workspace_id, actor_kind, action, entity_type, entity_id, ticket_id, created_at)
                  VALUES (?,?,?,?,?,?,?,?)`,
          [newId(), id, 'system', 'ticket.delivery_landed', 'ticket', ticketId, ticketId, at]);
      },
      queueWake() {
        wsDb.run('INSERT INTO wakeups (id, workspace_id, agent_id, source, reason, status, created_at) VALUES (?,?,?,?,?,?,?)',
          [newId(), id, `${id}-conductor`, 'ticket_assigned', 'work', 'queued', nowIso()]);
      },
      interruptRun(at, opts = {}) {
        const runId = newId();
        const wakeId = newId();
        if (opts.resume !== false) {
          wsDb.run('INSERT INTO wakeups (id, workspace_id, agent_id, source, reason, status, created_at) VALUES (?,?,?,?,?,?,?)',
            [wakeId, id, `${id}-conductor`, 'retry', 'previous turn was interrupted', 'queued', at]);
        }
        wsDb.run(
          `INSERT INTO runs (id, workspace_id, agent_id, wakeup_ids_json, runtime_id, status, turn_epoch, cwd, error_code, error_family, finished_at, created_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
          [runId, id, `${id}-conductor`, JSON.stringify([wakeId]), 'claude', 'interrupted', 1, '/tmp/home', 'interrupted_by_shutdown', 'tooling', at, at]);
      },
    };

    ws.runtime = {
      id,
      ctx: { workspaceId: id, db: wsDb },
      services: {
        dispatcher: { running: () => 0, stop: async () => undefined, start: () => undefined },
        runs: { list: () => ({ items: [], total: 0 }) },
        supervisor: { running: () => ws.supervisorRunning },
        threads: { notifyHuman: async (_actor: unknown, message: { text: string }) => { ws.sent.push({ text: message.text }); } },
        workers: { ensureConductor: async () => ({ id: `${id}-conductor` }) },
        wake: {
          enqueue: (agentId: string, input: { source: string; reason: string; payload: UpgradeAnnouncement }) => {
            ws.woken.push({ agentId, source: input.source, reason: input.reason, payload: input.payload });
            return { id: newId() };
          },
        },
      },
      channels: null, webhooks: null, push: null,
    } as unknown as WorkspaceRuntime;

    workspaces.set(id, ws.runtime);
    list.push(ws);
    return ws;
  };

  const service = (over: Partial<UpgradeDeps> = {}): UpgradeService => createUpgradeService({
    db,
    daemon: DaemonConfigSchema.parse({ upgrade: { source: '/src/agent-conductor', ref: 'main' } }),
    configDir: '/tmp/config',
    workspaces,
    updates: {
      running: () => ({ version: '1.1.0', path: TO, sha: 'b'.repeat(40) }),
      check: () => ({ configured: true, running: { version: '1.1.0', path: TO, sha: 'b'.repeat(40) }, source: '/src', ref: 'main', targetSha: null, updateAvailable: false, checkedAt: nowIso(), error: null }),
    },
    version: '1.1.0',
    releaseRoot: TO,
    runtimes: () => ['claude', 'codex'],
    build: () => ({ path: TO, sha: 'bbbbbbbbbb' }),
    backup: () => [],
    switchTo: () => ({ previous: FROM }),
    prune: () => [],
    spawnRunner: () => undefined,
    ...over,
  });

  /** An upgrade as the daemon that comes back finds it: terminal, and not yet announced. */
  const seed = (over: Partial<Upgrade> = {}): Upgrade => {
    const id = newId();
    db.insert('upgrades', {
      id, state: 'completed' as UpgradeState, source: '/src', ref: 'main',
      fromRelease: FROM, toRelease: TO, toSha: 'b'.repeat(40),
      requestedBy: 'op1', requestedAt: afterBuild(TO, -0.5), startedAt: afterBuild(TO, -0.4),
      finishedAt: afterBuild(TO, 0.1), cameBackVersion: '1.1.0', drainedRuns: 2,
      logJson: [], backupsJson: [],
      ...over,
    });
    return db.get<Upgrade>('SELECT * FROM upgrades WHERE id = ?', [id])!;
  };

  return { db, workspaces, list, service, addWorkspace, seed };
}

let fx: Fixture;
beforeEach(() => { fx = fixture(); });
afterEach(() => {
  fx.db.close();
  for (const w of fx.list) w.db.close();
  while (tmpDirs.length) rmSync(tmpDirs.pop()!, { recursive: true, force: true });
});

/**
 * A release directory whose `packages/db/dist/migrations` holds exactly `files`. Named `<stamp>-<sha>`
 * so `releaseBuiltAt`/`releaseSha` read it like a real release directory.
 */
function releaseMigrationsDir(stamp: string, sha: string, files: string[]): string {
  const base = mkdtempSync(join(tmpdir(), 'ac-relmig-'));
  tmpDirs.push(base);
  const dir = join(base, `${stamp}-${sha}`);
  const migrations = join(dir, 'packages', 'db', 'dist', 'migrations');
  mkdirSync(migrations, { recursive: true });
  for (const f of files) writeFileSync(join(migrations, f), '');
  return dir;
}

// ---------- the release window, on its own ----------

describe('the release window', () => {
  it('reads the build time out of a release directory name', () => {
    expect(releaseBuiltAt(FROM)).toBe(new Date(2026, 0, 1, 12, 0, 0).toISOString());
    expect(releaseBuiltAt('/rel/handmade')).toBeNull();
    expect(releaseBuiltAt(null)).toBeNull();
  });

  it('leaves the window open when a release cannot be dated', () => {
    const now = nowIso();
    const row = { fromRelease: '/rel/handmade', toRelease: TO } as Upgrade;
    expect(releaseWindow(row, now)).toEqual({ since: null, until: releaseBuiltAt(TO) });
    expect(releaseWindow({ fromRelease: FROM, toRelease: null } as Upgrade, now).until).toBe(now);
  });
});

// ---------- the migration window, on its own (VS-315) ----------

describe('the migration window', () => {
  const row = { fromRelease: 'from', toRelease: 'to' } as Upgrade;
  const files: Record<string, string[]> = {
    from: ['0001_a.sql', '0002_b.sql'],
    to: ['0001_a.sql', '0002_b.sql', '0030_x.sql'],
  };
  const read = (r: string | null): string[] => (r ? files[r] ?? [] : []);

  it('is the target release minus the source, restricted to what the databases record as applied', () => {
    expect(upgradeMigrations(row, read, ['0001_a.sql', '0002_b.sql', '0030_x.sql'])).toEqual(['0030_x.sql']);
  });

  it('never names a migration the databases do not record as applied', () => {
    expect(upgradeMigrations(row, read, ['0001_a.sql', '0002_b.sql'])).toEqual([]);
  });

  it('falls back to the target when the source release cannot be read, still bounded by the applied set', () => {
    expect(upgradeMigrations(row, (r) => (r === 'to' ? files['to']! : []), ['0001_a.sql', '0030_x.sql']))
      .toEqual(['0001_a.sql', '0030_x.sql']);
  });

  it('names nothing when the target release cannot be read', () => {
    expect(upgradeMigrations(row, () => [], ['0030_x.sql'])).toEqual([]);
  });
});

// ---------- a completed upgrade ----------

describe('announcing a completed upgrade', () => {
  it('posts one line on the chat and wakes the conductor with what changed', async () => {
    const ws = fx.addWorkspace('ws1');
    ws.land('TST-1', 'Landed inside the window', afterBuild(FROM, 3));
    ws.land('TST-2', 'Landed after the release was built', afterBuild(TO, 1));
    ws.land('TST-0', 'Landed before the previous release', afterBuild(FROM, -3));
    // VS-339: one turn the restart cut off (its wake queued to resume), plus an unrelated queued wake
    // that must not be counted as resumed.
    ws.interruptRun(afterBuild(TO, 0.05));
    ws.queueWake();
    const upgrade = fx.seed();

    await fx.service().announce();

    expect(ws.sent).toHaveLength(1);
    expect(ws.sent[0]!.text).toMatch(/^Upgraded to 1\.1\.0, back up at \d\d:\d\d\.$/);

    expect(ws.woken).toHaveLength(1);
    const wake = ws.woken[0]!;
    expect(wake.agentId).toBe('ws1-conductor');
    expect(wake.source).toBe('system');
    expect(wake.reason).toBe('The daemon upgraded to 1.1.0 and is back up');
    expect(wake.payload).toMatchObject({
      kind: 'daemon.upgraded', upgradeId: upgrade.id, outcome: 'completed',
      from: { path: FROM }, to: { path: TO, sha: 'b'.repeat(40), version: '1.1.0' },
      running: { path: TO, version: '1.1.0' },
      startedAt: upgrade.startedAt, finishedAt: upgrade.finishedAt,
      runs: { drained: 2, interrupted: 1, resumed: 1 },
      health: { ok: true },
      failure: null,
    });
    expect(wake.payload.tickets.map((t) => t.identifier)).toEqual(['TST-1']);
    expect(wake.payload.ticketsOmitted).toBe(0);
    expect(wake.payload.health.checks.map((c) => c.name)).toEqual(['database', 'supervisor', 'runtimes']);
    // The release directories are not on disk, so there is no window to read and no migration is
    // named. This is the release's migrations, not this boot's in-memory applied list (VS-315).
    expect(wake.payload.migrations).toEqual([]);
  });

  it('names the failing check instead of claiming the system is back up', async () => {
    const ws = fx.addWorkspace('ws1');
    ws.supervisorRunning = false;
    fx.seed();

    await fx.service().announce();

    expect(ws.sent[0]!.text).toMatch(/not fully back up: supervisor \(not ticking\) failed\./);
    expect(ws.woken[0]!.payload.health).toMatchObject({ ok: false });
    expect(ws.woken[0]!.payload.health.checks).toContainEqual({ name: 'supervisor', ok: false, detail: 'not ticking' });
  });

  it('announces into every loaded workspace, and one that throws does not stop the others', async () => {
    const a = fx.addWorkspace('ws1');
    const b = fx.addWorkspace('ws2');
    (a.runtime.services as unknown as { threads: { notifyHuman: () => Promise<void> } }).threads = {
      notifyHuman: () => Promise.reject(new Error('channel is down')),
    };
    fx.seed();

    await fx.service().announce();

    expect(a.sent).toHaveLength(0);
    expect(b.sent).toHaveLength(1);
    expect(b.woken).toHaveLength(1);
  });
});

// ---------- the outcome follows the running release (VS-315) ----------

describe('the outcome follows the running release, not the record alone', () => {
  it('never announces completed when the record says completed but another release is serving', async () => {
    const ws = fx.addWorkspace('ws1');
    fx.seed({ state: 'completed', toRelease: TO, toSha: 'b'.repeat(40), cameBackVersion: '1.1.0' });
    await fx.service({ releaseRoot: FROM, version: '1.0.0' }).announce();

    const payload = ws.woken[0]!.payload;
    expect(payload.outcome).toBe('recorded_completed');
    expect(payload.running).toMatchObject({ path: FROM, version: '1.0.0' });
    expect(payload.to.version).toBeNull();
    expect(ws.sent[0]!.text).toMatch(/^The upgrade to bbbbbbb is recorded completed, but this daemon is running 1\.0\.0, back up at \d\d:\d\d\.$/);
    expect(ws.woken[0]!.reason).toMatch(/^The upgrade to bbbbbbb is recorded completed, but the daemon is running 1\.0\.0$/);
  });

  it('accepts a different release path when the commit is the record\'s target', async () => {
    const ws = fx.addWorkspace('ws1');
    fx.seed({ state: 'completed', toRelease: '/rel/20260202-130000-bbbbbbbbbb', toSha: 'b'.repeat(10) });
    await fx.service({ releaseRoot: TO, version: '1.1.0' }).announce();
    expect(ws.woken[0]!.payload.outcome).toBe('completed');
  });
});

// ---------- the migrations named are the release's (VS-315) ----------

describe('the migrations named belong to the release window', () => {
  const migrationsDir = fileURLToPath(new URL('../../db/src/migrations', import.meta.url));

  it('names the release window even when an earlier process applied the migrations', async () => {
    const ws = fx.addWorkspace('ws1');
    const all = readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();
    const introduced = all.slice(-2);            // the incident's 0030/0031 shape
    const source = releaseMigrationsDir('20260101-120000', 'a'.repeat(10), all.slice(0, -2));
    const target = releaseMigrationsDir('20260202-120000', 'b'.repeat(10), all);

    // An earlier process ran them: this instance applied nothing, so its in-memory list is empty while
    // the durable `meta` rows remain. Only the release window and the durable record are consulted.
    (fx.db as unknown as { appliedMigrations: string[] }).appliedMigrations = [];
    (ws.db as unknown as { appliedMigrations: string[] }).appliedMigrations = [];

    fx.seed({ fromRelease: source, toRelease: target, toSha: 'b'.repeat(10) });
    await fx.service({ releaseRoot: target, version: '1.1.0' }).announce();

    expect(ws.woken[0]!.payload.migrations).toEqual(introduced);
  });
});

// ---------- the landed list and its cap (VS-315) ----------

describe('the landed list collapses duplicates, keeps the newest and reports its cap', () => {
  it('lists each ticket once, at its most recent landing, newest first', async () => {
    const ws = fx.addWorkspace('ws1');
    ws.land('TST-1', 'landed then re-landed', afterBuild(FROM, 3));
    ws.land('TST-2', 'landed once', afterBuild(FROM, 4));
    ws.land('TST-1', 'landed then re-landed', afterBuild(FROM, 5));
    fx.seed();

    await fx.service().announce();

    const payload = ws.woken[0]!.payload;
    expect(payload.tickets.map((t) => t.identifier)).toEqual(['TST-1', 'TST-2']);
    expect(payload.tickets[0]!.at).toBe(afterBuild(FROM, 5));
    expect(payload.ticketsOmitted).toBe(0);
    expect(ws.sent[0]!.text).not.toMatch(/not listed/);
  });

  it('keeps the newest twenty and states how many it left out', async () => {
    const ws = fx.addWorkspace('ws1');
    for (let n = 1; n <= 25; n++) ws.land(`TST-${n}`, `landed ${n}`, afterBuild(FROM, n));
    // TST-5 lands a second time, newest of all: it must appear once, at day 30.
    ws.land('TST-5', 'landed 5 again', afterBuild(FROM, 30));
    fx.seed();

    await fx.service().announce();

    const payload = ws.woken[0]!.payload;
    expect(payload.tickets).toHaveLength(20);
    expect(new Set(payload.tickets.map((t) => t.identifier)).size).toBe(20);
    expect(payload.tickets[0]).toMatchObject({ identifier: 'TST-5', at: afterBuild(FROM, 30) });
    expect(payload.tickets.map((t) => t.identifier)).not.toContain('TST-6');
    expect(payload.ticketsOmitted).toBe(5);
    expect(ws.sent[0]!.text).toMatch(/ 5 more landed tickets not listed\.$/);
  });
});

// ---------- failure and rollback ----------

describe('announcing a failure', () => {
  it('reports a rollback with the reason and the release now running', async () => {
    const ws = fx.addWorkspace('ws1');
    fx.seed({
      state: 'failed', reason: 'restart_failed', message: 'no healthy daemon on /rel/20260303-120000-cccccccccc',
      toRelease: '/rel/20260303-120000-cccccccccc', toSha: 'c'.repeat(40), cameBackVersion: null,
    });

    await fx.service({ releaseRoot: FROM, version: '1.0.0' }).announce();

    expect(ws.sent[0]!.text).toMatch(/^The upgrade to ccccccc was rolled back \(restart_failed\)\. Running 1\.0\.0, back up at \d\d:\d\d\.$/);
    expect(ws.woken[0]!.payload).toMatchObject({
      outcome: 'rolled_back',
      running: { path: FROM, version: '1.0.0' },
      failure: { reason: 'restart_failed', message: 'no healthy daemon on /rel/20260303-120000-cccccccccc' },
    });
    expect(ws.woken[0]!.payload.to.version).toBeNull();
  });

  it('reports a build failure without waiting for a restart', async () => {
    const ws = fx.addWorkspace('ws1');
    const svc = fx.service({ build: () => { throw new Error('pnpm build exited 1'); } });
    svc.request({ requestedBy: 'op1' });
    await svc.settled();

    expect(fx.db.get<Upgrade>('SELECT * FROM upgrades')!.state).toBe('failed');
    // [0] is the "upgrading" notice posted as soon as dispatch was held (VS-115); [1] is the failure.
    expect(ws.sent).toHaveLength(2);
    expect(ws.sent[0]!.text).toMatch(/^Upgrading to /);
    expect(ws.sent[1]!.text).toMatch(/^The daemon upgrade failed \(build_failed\)\. Running 1\.1\.0, back up at \d\d:\d\d\.$/);
    expect(ws.woken[0]!.payload).toMatchObject({ outcome: 'failed', failure: { reason: 'build_failed' } });
  });
});

// ---------- the once-only marker ----------

describe('the announcement marker', () => {
  it('says nothing on a plain restart', async () => {
    const ws = fx.addWorkspace('ws1');
    await fx.service().announce();
    expect(ws.sent).toEqual([]);
    expect(ws.woken).toEqual([]);
  });

  it('says nothing about an upgrade that was cancelled before it built', async () => {
    const ws = fx.addWorkspace('ws1');
    fx.seed({ state: 'cancelled', toRelease: null, toSha: null, cameBackVersion: null });
    await fx.service().announce();
    expect(ws.sent).toEqual([]);
  });

  it('announces the same upgrade once across two boots', async () => {
    const ws = fx.addWorkspace('ws1');
    const upgrade = fx.seed();

    await fx.service().announce();
    await fx.service().announce();

    expect(ws.sent).toHaveLength(1);
    expect(ws.woken).toHaveLength(1);
    expect(fx.db.get<Upgrade>('SELECT * FROM upgrades WHERE id = ?', [upgrade.id])!.announcedAt).not.toBeNull();
  });
});

// ---------- the human is told an upgrade has started (VS-115) ----------

describe('the starting notice', () => {
  it('tells the chat the upgrade is starting, before the wait for idle resolves', async () => {
    const ws = fx.addWorkspace('ws1');
    let running = 1;
    (ws.runtime.services as unknown as { dispatcher: { running: () => number } }).dispatcher.running = () => running;
    const svc = fx.service();
    svc.request({ requestedBy: 'op1' });
    await new Promise((r) => setTimeout(r, 30));

    expect(ws.sent).toHaveLength(1);
    expect(ws.sent[0]!.text).toBe("Upgrading to main — I'll be back to answer once it's serving again.");

    running = 0;
    await svc.settled();
  });

  it('names the target commit when one was resolved', async () => {
    const ws = fx.addWorkspace('ws1');
    const svc = fx.service({ updates: { running: () => ({ version: '1.1.0', path: TO, sha: 'b'.repeat(40) }), check: () => ({ configured: true, running: { version: '1.1.0', path: TO, sha: 'b'.repeat(40) }, source: '/src', ref: 'main', targetSha: 'c'.repeat(40), updateAvailable: true, checkedAt: nowIso(), error: null }) } });
    svc.request({ requestedBy: 'op1' });
    await svc.settled();

    expect(ws.sent[0]!.text).toBe("Upgrading to main (ccccccc) — I'll be back to answer once it's serving again.");
  });

  it('tells every loaded workspace, and one that cannot be reached does not stop the others', async () => {
    const a = fx.addWorkspace('ws1');
    const b = fx.addWorkspace('ws2');
    a.runtime.services.threads.notifyHuman = async () => { throw new Error('unreachable'); };
    const svc = fx.service();
    svc.request({ requestedBy: 'op1' });
    await svc.settled();

    expect(b.sent).toHaveLength(1);
  });
});

// ---------- what the pipeline records for it ----------

describe('the drained count', () => {
  it('records what was executing when the upgrade started holding dispatch', async () => {
    const ws = fx.addWorkspace('ws1');
    let running = 3;
    (ws.runtime.services as unknown as { dispatcher: { running: () => number } }).dispatcher.running = () => running;
    const svc = fx.service();
    svc.request({ requestedBy: 'op1' });
    await new Promise((r) => setTimeout(r, 30));
    running = 0;
    await svc.settled();

    expect(fx.db.get<Upgrade>('SELECT * FROM upgrades')!.drainedRuns).toBe(3);
  });
});

// ---------- the run counts, from the records (VS-339) ----------

describe('the interrupted and resumed counts', () => {
  it('does not count a turn that finished before the upgrade began', async () => {
    const ws = fx.addWorkspace('ws1');
    ws.interruptRun(afterBuild(TO, -0.6));
    fx.seed();

    await fx.service().announce();

    expect(ws.woken[0]!.payload.runs).toMatchObject({ interrupted: 0, resumed: 0 });
  });

  it('counts only the interrupted turns whose own wakes are queued', async () => {
    const ws = fx.addWorkspace('ws1');
    ws.interruptRun(afterBuild(TO, 0.05));
    ws.interruptRun(afterBuild(TO, 0.06), { resume: false });
    ws.queueWake();
    fx.seed();

    await fx.service().announce();

    expect(ws.woken[0]!.payload.runs).toMatchObject({ interrupted: 2, resumed: 1 });
  });
});

// ---------- the text, on its own ----------

describe('the announcement line', () => {
  const base: UpgradeAnnouncement = {
    kind: 'daemon.upgraded', upgradeId: 'up_1', outcome: 'completed',
    from: { path: FROM, sha: 'a'.repeat(40), version: null },
    to: { path: TO, sha: 'b'.repeat(40), version: '1.1.0' },
    running: { path: TO, sha: 'b'.repeat(40), version: '1.1.0' },
    startedAt: null, finishedAt: null, backUpAt: '2026-02-02T10:30:00.000Z',
    runs: { drained: 0, interrupted: 0, resumed: 0 }, tickets: [], ticketsOmitted: 0, undelivered: { count: 0, identifiers: [] }, migrations: [],
    migrationOutcome: null,
    health: { ok: true, checks: [] }, failure: null,
  };

  it('names a release with no version by its commit', () => {
    const text = announcementText({ ...base, to: { path: TO, sha: 'b'.repeat(40), version: null } });
    expect(text).toMatch(/^Upgraded to bbbbbbb, back up at /);
  });

  it('names a git-sha version without a v prefix', () => {
    const text = announcementText({ ...base, to: { path: TO, sha: 'b'.repeat(40), version: 'bbbbbbbbbb' } });
    expect(text).toMatch(/^Upgraded to bbbbbbbbbb, back up at /);
    expect(text).not.toMatch(/v0\.1\.0/);
    expect(text).not.toMatch(/vbbbbbbbbbb/);
  });

  it('never claims a system is back up when a check failed', () => {
    const text = announcementText({
      ...base,
      health: { ok: false, checks: [{ name: 'database', ok: false, detail: 'disk I/O error' }] },
    });
    expect(text).not.toMatch(/back up at/);
    expect(text).toMatch(/not fully back up: database \(disk I\/O error\) failed\./);
  });

  it('reads exactly as it does today when nothing is undelivered', () => {
    const text = announcementText(base);
    expect(text).toMatch(/^Upgraded to 1\.1\.0, back up at \d\d:\d\d\.$/);
  });

  it('names a single undelivered change', () => {
    const text = announcementText({ ...base, undelivered: { count: 1, identifiers: ['TST-227'] } });
    expect(text).toMatch(/^Upgraded to 1\.1\.0, back up at \d\d:\d\d\. 1 change is in the release without a delivery record \(TST-227\)\.$/);
  });

  it('pluralises and lists more than one undelivered change', () => {
    const text = announcementText({ ...base, undelivered: { count: 2, identifiers: ['TST-227', 'TST-228'] } });
    expect(text).toMatch(/2 changes are in the release without a delivery record \(TST-227, TST-228\)\.$/);
  });

  it('still names the count when the identifiers could not be read', () => {
    const text = announcementText({ ...base, undelivered: { count: 3, identifiers: [] } });
    expect(text).toMatch(/3 changes are in the release without a delivery record\.$/);
  });

  it('states how many landed tickets the cap left out, and nothing when it hid none', () => {
    expect(announcementText({ ...base, ticketsOmitted: 3 }))
      .toMatch(/^Upgraded to 1\.1\.0, back up at \d\d:\d\d\. 3 more landed tickets not listed\.$/);
    expect(announcementText({ ...base, ticketsOmitted: 1 }))
      .toMatch(/ 1 more landed ticket not listed\.$/);
    expect(announcementText(base)).not.toMatch(/not listed/);
  });

  it('names a service-unit rename that fell back or never prepared, and says nothing when it migrated or was not applicable (VS-316)', () => {
    expect(announcementText({ ...base, migrationOutcome: 'fallback' }))
      .toMatch(/rename to the current name did not take; still running under the old one\.$/);
    expect(announcementText({ ...base, migrationOutcome: 'prepare_failed' }))
      .toMatch(/Could not even prepare the service-unit rename this time; still running under the old name\.$/);
    expect(announcementText({ ...base, migrationOutcome: 'migrated' })).not.toMatch(/rename/);
    expect(announcementText({ ...base, migrationOutcome: null })).not.toMatch(/rename/);
  });

  it('never reads a completed record as a successful upgrade when another release is serving', () => {
    const recorded = {
      ...base,
      outcome: 'recorded_completed' as const,
      to: { path: TO, sha: 'b'.repeat(40), version: null },
      running: { path: FROM, sha: 'a'.repeat(40), version: '1.0.0' },
    };
    const text = announcementText(recorded);
    expect(text).toMatch(/^The upgrade to bbbbbbb is recorded completed, but this daemon is running 1\.0\.0, back up at \d\d:\d\d\.$/);
    expect(text).not.toMatch(/^Upgraded/);
    expect(announcementReason(recorded)).toBe('The upgrade to bbbbbbb is recorded completed, but the daemon is running 1.0.0');
  });

  it('names a failing check instead of claiming a recorded_completed daemon is back up', () => {
    const text = announcementText({
      ...base,
      outcome: 'recorded_completed',
      running: { path: FROM, sha: 'a'.repeat(40), version: '1.0.0' },
      health: { ok: false, checks: [{ name: 'supervisor', ok: false, detail: 'not ticking' }] },
    });
    expect(text).not.toMatch(/back up at/);
    expect(text).toMatch(/and not fully back up: supervisor \(not ticking\) failed\./);
  });
});

// ---------- reporting undelivered commits (VS-239) ----------

describe('reporting a release with undelivered ticket-referencing commits', () => {
  const tmps: string[] = [];
  afterEach(() => { while (tmps.length) rmSync(tmps.pop()!, { recursive: true, force: true }); });

  /**
   * A real throwaway git repo, standing in for a release directory: one commit per subject, renamed
   * to `<stamp>-<sha>` at HEAD so `releaseBuiltAt`/`releaseSha` read it exactly like a real one. Only
   * `commitSubjectsInRange` (via `git -C <dir> log`) needs this to be real, not a mock — the whole
   * point of the check is that it trusts nothing about the shape of a commit message it wrote itself.
   */
  function releaseRepo(stamp: string, subjects: string[]): { path: string; shaOf: (subject: string) => string } {
    const scratch = mkdtempSync(join(tmpdir(), 'ac-relannounce-'));
    const git = (...args: string[]): string => execFileSync('git', args, { cwd: scratch, encoding: 'utf8' }).trim();
    git('init', '-q');
    git('config', 'user.email', 'test@example.com');
    git('config', 'user.name', 'Test');
    const shaOf = new Map<string, string>();
    for (const subject of subjects) {
      git('commit', '--allow-empty', '-q', '-m', subject);
      shaOf.set(subject, git('rev-parse', 'HEAD'));
    }
    const path = join(tmpdir(), `${stamp}-${shaOf.get(subjects[subjects.length - 1]!)}`);
    renameSync(scratch, path);
    tmps.push(path);
    return { path, shaOf: (subject) => shaOf.get(subject)! };
  }

  it('reproduces the VS-227 shape: a done ticket whose delivery has no mergeCommit still shows up as undelivered', async () => {
    const ws = fx.addWorkspace('ws1');
    // Two tickets' work landed in the release's commit history; only one left a delivery record —
    // the other is VS-227's shape: it shipped (its commit is right there) but `mergeDone` never ran.
    const repo = releaseRepo('20260202-120000', [
      'chore: baseline',
      'TST-1: a ticket whose merge went through mergeDone as usual',
      'chore(openspec): archive tst-1-a-ticket',
      'TST-227: pause hidden SSE and bound chat fetches so panes populate',
      'chore(openspec): archive tst-227-pause-hidden-sse',
    ]);
    const fromSha = repo.shaOf('chore: baseline');
    const from = `/rel/20260101-120000-${fromSha}`; // never has to exist: releaseSha falls back to the name
    ws.land('TST-1', 'a ticket whose merge went through mergeDone as usual', afterBuild(from, 3));
    fx.seed({ fromRelease: from, toRelease: repo.path, toSha: null });

    // The daemon is running the release it announced, so the outcome is completed (VS-315).
    await fx.service({ releaseRoot: repo.path }).announce();

    expect(ws.sent[0]!.text).toMatch(/^Upgraded to 1\.1\.0, back up at \d\d:\d\d\. 1 change is in the release without a delivery record \(TST-227\)\.$/);
    expect(ws.woken[0]!.payload.tickets.map((t) => t.identifier)).toEqual(['TST-1']);
    expect(ws.woken[0]!.payload.undelivered).toEqual({ count: 1, identifiers: ['TST-227'] });
  });

  it('reads exactly as it does today when every ticket-referencing commit has a delivery record', async () => {
    const ws = fx.addWorkspace('ws1');
    const repo = releaseRepo('20260202-120000', [
      'chore: baseline',
      'TST-1: fully delivered',
      'chore(openspec): archive tst-1-fully-delivered',
    ]);
    const fromSha = repo.shaOf('chore: baseline');
    const from = `/rel/20260101-120000-${fromSha}`;
    ws.land('TST-1', 'fully delivered', afterBuild(from, 3));
    fx.seed({ fromRelease: from, toRelease: repo.path, toSha: null });

    await fx.service({ releaseRoot: repo.path }).announce();

    expect(ws.sent[0]!.text).toMatch(/^Upgraded to 1\.1\.0, back up at \d\d:\d\d\.$/);
    expect(ws.woken[0]!.payload.undelivered).toEqual({ count: 0, identifiers: [] });
  });

  it('reports nothing extra when the release directory has no readable git history', async () => {
    const ws = fx.addWorkspace('ws1');
    fx.seed(); // the base fixture's TO is a plain path with no .git at all
    await fx.service().announce();
    expect(ws.woken[0]!.payload.undelivered).toEqual({ count: 0, identifiers: [] });
  });
});
