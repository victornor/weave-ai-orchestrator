import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { newId, nowIso } from '@agent-conductor/db';
import type { Run, Ticket } from '@agent-conductor/shared';
import { makeHarness, fakeWake, type TestHarness } from '../testing/context.js';
import { createSupervisor } from './index.js';
import type { Supervisor } from '../api.js';

function seedTicket(h: TestHarness, over: Record<string, unknown> = {}): string {
  const id = newId();
  const now = nowIso();
  h.db.insert('tickets', {
    id, workspaceId: h.workspaceId, projectId: h.projectId, number: 1, identifier: 'TST-1', kind: 'task',
    title: 'Do the thing', description: '', status: 'todo', priority: 'medium', assigneeRoleId: h.roleId,
    createdByKind: 'human', createdAt: now, updatedAt: now, ...over,
  });
  return id;
}

describe('supervisor', () => {
  let h: TestHarness;
  let supervisor: Supervisor;
  let wake: ReturnType<typeof fakeWake>;
  let spawnForTicket: ReturnType<typeof vi.fn>;
  let retireIfLanded: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    h = makeHarness();
    wake = fakeWake();
    spawnForTicket = vi.fn(async () => ({ id: 'w1' }));
    retireIfLanded = vi.fn(async () => ({ retired: true }));
    h.services.wake = wake as never;
    h.services.workers = { spawnForTicket, retireIfLanded, conductor: () => ({ id: h.conductorId }) } as never;
    h.services.tickets = { livenessViolations: () => [] } as never;
    h.services.decisions = { expireDue: vi.fn(async () => []) } as never;
    h.services.projects = { fetch: vi.fn(async () => ({ head: 'abc', fastForwarded: false })) } as never;
    supervisor = createSupervisor(h.ctx, h.deps);
  });
  afterEach(() => { supervisor.stop(); h.cleanup(); });

  it('marks runs from a dead process as interrupted and re-queues them once', async () => {
    const runId = newId();
    h.db.insert('runs', {
      id: runId, workspaceId: h.workspaceId, agentId: h.conductorId, wakeupIdsJson: [], runtimeId: 'claude',
      status: 'running', turnEpoch: 1, cwd: h.ctx.paths.conductor, pid: 999_999, startedAt: nowIso(), createdAt: nowIso(),
    });
    await supervisor.tick();
    const run = h.db.get<Run>('SELECT * FROM runs WHERE id = ?', [runId])!;
    expect(run.status).toBe('interrupted');
    expect(wake.calls.some((c) => (c.input as { source: string }).source === 'retry')).toBe(true);
    const events = h.db.all<{ type: string; payload: { action: string } }>('SELECT type, payload_json FROM run_events WHERE run_id = ?', [runId]);
    expect(events[0]!.payload.action).toBe('boot_recovery');
  });

  it('spawns a worker for a ticket that needs one', async () => {
    const ticketId = seedTicket(h);
    await supervisor.tick();
    expect(spawnForTicket).toHaveBeenCalledWith({ kind: 'system', id: null }, ticketId);
  });

  it('does not spawn when the role is not active or a worker already exists', async () => {
    seedTicket(h);
    h.db.update('roles', h.roleId, { status: 'paused' });
    await supervisor.tick();
    expect(spawnForTicket).not.toHaveBeenCalled();

    h.db.update('roles', h.roleId, { status: 'active' });
    const t2 = seedTicket(h, { number: 2, identifier: 'TST-2' });
    h.addWorker(t2);
    await supervisor.tick();
    expect(spawnForTicket).toHaveBeenCalledTimes(1);   // only the first ticket, which has no worker
  });

  it('spawns waiting tickets by priority, with creation time breaking ties', async () => {
    const at = (min: number) => new Date(Date.UTC(2026, 8, 5, 8, min)).toISOString();
    const seeded: Record<string, string> = {};
    // Seeded in creation order, so a naive `ORDER BY created_at` would spawn them exactly as listed.
    for (const [n, priority, min] of [[1, 'medium', 0], [2, 'low', 1], [3, 'critical', 2], [4, 'high', 3], [5, 'medium', 4]] as const) {
      seeded[`TST-${n}`] = seedTicket(h, { number: n, identifier: `TST-${n}`, priority, createdAt: at(min), updatedAt: at(min) });
    }

    await supervisor.tick();

    const order = spawnForTicket.mock.calls.map(([, ticketId]) => Object.keys(seeded).find((k) => seeded[k] === ticketId));
    expect(order).toEqual(['TST-3', 'TST-4', 'TST-1', 'TST-5', 'TST-2']);
  });

  it('warns the conductor when a ticket has waited too long for a slot', async () => {
    h.ctx.config.defaults.spawnWaitWarnSec = 0;
    spawnForTicket.mockRejectedValue(Object.assign(new Error('full'), { code: 'role_full' }));
    seedTicket(h);
    await supervisor.tick();
    await new Promise((r) => setTimeout(r, 15));   // the wait is measured in wall-clock seconds
    await supervisor.tick();
    expect(wake.calls.some((c) => c.agentId === h.conductorId && String((c.input as { reason: string }).reason).includes('waiting'))).toBe(true);
  });

  it('retires workers whose ticket is terminal', async () => {
    const ticketId = seedTicket(h, { status: 'done' });
    const workerId = h.addWorker(ticketId);
    await supervisor.tick();
    expect(retireIfLanded).toHaveBeenCalledWith({ kind: 'system', id: null }, workerId);
  });

  it('wakes the workers of tickets that violate the liveness rule', async () => {
    const ticketId = seedTicket(h, { status: 'in_progress' });
    const workerId = h.addWorker(ticketId);
    const ticket = h.db.get<Ticket>('SELECT * FROM tickets WHERE id = ?', [ticketId])!;
    h.services.tickets = { livenessViolations: () => [ticket] } as never;
    await supervisor.tick();
    expect(wake.calls.some((c) => c.agentId === workerId && (c.input as { reason: string }).reason === 'liveness_repair')).toBe(true);
  });

  it('expires due decisions every tick', async () => {
    await supervisor.tick();
    expect(h.services.decisions!.expireDue).toHaveBeenCalled();
  });

  it('sends the conductor a coalesced digest wake when conductor-relevant events happened', async () => {
    h.ctx.events.emit('ticket.status', 'ticket', 't1', { status: 'blocked' });
    h.ctx.events.emit('run.finished', 'run', 'r1', { liveness: 'blocked' });
    await supervisor.tick();
    const digest = wake.calls.find((c) => (c.input as { reason: string }).reason === 'digest');
    expect(digest?.agentId).toBe(h.conductorId);
    expect((digest!.input as { payload: { events: unknown[] } }).payload.events.length).toBeGreaterThan(0);

    // nothing new since: no second digest
    wake.calls.length = 0;
    await supervisor.tick();
    expect(wake.calls.find((c) => (c.input as { reason: string }).reason === 'digest')).toBeUndefined();
  });

  it('ignores events that are not conductor-relevant', async () => {
    h.ctx.events.emit('wake.queued', 'wakeup', 'w1', {});
    h.ctx.events.emit('run.finished', 'run', 'r2', { liveness: 'advanced' });
    await supervisor.tick();
    expect(wake.calls.find((c) => (c.input as { reason: string }).reason === 'digest')).toBeUndefined();
  });
});

describe('supervisor scheduled passes', () => {
  let h: TestHarness;
  let supervisor: Supervisor;
  let wake: ReturnType<typeof fakeWake>;

  beforeEach(() => {
    h = makeHarness();
    wake = fakeWake();
    h.services.wake = wake as never;
    h.services.workers = { spawnForTicket: vi.fn(), retireIfLanded: vi.fn(), conductor: () => ({ id: h.conductorId }) } as never;
    h.services.tickets = { livenessViolations: () => [], autoMergeSweep: async () => 0 } as never;
    h.services.decisions = { expireDue: vi.fn(async () => []) } as never;
    h.services.projects = { fetch: vi.fn(async () => ({ head: 'abc', fastForwarded: false })) } as never;
    supervisor = createSupervisor(h.ctx, h.deps);
  });
  afterEach(() => { supervisor.stop(); h.cleanup(); });

  function seedKnowledgeFile(over: Record<string, unknown> = {}): void {
    h.db.insert('knowledge_files', {
      id: newId(), workspaceId: h.workspaceId, projectId: null, path: 'knowledge/workspace/WORKSPACE.md', scope: 'workspace',
      tokenEstimate: 100, budgetTokens: 3000, lastCuratedAt: null, curationPending: 0, hash: 'x',
      updatedAt: new Date(Date.now() - 30 * 86_400_000).toISOString(), ...over,
    });
  }

  describe('curation', () => {
    it('requests curation for a file whose last curation is older than 14 days', async () => {
      const requestCuration = vi.fn(async () => ({}));
      h.services.knowledge = { requestCuration } as never;
      seedKnowledgeFile({ lastCuratedAt: new Date(Date.now() - 20 * 86_400_000).toISOString() });
      await supervisor.tick();
      expect(requestCuration).toHaveBeenCalledWith({ kind: 'system', id: null }, 'workspace', null);
    });

    it('requests curation for a pending file even when it was curated yesterday', async () => {
      const requestCuration = vi.fn(async () => ({}));
      h.services.knowledge = { requestCuration } as never;
      seedKnowledgeFile({ lastCuratedAt: new Date(Date.now() - 86_400_000).toISOString(), curationPending: 1 });
      await supervisor.tick();
      expect(requestCuration).toHaveBeenCalledTimes(1);
    });

    it('leaves a fresh, unflagged file alone', async () => {
      const requestCuration = vi.fn(async () => ({}));
      h.services.knowledge = { requestCuration } as never;
      seedKnowledgeFile({ lastCuratedAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
      await supervisor.tick();
      expect(requestCuration).not.toHaveBeenCalled();
    });

    it('asks at most once per file per day and persists the request in meta', async () => {
      const requestCuration = vi.fn(async () => ({}));
      h.services.knowledge = { requestCuration } as never;
      seedKnowledgeFile({ curationPending: 1 });
      await supervisor.tick();
      h.db.run("DELETE FROM meta WHERE key = 'supervisor:curation_at'");   // force the 10-minute gate open again
      await supervisor.tick();
      expect(requestCuration).toHaveBeenCalledTimes(1);
      expect(h.db.get<{ value: string }>('SELECT value FROM meta WHERE key = ?', ['supervisor:curation_requested:knowledge/workspace/WORKSPACE.md'])).toBeDefined();
    });

    it('does not run the pass twice inside the 10-minute window', async () => {
      const requestCuration = vi.fn(async () => ({}));
      h.services.knowledge = { requestCuration } as never;
      await supervisor.tick();
      const at = h.db.get<{ value: string }>('SELECT value FROM meta WHERE key = ?', ['supervisor:curation_at'])!.value;
      seedKnowledgeFile({ curationPending: 1 });
      await supervisor.tick();
      expect(requestCuration).not.toHaveBeenCalled();
      expect(h.db.get<{ value: string }>('SELECT value FROM meta WHERE key = ?', ['supervisor:curation_at'])!.value).toBe(at);
    });
  });

  describe('reconciliation', () => {
    function seedPrTicket(over: Record<string, unknown> = {}): string {
      const ticketId = seedTicket(h, { status: 'in_review', kind: 'change', ...over });
      h.db.insert('ticket_work_products', {
        id: newId(), ticketId, type: 'pull_request', provider: 'github', url: 'https://github.com/acme/api/pull/7',
        title: 'PR 7', state: 'open', isPrimary: 1, metadataJson: {}, createdAt: nowIso(), updatedAt: nowIso(),
      });
      mkdirSync(join(h.ctx.paths.projects, h.projectSlug), { recursive: true });
      h.db.update('projects', h.projectId, { status: 'ready' });
      return ticketId;
    }

    it('fetches every ready project', async () => {
      const fetchProject = vi.fn(async () => ({ head: 'abc', fastForwarded: false }));
      h.services.projects = { fetch: fetchProject } as never;
      await supervisor.tick();
      expect(fetchProject).toHaveBeenCalledWith(h.projectId);
    });

    it('records the PR state on the work product and leaves an open PR alone', async () => {
      h.services.projects = { fetch: vi.fn(async () => ({ head: 'a', fastForwarded: false })) } as never;
      const transition = vi.fn(async () => ({}));
      h.services.tickets = { livenessViolations: () => [], autoMergeSweep: async () => 0, transition } as never;
      h.ctx.registries.forges.set('github', { id: 'github', detect: async () => true, prState: async () => ({ state: 'closed' as const }), mergePr: async () => ({}) });
      const ticketId = seedPrTicket();
      await supervisor.tick();
      expect(h.db.get<{ state: string }>('SELECT state FROM ticket_work_products WHERE ticket_id = ?', [ticketId])?.state).toBe('closed');
      expect(h.db.get<{ delivery: { prState: string } }>('SELECT delivery_json FROM tickets WHERE id = ?', [ticketId])?.delivery.prState).toBe('closed');
      expect(transition).not.toHaveBeenCalled();
    });

    it('moves a merged PR to merging and wakes the live worker to report only', async () => {
      h.services.projects = { fetch: vi.fn(async () => ({ head: 'a', fastForwarded: false })) } as never;
      const transition = vi.fn(async () => ({}));
      const mergeDone = vi.fn(async () => ({}));
      h.services.tickets = { livenessViolations: () => [], autoMergeSweep: async () => 0, transition, mergeDone } as never;
      h.ctx.registries.forges.set('github', { id: 'github', detect: async () => true, prState: async () => ({ state: 'merged' as const, mergeCommit: 'deadbeefcafe' }), mergePr: async () => ({}) });
      const ticketId = seedPrTicket();
      const workerId = h.addWorker(ticketId);

      await supervisor.tick();
      expect(transition).toHaveBeenCalledWith({ kind: 'system', id: null }, ticketId, expect.objectContaining({ to: 'merging' }));
      const woken = wake.calls.find((c) => c.agentId === workerId && (c.input as { source: string }).source === 'merge_approved');
      expect(woken).toBeDefined();
      expect((woken!.input as { payload: { mergedOnForge: boolean; mergeCommit: string } }).payload).toMatchObject({ mergedOnForge: true, mergeCommit: 'deadbeefcafe' });
      expect(String((woken!.input as { reason: string }).reason)).toContain('ac_ticket_merge_done');
      expect(mergeDone).not.toHaveBeenCalled();
    });

    it('finishes the merge itself when no worker is alive', async () => {
      h.services.projects = { fetch: vi.fn(async () => ({ head: 'a', fastForwarded: false })) } as never;
      const mergeDone = vi.fn(async () => ({}));
      h.services.tickets = { livenessViolations: () => [], autoMergeSweep: async () => 0, transition: vi.fn(async () => ({})), mergeDone } as never;
      h.ctx.registries.forges.set('github', { id: 'github', detect: async () => true, prState: async () => ({ state: 'merged' as const, mergeCommit: 'cafe1234' }), mergePr: async () => ({}) });
      const ticketId = seedPrTicket();
      await supervisor.tick();
      expect(mergeDone).toHaveBeenCalledWith({ kind: 'system', id: null }, ticketId, { mergeCommit: 'cafe1234', method: 'forge' });
    });

    it('archives an OpenSpec change left un-archived under a done ticket', async () => {
      h.services.projects = { fetch: vi.fn(async () => ({ head: 'a', fastForwarded: false })) } as never;
      const archiveAfterMerge = vi.fn(async () => ({ archivedAs: '2026-09-04-add-dark-mode', skipped: null }));
      h.services.openspec = { archiveAfterMerge } as never;
      const ticketId = seedTicket(h, { status: 'done', kind: 'change', openspecChangeName: 'add-dark-mode' });
      const clone = join(h.ctx.paths.projects, h.projectSlug);
      mkdirSync(join(clone, 'openspec', 'changes', 'add-dark-mode'), { recursive: true });
      await supervisor.tick();
      expect(archiveAfterMerge).toHaveBeenCalledWith(ticketId);
    });

    it('leaves an already-archived change alone', async () => {
      h.services.projects = { fetch: vi.fn(async () => ({ head: 'a', fastForwarded: false })) } as never;
      const archiveAfterMerge = vi.fn(async () => ({ archivedAs: null, skipped: null }));
      h.services.openspec = { archiveAfterMerge } as never;
      seedTicket(h, { status: 'done', kind: 'change', openspecChangeName: 'add-dark-mode' });
      const clone = join(h.ctx.paths.projects, h.projectSlug);
      mkdirSync(join(clone, 'openspec', 'changes', 'add-dark-mode'), { recursive: true });
      mkdirSync(join(clone, 'openspec', 'changes', 'archive', '2026-09-01-add-dark-mode'), { recursive: true });
      await supervisor.tick();
      expect(archiveAfterMerge).not.toHaveBeenCalled();
    });
  });

  describe('retention', () => {
    it('prunes old run directories, clears log_path and keeps the row', async () => {
      const oldRun = newId();
      const freshRun = newId();
      for (const [id, finishedAt] of [[oldRun, new Date(Date.now() - 40 * 86_400_000).toISOString()], [freshRun, nowIso()]] as const) {
        const dir = join(h.ctx.paths.runs, id);
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, 'events.jsonl'), '{}\n');
        h.db.insert('runs', {
          id, workspaceId: h.workspaceId, agentId: h.conductorId, wakeupIdsJson: [], runtimeId: 'claude', status: 'succeeded',
          turnEpoch: 1, cwd: h.ctx.paths.conductor, finishedAt, logPath: join(dir, 'events.jsonl'), createdAt: finishedAt,
        });
      }
      await supervisor.tick();
      expect(existsSync(join(h.ctx.paths.runs, oldRun))).toBe(false);
      expect(existsSync(join(h.ctx.paths.runs, freshRun))).toBe(true);
      const row = h.db.get<{ id: string; logPath: string | null }>('SELECT id, log_path FROM runs WHERE id = ?', [oldRun]);
      expect(row?.id).toBe(oldRun);
      expect(row?.logPath).toBeNull();
      expect(h.db.get<{ logPath: string | null }>('SELECT log_path FROM runs WHERE id = ?', [freshRun])?.logPath).not.toBeNull();
    });

    it('deletes worker archives older than workerArchiveDays and keeps recent ones', async () => {
      const oldWorker = h.addWorker(null, { status: 'retired', retiredAt: new Date(Date.now() - 60 * 86_400_000).toISOString() });
      const newWorker = h.addWorker(null, { status: 'retired', retiredAt: nowIso() });
      for (const id of [oldWorker, newWorker]) mkdirSync(join(h.ctx.paths.archive, id), { recursive: true });
      await supervisor.tick();
      expect(existsSync(join(h.ctx.paths.archive, oldWorker))).toBe(false);
      expect(existsSync(join(h.ctx.paths.archive, newWorker))).toBe(true);
    });

    it('does not repeat the sweep inside the 24-hour window', async () => {
      await supervisor.tick();
      const at = h.db.get<{ value: string }>('SELECT value FROM meta WHERE key = ?', ['supervisor:retention_at'])!.value;
      const worker = h.addWorker(null, { status: 'retired', retiredAt: new Date(Date.now() - 60 * 86_400_000).toISOString() });
      mkdirSync(join(h.ctx.paths.archive, worker), { recursive: true });
      await supervisor.tick();
      expect(existsSync(join(h.ctx.paths.archive, worker))).toBe(true);
      expect(h.db.get<{ value: string }>('SELECT value FROM meta WHERE key = ?', ['supervisor:retention_at'])!.value).toBe(at);
    });
  });
});
