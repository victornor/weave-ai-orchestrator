/**
 * The restart notice (VS-339, `daemon-restart/restart-announcement`). No daemon and no listener: the
 * daemon database and each workspace database are real, and the two things the notice reaches — the
 * primary chat thread and the weaver's wake queue — are recorded by fakes.
 */
import { describe, expect, it } from 'vitest';
import { Db, newId, nowIso } from '@weave-ai/db';
import type { RestartNotice } from '@weave-ai/shared';
import {
  announceRestart, interruptedTurns, markBooted, observeBoot, queuedForCapacity, recordShutdown, recordStartFailure,
  restartNoticeReason, restartNoticeText, type BootObservation, type InterruptedTurn,
} from '../src/restart-notice.js';
import type { WorkspaceRuntime } from '../src/types.js';

interface Workspace {
  id: string;
  db: Db;
  runtime: WorkspaceRuntime;
  sent: Array<{ text: string }>;
  woken: Array<{ agentId: string; source: string; reason: string; payload: RestartNotice; idempotencyKey?: string }>;
}

function workspace(id: string): Workspace {
  const db = new Db(':memory:');
  db.migrate();
  db.run('INSERT INTO workspaces (id, slug, name, ticket_prefix, status, root_path, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)',
    [id, id, id, 'TST', 'active', '/tmp/ws', nowIso(), nowIso()]);
  db.run('INSERT INTO agents (id, workspace_id, kind, name, runtime_id, status, home_path, turn_epoch, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
    [`${id}-weaver`, id, 'weaver', 'Weaver', 'claude', 'active', '/tmp/home', 0, nowIso(), nowIso()]);

  const ws: Workspace = { id, db, sent: [], woken: [], runtime: null as unknown as WorkspaceRuntime };
  const ticketId = newId();
  db.run(`INSERT INTO tickets (id, workspace_id, number, identifier, kind, title, status, created_by_kind, created_at, updated_at)
          VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [ticketId, id, 1, 'TST-1', 'task', 'Fix it', 'todo', 'human', nowIso(), nowIso()]);
  db.run('INSERT INTO agents (id, workspace_id, kind, name, runtime_id, status, home_path, turn_epoch, ticket_id, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
    [`${id}-worker`, id, 'worker', 'Engineer', 'claude', 'active', '/tmp/worker', 0, ticketId, nowIso(), nowIso()]);

  ws.runtime = {
    id,
    ctx: { workspaceId: id, db, config: { defaults: { maxConcurrentRuns: 6 } } },
    services: {
      threads: { notifyHuman: async (_a: unknown, m: { text: string }) => { ws.sent.push({ text: m.text }); } },
      workers: { ensureConductor: async () => ({ id: `${id}-weaver` }) },
      wake: {
        enqueue: (agentId: string, input: { source: string; reason: string; payload: RestartNotice; idempotencyKey?: string }) => {
          ws.woken.push({ agentId, source: input.source, reason: input.reason, payload: input.payload, idempotencyKey: input.idempotencyKey });
          return { id: newId() };
        },
      },
    },
  } as unknown as WorkspaceRuntime;
  return ws;
}

/** A migrated daemon database — `announceRestart` writes its once-per-boot claim into `meta`. */
function daemonDb(): Db {
  const db = new Db(':memory:');
  db.migrate();
  return db;
}

const observation = (over: Partial<BootObservation> = {}): BootObservation => ({
  bootAt: '2026-09-13T19:17:30.000Z',
  previousBootAt: '2026-09-13T19:10:00.000Z',
  previousBootRelease: '/rel/20260913-190000-abc1234',
  downAt: '2026-09-13T19:16:31.000Z',
  shutdownReason: 'SIGTERM',
  clean: true,
  failedStarts: { count: 0, lastAt: null, lastReason: null },
  ...over,
});

describe('the durable lifecycle (VS-339)', () => {
  it('a boot followed by a shutdown is clean; a boot with no shutdown after it is a crash', () => {
    const db = new Db(':memory:');
    db.migrate();
    const first = observeBoot(db, { now: '2026-09-13T19:00:00.000Z', release: '/rel/a', pid: 1 });
    expect(first.previousBootAt).toBeNull();
    expect(first.clean).toBe(false); // nothing announces the first boot; the flag is simply not clean
    markBooted(db, { now: '2026-09-13T19:00:00.000Z', release: '/rel/a', pid: 1 });

    // No shutdown recorded: the next boot is a crash.
    const crashed = observeBoot(db, { now: '2026-09-13T19:10:00.000Z', release: '/rel/a', pid: 2 });
    expect(crashed.previousBootAt).toBe('2026-09-13T19:00:00.000Z');
    expect(crashed.clean).toBe(false);
    markBooted(db, { now: '2026-09-13T19:10:00.000Z', release: '/rel/a', pid: 2 });

    // A recorded shutdown after that boot makes the next one clean.
    recordShutdown(db, 'SIGTERM', '2026-09-13T19:15:00.000Z');
    const clean = observeBoot(db, { now: '2026-09-13T19:16:00.000Z', release: '/rel/a', pid: 3 });
    expect(clean.clean).toBe(true);
    expect(clean.downAt).toBe('2026-09-13T19:15:00.000Z');
    expect(clean.shutdownReason).toBe('SIGTERM');
    db.close();
  });

  it('counts failed start attempts and resets the count on a successful boot', () => {
    const db = new Db(':memory:');
    db.migrate();
    markBooted(db, { now: '2026-09-13T19:00:00.000Z', release: '/rel/a', pid: 1 });
    recordStartFailure(db, 'listen EADDRNOTAVAIL 100.64.0.10:7433', '2026-09-13T19:16:40.000Z');

    const reported = observeBoot(db, { now: '2026-09-13T19:17:30.000Z', release: '/rel/a', pid: 2 });
    expect(reported.failedStarts).toEqual({
      count: 1,
      lastAt: '2026-09-13T19:16:40.000Z',
      lastReason: 'listen EADDRNOTAVAIL 100.64.0.10:7433',
    });

    markBooted(db, { now: '2026-09-13T19:17:30.000Z', release: '/rel/a', pid: 2 });
    const after = observeBoot(db, { now: '2026-09-13T19:20:00.000Z', release: '/rel/a', pid: 3 });
    expect(after.failedStarts.count).toBe(0);
    db.close();
  });
});

describe('the interrupted turns (VS-339)', () => {
  function beginUpgradeShutdown(ws: Workspace, at: string): void {
    const ticketId = ws.db.get<{ id: string }>('SELECT id FROM tickets LIMIT 1')!.id;
    ws.db.run('INSERT INTO wakeups (id, workspace_id, agent_id, source, reason, status, created_at) VALUES (?,?,?,?,?,?,?)',
      ['w-1', ws.id, `${ws.id}-worker`, 'retry', 'previous turn was interrupted', 'queued', at]);
    ws.db.run(
      `INSERT INTO runs (id, workspace_id, agent_id, ticket_id, wakeup_ids_json, runtime_id, status, turn_epoch, cwd, error_code, error_family, finished_at, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      ['r-1', ws.id, `${ws.id}-worker`, ticketId, JSON.stringify(['w-1']), 'claude', 'interrupted', 1, '/tmp/worker', 'interrupted_by_shutdown', 'tooling', at, at]);
  }

  it('names the shutdown-interrupted runs and still-running orphans, and nothing else', () => {
    const ws = workspace('ws1');
    beginUpgradeShutdown(ws, '2026-09-13T19:16:00.000Z');
    // An orphan from a crash (still running), which boot recovery will re-queue.
    ws.db.run(
      `INSERT INTO runs (id, workspace_id, agent_id, wakeup_ids_json, runtime_id, status, turn_epoch, cwd, created_at)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      ['r-2', ws.id, `${ws.id}-worker`, '[]', 'opencode', 'running', 1, '/tmp/worker', '2026-09-13T19:16:10.000Z']);
    // A human interruption and a run outside the window are both excluded.
    ws.db.run(
      `INSERT INTO runs (id, workspace_id, agent_id, wakeup_ids_json, runtime_id, status, turn_epoch, cwd, error_code, error_family, finished_at, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      ['r-3', ws.id, `${ws.id}-worker`, '[]', 'claude', 'interrupted', 1, '/tmp/worker', 'interrupted', 'tooling', '2026-09-13T19:16:05.000Z', '2026-09-13T19:16:05.000Z']);
    ws.db.run(
      `INSERT INTO runs (id, workspace_id, agent_id, wakeup_ids_json, runtime_id, status, turn_epoch, cwd, error_code, error_family, finished_at, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      ['r-4', ws.id, `${ws.id}-worker`, '[]', 'claude', 'interrupted', 1, '/tmp/worker', 'interrupted_by_shutdown', 'tooling', '2026-09-13T09:00:00.000Z', '2026-09-13T09:00:00.000Z']);

    const turns = interruptedTurns(ws.db, observation());
    expect(turns.map((t) => t.runId).sort()).toEqual(['r-1', 'r-2']);
    expect(turns.find((t) => t.runId === 'r-1')).toMatchObject({ agentName: 'Engineer', ticketIdentifier: 'TST-1' });
    ws.db.close();
  });
});

describe('the chat line and the wake (VS-339)', () => {
  it('a clean restart posts one line and one wake per workspace, naming the turns resuming', async () => {
    const a = workspace('ws1');
    const b = workspace('ws2');
    a.db.run('INSERT INTO runs (id, workspace_id, agent_id, wakeup_ids_json, runtime_id, status, turn_epoch, cwd, error_code, error_family, finished_at, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
      ['r-1', a.id, `${a.id}-worker`, '[]', 'claude', 'interrupted', 1, '/tmp/worker', 'interrupted_by_shutdown', 'tooling', '2026-09-13T19:16:00.000Z', '2026-09-13T19:16:00.000Z']);
    const workspaces = new Map<string, WorkspaceRuntime>([[a.id, a.runtime], [b.id, b.runtime]]);

    await announceRestart({ db: daemonDb(), workspaces, observation: observation() });

    for (const ws of [a, b]) {
      expect(ws.sent).toHaveLength(1);
      expect(ws.woken).toHaveLength(1);
      expect(ws.woken[0]!.source).toBe('system');
      expect(ws.woken[0]!.reason).toMatch(/^The daemon restarted and is back up at /);
    }
    expect(a.sent[0]!.text).toMatch(/^Back up at \d\d:\d\d after a restart\. 1 turn is resuming\.$/);
    expect(a.woken[0]!.payload).toMatchObject({ kind: 'daemon.restarted', clean: true });
    expect(a.woken[0]!.payload.interrupted.map((t) => t.runId)).toEqual(['r-1']);
    a.db.close(); b.db.close();
  });

  it('reports a crash as unclean', async () => {
    const ws = workspace('ws1');
    await announceRestart({
      db: daemonDb(),
      workspaces: new Map([[ws.id, ws.runtime]]),
      observation: observation({ clean: false, downAt: null, shutdownReason: null }),
    });
    expect(ws.sent[0]!.text).toContain('after an unclean shutdown');
    expect(ws.woken[0]!.reason).toContain('unclean shutdown');
    expect(ws.woken[0]!.payload.clean).toBe(false);
    ws.db.close();
  });

  it('reports failed start attempts', async () => {
    const ws = workspace('ws1');
    await announceRestart({
      db: daemonDb(),
      workspaces: new Map([[ws.id, ws.runtime]]),
      observation: observation({ failedStarts: { count: 2, lastAt: '2026-09-13T19:16:40.000Z', lastReason: 'bind failed' } }),
    });
    expect(ws.sent[0]!.text).toContain('2 start attempts failed before this one.');
    ws.db.close();
  });

  it('does nothing on the first boot', async () => {
    const ws = workspace('ws1');
    await announceRestart({
      db: daemonDb(),
      workspaces: new Map([[ws.id, ws.runtime]]),
      observation: observation({ previousBootAt: null, previousBootRelease: null, clean: false, downAt: null }),
    });
    expect(ws.sent).toHaveLength(0);
    expect(ws.woken).toHaveLength(0);
    ws.db.close();
  });

  it('announces one boot once, even if called twice', async () => {
    const ws = workspace('ws1');
    const db = new Db(':memory:');
    db.migrate();
    const workspaces = new Map([[ws.id, ws.runtime]]);
    await announceRestart({ db, workspaces, observation: observation() });
    await announceRestart({ db, workspaces, observation: observation() });
    expect(ws.sent).toHaveLength(1);
    expect(ws.woken).toHaveLength(1);
    db.close(); ws.db.close();
  });
});

describe('the restart lines (VS-339)', () => {
  it('says clean or unclean, and never claims more than the record', () => {
    expect(restartNoticeText({ bootAt: '2026-09-13T19:17:30.000Z', clean: true, failedStarts: { count: 0, lastAt: null, lastReason: null }, interrupted: [], queuedForCapacity: [] }))
      .toMatch(/^Back up at \d\d:\d\d after a restart\.$/);
    expect(restartNoticeReason({ bootAt: '2026-09-13T19:17:30.000Z', clean: false })).toContain('unclean shutdown');
  });
});

describe('turns queued for capacity (VS-375)', () => {
  const turn = (id: string, projectId: string | null = null): InterruptedTurn => ({
    runId: `r-${id}`, agentId: `a-${id}`, agentName: `W${id}`, agentKind: 'worker',
    projectId, ticketId: null, ticketIdentifier: null,
  });

  it('holds back only the turns beyond the run limit, once the weaver slot is reserved', () => {
    const turns = [turn('1'), turn('2'), turn('3'), turn('4')];
    const waiting = queuedForCapacity(turns, { runLimit: 3, reserved: 1, projectMaxWorkers: new Map() });
    expect(waiting.map((t) => t.runId)).toEqual(['r-3', 'r-4']);
  });

  it('holds back a turn beyond its own project maxWorkers even when the workspace has room', () => {
    const turns = [turn('1', 'p1'), turn('2', 'p1'), turn('3', 'p2')];
    const waiting = queuedForCapacity(turns, { runLimit: 6, reserved: 1, projectMaxWorkers: new Map([['p1', 1]]) });
    expect(waiting.map((t) => t.runId)).toEqual(['r-2']);
  });

  it('names the waiting turns in the restart payload and the chat line', async () => {
    const ws = workspace('ws1');
    ws.runtime.ctx.config.defaults.maxConcurrentRuns = 3;
    // Four shutdown-cut turns across four agents, but only two run slots after the weaver's.
    for (let i = 0; i < 4; i += 1) {
      const agentId = `${ws.id}-worker-${i}`;
      ws.db.run('INSERT INTO agents (id, workspace_id, kind, name, runtime_id, status, home_path, turn_epoch, ticket_id, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
        [agentId, ws.id, 'worker', `Engineer ${i}`, 'claude', 'active', '/tmp/w', 0, null, nowIso(), nowIso()]);
      ws.db.run('INSERT INTO runs (id, workspace_id, agent_id, wakeup_ids_json, runtime_id, status, turn_epoch, cwd, error_code, error_family, finished_at, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
        [`r-${i}`, ws.id, agentId, '[]', 'claude', 'interrupted', 1, '/tmp/w', 'interrupted_by_shutdown', 'tooling', '2026-09-13T19:16:00.000Z', `2026-09-13T19:16:0${i}.000Z`]);
    }

    await announceRestart({ db: daemonDb(), workspaces: new Map([[ws.id, ws.runtime]]), observation: observation() });

    const notice = ws.woken[0]!.payload;
    expect(notice.interrupted).toHaveLength(4);
    expect(notice.queuedForCapacity.map((t) => t.runId)).toEqual(['r-2', 'r-3']);
    expect(ws.sent[0]!.text).toMatch(/^Back up at \d\d:\d\d after a restart\. 4 turns are resuming; 2 are waiting for a run slot\.$/);
    ws.db.close();
  });
});
