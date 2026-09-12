/** HTTP scheduled tasks (`/routines`) — session auth, CRUD, pause, usage, fires (VS-220, VS-231). */
import { afterEach, describe, expect, it } from 'vitest';
import type { Routine, RoutineFire, RoutineListItem, RoutineUsage } from '@weave-ai/shared';
import { createApp } from '../src/app.js';
import { runTokenSecret, signRunToken } from '../src/runtoken.js';
import type { RunTokenClaims } from '../src/runtoken.js';
import { authed, makeHarness, type Harness } from './fakes.js';

let harness: Harness | null = null;
afterEach(async () => { await harness?.close(); harness = null; });

const WORKER: RunTokenClaims = {
  workspaceId: 'ws1', runId: 'run_1', agentId: 'ag_1', agentKind: 'worker',
  projectId: 'proj1', ticketId: 'tk_1', roleId: 'role_1',
};

const CREATE = {
  name: 'Morning review',
  trigger: { kind: 'schedule' as const, timezone: 'UTC', daily: { hour: 7, minute: 0 } },
  instruction: 'Look at today\'s incidents',
};

describe('scheduled task HTTP', () => {
  it('lists empty until one exists', async () => {
    harness = makeHarness();
    const app = createApp(harness.deps);
    const empty = await app.fetch(new Request('http://127.0.0.1/api/w/ws1/routines', { headers: authed() }));
    expect(empty.status).toBe(200);
    expect(await empty.json()).toEqual({ items: [] });

    const created = await app.fetch(new Request('http://127.0.0.1/api/w/ws1/routines', {
      method: 'POST', headers: authed({ 'content-type': 'application/json' }), body: JSON.stringify(CREATE),
    }));
    expect(created.status).toBe(201);
    const row = await created.json() as Routine;
    expect(row).toMatchObject({ name: 'Morning review', status: 'active', template: expect.objectContaining({ action: 'report', instruction: CREATE.instruction }) });

    const listed = await app.fetch(new Request('http://127.0.0.1/api/w/ws1/routines', { headers: authed() }));
    const body = await listed.json() as { items: RoutineListItem[] };
    expect(body.items).toHaveLength(1);
    expect(body.items[0]!.id).toBe(row.id);
    expect(body.items[0]!.fireCount).toBe(0);
  });

  it('pauses via PATCH', async () => {
    harness = makeHarness();
    const app = createApp(harness.deps);
    const created = await app.fetch(new Request('http://127.0.0.1/api/w/ws1/routines', {
      method: 'POST', headers: authed({ 'content-type': 'application/json' }), body: JSON.stringify(CREATE),
    }));
    const row = await created.json() as Routine;

    const paused = await app.fetch(new Request(`http://127.0.0.1/api/w/ws1/routines/${row.id}`, {
      method: 'PATCH', headers: authed({ 'content-type': 'application/json' }), body: JSON.stringify({ status: 'paused' }),
    }));
    expect(paused.status).toBe(200);
    expect((await paused.json() as Routine).status).toBe('paused');
  });

  it('rejects a worker run token', async () => {
    harness = makeHarness({ listener: 'loopback' });
    const app = createApp(harness.deps);
    const token = await signRunToken(runTokenSecret(harness.runtime.ctx.db), WORKER);
    const res = await app.fetch(new Request('http://127.0.0.1/api/w/ws1/routines', {
      headers: { authorization: `Bearer ${token}` },
    }));
    expect(res.status).toBe(403);
  });

  it('answers usage for a window, including zeros', async () => {
    harness = makeHarness();
    const app = createApp(harness.deps);
    const created = await app.fetch(new Request('http://127.0.0.1/api/w/ws1/routines', {
      method: 'POST', headers: authed({ 'content-type': 'application/json' }), body: JSON.stringify(CREATE),
    }));
    const row = await created.json() as Routine;
    const res = await app.fetch(new Request(`http://127.0.0.1/api/w/ws1/routines/${row.id}/usage?window=24h`, { headers: authed() }));
    expect(res.status).toBe(200);
    const usage = await res.json() as RoutineUsage;
    expect(usage).toMatchObject({ window: '24h', tokensIn: 0, tokensOut: 0, runs: 0, costCents: 0 });
  });

  it('lists fires newest first and counts them on the list item (VS-231)', async () => {
    harness = makeHarness();
    const app = createApp(harness.deps);
    const created = await app.fetch(new Request('http://127.0.0.1/api/w/ws1/routines', {
      method: 'POST', headers: authed({ 'content-type': 'application/json' }), body: JSON.stringify(CREATE),
    }));
    const row = await created.json() as Routine;
    const empty = await app.fetch(new Request(`http://127.0.0.1/api/w/ws1/routines/${row.id}/fires`, { headers: authed() }));
    expect(empty.status).toBe(200);
    expect(await empty.json()).toEqual({ items: [] });

    harness.runtime.ctx.db.insert('wakeups', {
      id: 'w-old', workspaceId: 'ws1', agentId: 'ag_conductor', source: 'routine', reason: 'fire',
      payloadJson: { routineId: row.id }, status: 'queued', createdAt: '2026-09-11T07:00:00.000Z',
    });
    harness.runtime.ctx.db.insert('wakeups', {
      id: 'w-new', workspaceId: 'ws1', agentId: 'ag_conductor', source: 'routine', reason: 'fire',
      payloadJson: { routineId: row.id }, status: 'queued', createdAt: '2026-09-11T08:00:00.000Z',
    });
    harness.runtime.ctx.db.insert('wakeups', {
      id: 'w-skip', workspaceId: 'ws1', agentId: 'ag_conductor', source: 'routine', reason: 'fire',
      payloadJson: { routineId: row.id }, status: 'skipped', createdAt: '2026-09-11T06:00:00.000Z',
    });

    const fires = await app.fetch(new Request(`http://127.0.0.1/api/w/ws1/routines/${row.id}/fires`, { headers: authed() }));
    expect(fires.status).toBe(200);
    const body = await fires.json() as { items: RoutineFire[] };
    expect(body.items.map((f) => f.wakeId)).toEqual(['w-new', 'w-old']);
    expect(body.items[0]).toMatchObject({ runId: null, summary: null, sharedTurn: false, status: 'queued' });

    const listed = await app.fetch(new Request('http://127.0.0.1/api/w/ws1/routines', { headers: authed() }));
    const list = await listed.json() as { items: RoutineListItem[] };
    expect(list.items[0]!.fireCount).toBe(2);

    const missing = await app.fetch(new Request('http://127.0.0.1/api/w/ws1/routines/nope/fires', { headers: authed() }));
    expect(missing.status).toBe(404);
  });
});
