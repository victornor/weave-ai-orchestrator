import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { newId, nowIso } from '@agent-conductor/db';
import type { Run, Ticket } from '@agent-conductor/shared';
import { makeHarness, fakeWake, type TestHarness } from '../testing/context.js';
import { createSupervisor } from './index.js';
import { createKnowledgeService } from '../knowledge/service.js';
import { runState } from '../runs/active.js';
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
  let refreshAccounts: ReturnType<typeof vi.fn>;

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
    refreshAccounts = vi.fn(async () => []);
    h.services.accounts = { list: () => [], get: () => null, refresh: refreshAccounts } as never;
    supervisor = createSupervisor(h.ctx, h.deps);
  });
  afterEach(() => { supervisor.stop(); h.cleanup(); });

  it('marks runs from a dead process as interrupted and re-queues them once', async () => {
    const runId = newId();
    h.db.insert('runs', {
      id: runId, workspaceId: h.workspaceId, agentId: h.conductorId, wakeupIdsJson: [], runtimeId: 'claude',
      status: 'running', turnEpoch: 1, cwd: h.ctx.paths.weaver, pid: 999_999, startedAt: nowIso(), createdAt: nowIso(),
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

  it('spawns no worker for a ticket that is waiting in the merge queue, and one once it is admitted', async () => {
    const ticketId = seedTicket(h, { status: 'merging', mergeQueuedAt: nowIso() });
    await supervisor.tick();
    expect(spawnForTicket).not.toHaveBeenCalled();

    h.db.update('tickets', ticketId, { mergeStartedAt: nowIso() });
    await supervisor.tick();
    expect(spawnForTicket).toHaveBeenCalledWith({ kind: 'system', id: null }, ticketId);
  });

  it('pumps every project merge queue on the tick, with no transition having occurred', async () => {
    const pumpAll = vi.fn(async () => 1);
    h.services.tickets = { livenessViolations: () => [], mergeQueue: { pumpAll } } as never;
    await supervisor.tick();
    expect(pumpAll).toHaveBeenCalled();
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

  it('marks a terminal ticket\'s worker done when land refuses, not active (VS-172)', async () => {
    retireIfLanded.mockResolvedValueOnce({ retired: false, reason: 'uncommitted changes' });
    const ticketId = seedTicket(h, { status: 'done' });
    const workerId = h.addWorker(ticketId);
    await supervisor.tick();
    expect(retireIfLanded).toHaveBeenCalledWith({ kind: 'system', id: null }, workerId);
    expect(h.db.get<{ status: string }>('SELECT status FROM agents WHERE id = ?', [workerId])!.status).toBe('done');
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
  let refreshAccounts: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    h = makeHarness();
    wake = fakeWake();
    h.services.wake = wake as never;
    h.services.workers = { spawnForTicket: vi.fn(), retireIfLanded: vi.fn(), conductor: () => ({ id: h.conductorId }) } as never;
    h.services.tickets = { livenessViolations: () => [], autoMergeSweep: async () => 0 } as never;
    h.services.decisions = { expireDue: vi.fn(async () => []) } as never;
    h.services.projects = { fetch: vi.fn(async () => ({ head: 'abc', fastForwarded: false })) } as never;
    refreshAccounts = vi.fn(async () => []);
    h.services.accounts = { list: () => [], get: () => null, refresh: refreshAccounts } as never;
    supervisor = createSupervisor(h.ctx, h.deps);
  });
  afterEach(() => { vi.useRealTimers(); supervisor.stop(); h.cleanup(); });

  /** A knowledge row and the file behind it: the supervisor skips a row with nothing on disk. */
  function seedKnowledgeFile(over: Record<string, unknown> = {}, onDisk = true): string {
    const id = newId();
    const path = (over.path as string | undefined) ?? 'workspace/WORKSPACE.md';
    h.db.insert('knowledge_files', {
      id, workspaceId: h.workspaceId, projectId: null, scope: 'workspace',
      tokenEstimate: 100, budgetTokens: 10_000, lastCuratedAt: null, curationPending: 0, hash: 'x',
      updatedAt: new Date(Date.now() - 30 * 86_400_000).toISOString(), ...over, path,
    });
    if (onDisk) {
      const abs = join(h.ctx.paths.knowledge, path);
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, '# Knowledge\n', 'utf8');
    }
    return id;
  }

  const pendingOf = (id: string): number =>
    h.db.get<{ curationPending: number }>('SELECT curation_pending FROM knowledge_files WHERE id = ?', [id])!.curationPending;

  describe('curation', () => {
    it('requests curation for a file whose last curation is older than 14 days', async () => {
      const requestCuration = vi.fn(async () => ({}));
      h.services.knowledge = { requestCuration } as never;
      seedKnowledgeFile({ lastCuratedAt: new Date(Date.now() - 20 * 86_400_000).toISOString() });
      await supervisor.tick();
      expect(requestCuration).toHaveBeenCalledWith({ kind: 'system', id: null }, 'workspace', null);
    });

    it('requests curation for an over-budget file even when it was curated yesterday', async () => {
      const requestCuration = vi.fn(async () => ({}));
      h.services.knowledge = { requestCuration } as never;
      seedKnowledgeFile({ lastCuratedAt: new Date(Date.now() - 86_400_000).toISOString(), tokenEstimate: 9_000, curationPending: 1 });
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

    // VS-67: `projects/agent-conductor/docs/knowledge-documents.md` was flagged at 1,222 tokens
    // when a document's budget was 1,500; VS-18 raised it to 10,000 and nothing re-derived the
    // flag, so the pass filed one curation ticket a day for ever.
    it('clears a flag left by a budget that has since been raised, and asks for nothing', async () => {
      const requestCuration = vi.fn(async () => ({}));
      h.services.knowledge = { requestCuration } as never;
      const id = seedKnowledgeFile({
        path: 'projects/api/docs/run-engine.md', scope: 'project', projectId: h.projectId,
        tokenEstimate: 1_222, budgetTokens: 1_500, curationPending: 1, updatedAt: new Date().toISOString(),
      });
      await supervisor.tick();
      expect(requestCuration).not.toHaveBeenCalled();
      const row = h.db.get<{ curationPending: number; budgetTokens: number }>(
        'SELECT curation_pending, budget_tokens FROM knowledge_files WHERE id = ?', [id])!;
      expect(row.curationPending).toBe(0);
      expect(row.budgetTokens).toBe(10_000);
    });

    it('flags a file that has grown past 80 % of its budget since it was last written', async () => {
      const requestCuration = vi.fn(async () => ({}));
      h.services.knowledge = { requestCuration } as never;
      const id = seedKnowledgeFile({ tokenEstimate: 8_001, curationPending: 0, updatedAt: new Date().toISOString() });
      await supervisor.tick();
      expect(requestCuration).toHaveBeenCalledTimes(1);
      expect(pendingOf(id)).toBe(1);
    });

    it('skips a row whose file is no longer on disk, however stale it looks', async () => {
      const requestCuration = vi.fn(async () => ({}));
      h.services.knowledge = { requestCuration } as never;
      seedKnowledgeFile({
        path: 'projects/api/docs/archived.md', scope: 'project', projectId: h.projectId,
        lastCuratedAt: new Date(Date.now() - 20 * 86_400_000).toISOString(), curationPending: 1,
      }, false);
      await supervisor.tick();
      expect(requestCuration).not.toHaveBeenCalled();
    });

    it('asks for nothing the day after a project was curated', async () => {
      const requestCuration = vi.fn(async () => ({}));
      h.services.knowledge = { requestCuration } as never;
      const knowledge = createKnowledgeService(h.ctx, h.deps);
      knowledge.putDoc({ kind: 'system', id: null }, 'project', 'run-engine', '# Run engine\n\nOne turn end to end.\n', h.projectId);
      knowledge.note({ kind: 'system', id: null }, 'project', 'Learnings', 'The build needs Node 26 or newer.', h.projectId);
      knowledge.replace({ kind: 'system', id: null }, 'project', '# API\n\n## Learnings\n- 2026-01-01 · Curated.\n', 'curation', h.projectId);

      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date(Date.now() + 86_400_000));
      await supervisor.tick();
      expect(requestCuration).not.toHaveBeenCalled();
    });

    it('asks at most once per file per day and persists the request in meta', async () => {
      const requestCuration = vi.fn(async () => ({}));
      h.services.knowledge = { requestCuration } as never;
      seedKnowledgeFile({ tokenEstimate: 9_000, curationPending: 1 });
      await supervisor.tick();
      h.db.run("DELETE FROM meta WHERE key = 'supervisor:curation_at'");   // force the 10-minute gate open again
      await supervisor.tick();
      expect(requestCuration).toHaveBeenCalledTimes(1);
      expect(h.db.get<{ value: string }>('SELECT value FROM meta WHERE key = ?', ['supervisor:curation_requested:workspace/WORKSPACE.md'])).toBeDefined();
    });

    it('does not run the pass twice inside the 10-minute window', async () => {
      const requestCuration = vi.fn(async () => ({}));
      h.services.knowledge = { requestCuration } as never;
      await supervisor.tick();
      const at = h.db.get<{ value: string }>('SELECT value FROM meta WHERE key = ?', ['supervisor:curation_at'])!.value;
      seedKnowledgeFile({ tokenEstimate: 9_000, curationPending: 1 });
      await supervisor.tick();
      expect(requestCuration).not.toHaveBeenCalled();
      expect(h.db.get<{ value: string }>('SELECT value FROM meta WHERE key = ?', ['supervisor:curation_at'])!.value).toBe(at);
    });
  });

  describe('knowledge health (VS-102)', () => {
    const emptyHealth = { hubs: [{ path: 'workspace/WORKSPACE.md', scope: 'workspace', projectId: null, projectSlug: null, tokenEstimate: 100, budgetTokens: 10_000, pct: 1, nearBudget: false, curationPending: false, lastCuratedAt: null }], orphans: [] as Array<{ path: string }>, stale: [] as Array<{ path: string }>, unresolvedLinks: [] as Array<{ fromPath: string; toSlug: string }> };
    /** Forces both the knowledge-health gate and the curation gate open again, so a test can drive two sweeps. */
    const reopenGates = (): void => { h.db.run("DELETE FROM meta WHERE key IN ('supervisor:knowledge_health_at', 'supervisor:curation_at')"); };

    it('records a project\'s first sweep without waking the conductor, even if it already has an orphan', async () => {
      h.services.knowledge = { requestCuration: vi.fn(async () => ({})), health: () => ({ ...emptyHealth, orphans: [{ path: 'projects/api/docs/old.md' }] }) } as never;
      await supervisor.tick();
      expect(wake.calls.some((c) => (c.input as { payload?: { kind?: string } }).payload?.kind === 'knowledge_health')).toBe(false);
      expect(h.db.get<{ value: string }>('SELECT value FROM meta WHERE key = ?', ['supervisor:knowledge_health:workspace'])).toBeDefined();
    });

    it('wakes the conductor when a new orphan appears between two sweeps', async () => {
      const health = vi.fn(() => ({ ...emptyHealth }));
      h.services.knowledge = { requestCuration: vi.fn(async () => ({})), health } as never;
      await supervisor.tick(); // first sweep: seeds, clean
      reopenGates();
      health.mockReturnValue({ ...emptyHealth, orphans: [{ path: 'projects/api/docs/new-orphan.md' }] });
      await supervisor.tick();
      const woken = wake.calls.find((c) => (c.input as { payload?: { kind?: string } }).payload?.kind === 'knowledge_health');
      expect(woken).toBeDefined();
      expect((woken!.input as { payload: { orphans: string[] } }).payload.orphans).toContain('projects/api/docs/new-orphan.md');
    });

    it('wakes the conductor when a hub crosses its budget between sweeps, with no write ever rejected', async () => {
      const health = vi.fn(() => ({ ...emptyHealth }));
      h.services.knowledge = { requestCuration: vi.fn(async () => ({})), health } as never;
      await supervisor.tick();
      reopenGates();
      health.mockReturnValue({ ...emptyHealth, hubs: [{ ...emptyHealth.hubs[0]!, pct: 85, nearBudget: true }] });
      await supervisor.tick();
      const woken = wake.calls.find((c) => (c.input as { payload?: { kind?: string } }).payload?.kind === 'knowledge_health');
      expect(woken).toBeDefined();
      expect((woken!.input as { payload: { nearBudgetHubs: string[] } }).payload.nearBudgetHubs).toContain('workspace/WORKSPACE.md');
    });

    it('stays silent when nothing changed since the last sweep', async () => {
      const health = vi.fn(() => ({ ...emptyHealth, orphans: [{ path: 'projects/api/docs/steady.md' }] }));
      h.services.knowledge = { requestCuration: vi.fn(async () => ({})), health } as never;
      await supervisor.tick();
      reopenGates();
      await supervisor.tick();
      expect(wake.calls.some((c) => (c.input as { payload?: { kind?: string } }).payload?.kind === 'knowledge_health')).toBe(false);
    });

    it('stays silent once a fixed orphan drops out of the signature', async () => {
      const health = vi.fn(() => ({ ...emptyHealth, orphans: [{ path: 'projects/api/docs/temp.md' }] }));
      h.services.knowledge = { requestCuration: vi.fn(async () => ({})), health } as never;
      await supervisor.tick();
      reopenGates();
      health.mockReturnValue({ ...emptyHealth }); // the orphan got a backlink
      await supervisor.tick();
      expect(wake.calls.some((c) => (c.input as { payload?: { kind?: string } }).payload?.kind === 'knowledge_health')).toBe(false);
      reopenGates();
      health.mockReturnValue({ ...emptyHealth, orphans: [{ path: 'projects/api/docs/temp.md' }] }); // it comes back
      await supervisor.tick();
      // Reappearing is "new" relative to the now-clean signature, so it wakes again — it is not remembered forever.
      expect(wake.calls.some((c) => (c.input as { payload?: { kind?: string } }).payload?.kind === 'knowledge_health')).toBe(true);
    });
  });

  describe('approval integrity (VS-104)', () => {
    it('wakes the conductor once, naming every ticket repaired', async () => {
      const repairApprovals = vi.fn(async () => [
        { id: 't1', identifier: 'TST-1', kind: 'plan_approval' as const },
        { id: 't2', identifier: 'TST-2', kind: 'merge_approval' as const },
      ]);
      h.services.tickets = { livenessViolations: () => [], repairApprovals } as never;
      await supervisor.tick();
      expect(repairApprovals).toHaveBeenCalledOnce();
      const woken = wake.calls.filter((c) => (c.input as { payload?: { kind?: string } }).payload?.kind === 'approval_repaired');
      expect(woken).toHaveLength(1);
      expect(woken[0]!.agentId).toBe(h.conductorId);
      expect((woken[0]!.input as { reason: string }).reason).toContain('TST-1');
      expect((woken[0]!.input as { reason: string }).reason).toContain('TST-2');
    });

    it('wakes nobody when there is nothing to repair', async () => {
      const repairApprovals = vi.fn(async () => []);
      h.services.tickets = { livenessViolations: () => [], repairApprovals } as never;
      await supervisor.tick();
      expect(repairApprovals).toHaveBeenCalledOnce();
      expect(wake.calls.some((c) => (c.input as { payload?: { kind?: string } }).payload?.kind === 'approval_repaired')).toBe(false);
    });

    it('does not throw the tick when the repair scan itself fails', async () => {
      h.services.tickets = { livenessViolations: () => [], repairApprovals: vi.fn(async () => { throw new Error('db unavailable'); }) } as never;
      await expect(supervisor.tick()).resolves.toBeUndefined();
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

    it('archives a task-kind ticket\'s tracker change too, not only a change-kind ticket\'s', async () => {
      h.services.projects = { fetch: vi.fn(async () => ({ head: 'a', fastForwarded: false })) } as never;
      const archiveAfterMerge = vi.fn(async () => ({ archivedAs: '2026-09-05-max-workers', skipped: null }));
      h.services.openspec = { archiveAfterMerge } as never;
      // seedTicket's default kind is 'task' — the VS-30 shape (a task ticket's OpenSpec tracker change).
      const ticketId = seedTicket(h, { status: 'done', openspecChangeName: 'max-workers' });
      const clone = join(h.ctx.paths.projects, h.projectSlug);
      mkdirSync(join(clone, 'openspec', 'changes', 'max-workers'), { recursive: true });
      await supervisor.tick();
      expect(archiveAfterMerge).toHaveBeenCalledWith(ticketId);
    });

    it('records a comment and wakes the conductor when a left-behind change fails to archive', async () => {
      h.services.projects = { fetch: vi.fn(async () => ({ head: 'a', fastForwarded: false })) } as never;
      h.services.openspec = { archiveAfterMerge: vi.fn(async () => { throw new Error('omits scenario(s) the current spec still has: "A scenario"'); }) } as never;
      const comment = vi.fn();
      h.services.tickets = { livenessViolations: () => [], comment } as never;
      const ticketId = seedTicket(h, { status: 'done', kind: 'change', openspecChangeName: 'add-dark-mode' });
      const clone = join(h.ctx.paths.projects, h.projectSlug);
      mkdirSync(join(clone, 'openspec', 'changes', 'add-dark-mode'), { recursive: true });

      await supervisor.tick();
      await Promise.resolve(); // the archive attempt's rejection is handled in a detached .catch

      expect(comment).toHaveBeenCalledWith({ kind: 'system', id: null }, ticketId, expect.stringContaining('A scenario'), 'status');
      const woken = wake.calls.find((c) => (c.input as { idempotencyKey?: string }).idempotencyKey === `reconcile-archive-failed:${ticketId}`);
      expect(woken).toBeDefined();
      expect(String((woken!.input as { reason: string }).reason)).toContain('A scenario');
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
          turnEpoch: 1, cwd: h.ctx.paths.weaver, finishedAt, logPath: join(dir, 'events.jsonl'), createdAt: finishedAt,
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

describe('supervisor runtime account refresh', () => {
  let h: TestHarness;
  let supervisor: Supervisor;

  beforeEach(() => {
    h = makeHarness();
    h.services.wake = fakeWake() as never;
    h.services.workers = { spawnForTicket: vi.fn(), retireIfLanded: vi.fn(), conductor: () => ({ id: h.conductorId }) } as never;
    h.services.tickets = { livenessViolations: () => [], autoMergeSweep: async () => 0 } as never;
    h.services.decisions = { expireDue: vi.fn(async () => []) } as never;
    h.services.projects = { fetch: vi.fn(async () => ({ head: 'abc', fastForwarded: false })) } as never;
    supervisor = createSupervisor(h.ctx, h.deps);
  });
  afterEach(() => { supervisor.stop(); h.cleanup(); });

  const withAccounts = (refresh: ReturnType<typeof vi.fn>): void => {
    h.services.accounts = { list: () => [], get: () => null, refresh, gatedRuntimes: () => [] } as never;
  };

  it('refreshes the runtime account snapshots on the first tick', async () => {
    const refresh = vi.fn(async () => []);
    withAccounts(refresh);
    await supervisor.tick();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('does not refresh again before the interval has elapsed', async () => {
    const refresh = vi.fn(async () => []);
    withAccounts(refresh);
    await supervisor.tick();
    await supervisor.tick();
    await supervisor.tick();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('refreshes again once the interval has elapsed', async () => {
    const refresh = vi.fn(async () => []);
    withAccounts(refresh);
    await supervisor.tick();
    // The pass persists its last run in `meta`, so a restart does not re-run it immediately.
    h.db.run("UPDATE meta SET value = ? WHERE key = 'supervisor:accounts_at'", [String(Date.now() - 6 * 60_000)]);
    await supervisor.tick();
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('does not fail the tick when the refresh throws', async () => {
    withAccounts(vi.fn(async () => { throw new Error('the CLI is not logged in'); }));
    await expect(supervisor.tick()).resolves.toBeUndefined();
  });
});

/**
 * The login recheck (VS-75): while a runtime is gated the whole workspace is stopped on it, so the
 * supervisor probes it on a fast clock and releases everything the moment the credential works.
 * "Works" is deliberately narrow — `unknown` also means a missing binary, and un-gating on that
 * would walk straight into a second outage.
 */
describe('supervisor runtime login recheck', () => {
  let h: TestHarness;
  let supervisor: Supervisor;
  let refresh: ReturnType<typeof vi.fn>;
  let noteVerified: ReturnType<typeof vi.fn>;
  let credential: { present: boolean; expiresAt: string | null; refreshFailedAt: string | null };

  beforeEach(() => {
    h = makeHarness();
    h.services.wake = fakeWake() as never;
    h.services.workers = { spawnForTicket: vi.fn(), retireIfLanded: vi.fn(), conductor: () => ({ id: h.conductorId }) } as never;
    h.services.tickets = { livenessViolations: () => [], autoMergeSweep: async () => 0 } as never;
    h.services.decisions = { expireDue: vi.fn(async () => []), list: () => [], withdraw: vi.fn() } as never;
    h.services.projects = { fetch: vi.fn(async () => ({ head: 'abc', fastForwarded: false })) } as never;
    refresh = vi.fn(async () => []);
    noteVerified = vi.fn();
    // The credential was renewed after the failure: expiry later than the failure time, so the
    // cheap pre-check lets the probe run.
    credential = { present: true, expiresAt: '2026-09-08T10:00:00.000Z', refreshFailedAt: '2026-09-07T09:07:00.000Z' };
    h.services.accounts = {
      list: () => [], get: () => null, refresh,
      gatedRuntimes: () => ['claude'],
      credential: () => credential,
      noteVerified,
    } as never;
    supervisor = createSupervisor(h.ctx, h.deps);
  });
  afterEach(() => { supervisor.stop(); h.cleanup(); });

  it('probes a gated runtime and clears the gate when the probe describes the account', async () => {
    refresh.mockResolvedValue([{ runtimeId: 'claude', billingType: 'subscription_included' }] as never);
    await supervisor.tick();
    expect(refresh).toHaveBeenCalledWith(['claude']);
    expect(noteVerified).toHaveBeenCalledWith('claude');
  });

  it('leaves the gate up while the probe still cannot describe the account', async () => {
    refresh.mockResolvedValue([{ runtimeId: 'claude', billingType: 'unknown' }] as never);
    await supervisor.tick();
    expect(noteVerified).not.toHaveBeenCalled();
  });

  it('does not treat a missing binary as a restored login', async () => {
    // A probe that could not launch the CLI reports `unknown` too. Un-gating on it would start
    // every agent again into the same failure.
    refresh.mockResolvedValue([{ runtimeId: 'claude', billingType: 'unknown', note: 'claude: not found on PATH' }] as never);
    await supervisor.tick();
    expect(noteVerified).not.toHaveBeenCalled();
  });

  it('skips the probe when nobody has logged in since the failure', async () => {
    // The credential's expiry has not moved past the failure, so it is still the dead one.
    credential = { present: true, expiresAt: '2026-09-07T09:00:00.000Z', refreshFailedAt: '2026-09-07T09:07:00.000Z' };
    await supervisor.tick();
    expect(refresh).not.toHaveBeenCalledWith(['claude']);
  });

  it('skips a runtime whose credential is gone entirely', async () => {
    credential = { present: false, expiresAt: null, refreshFailedAt: '2026-09-07T09:07:00.000Z' };
    await supervisor.tick();
    expect(refresh).not.toHaveBeenCalledWith(['claude']);
  });

  it('does not fail the tick when the probe throws', async () => {
    refresh.mockRejectedValue(new Error('the CLI is not logged in'));
    await expect(supervisor.tick()).resolves.toBeUndefined();
  });
});

describe('supervisor idle interactive sessions (VS-101)', () => {
  let h: TestHarness;
  let supervisor: Supervisor;
  let cancel: ReturnType<typeof vi.fn>;

  function seedSessionWorker(over: Record<string, unknown> = {}): { ticketId: string; agentId: string } {
    const ticketId = newId();
    const now = nowIso();
    h.db.insert('tickets', {
      id: ticketId, workspaceId: h.workspaceId, projectId: h.projectId, number: 1, identifier: 'TST-1',
      kind: 'task', title: 'Debug it', status: 'in_progress', priority: 'medium', assigneeRoleId: h.roleId,
      interactiveSession: true, createdByKind: 'human', createdAt: now, updatedAt: now,
    });
    const agentId = h.addWorker(ticketId, { lastRunAt: now, ...over });
    return { ticketId, agentId };
  }

  beforeEach(() => {
    h = makeHarness();
    h.services.wake = fakeWake() as never;
    cancel = vi.fn(async () => ({}));
    h.services.workers = { spawnForTicket: vi.fn(), retireIfLanded: vi.fn(), conductor: () => ({ id: h.conductorId }), cancel } as never;
    h.services.tickets = { livenessViolations: () => [] } as never;
    h.services.decisions = { expireDue: vi.fn(async () => []) } as never;
    h.services.projects = { fetch: vi.fn(async () => ({ head: 'abc', fastForwarded: false })) } as never;
    h.services.accounts = { list: () => [], get: () => null, refresh: vi.fn(async () => []) } as never;
    supervisor = createSupervisor(h.ctx, h.deps);
  });
  afterEach(() => { supervisor.stop(); h.cleanup(); });

  it('cancels a session idle past the timeout', async () => {
    h.ctx.config.defaults.interactiveSessionIdleTimeoutMinutes = 60;
    const { agentId } = seedSessionWorker({ lastRunAt: new Date(Date.now() - 61 * 60_000).toISOString() });
    await supervisor.tick();
    expect(cancel).toHaveBeenCalledWith({ kind: 'system', id: null }, agentId, 'idle interactive session');
  });

  it('leaves a session alone that is not idle yet', async () => {
    h.ctx.config.defaults.interactiveSessionIdleTimeoutMinutes = 60;
    seedSessionWorker({ lastRunAt: new Date(Date.now() - 5 * 60_000).toISOString() });
    await supervisor.tick();
    expect(cancel).not.toHaveBeenCalled();
  });

  it('leaves a session alone whose run is still executing, whatever lastRunAt says', async () => {
    h.ctx.config.defaults.interactiveSessionIdleTimeoutMinutes = 60;
    const { agentId } = seedSessionWorker({ lastRunAt: new Date(Date.now() - 61 * 60_000).toISOString() });
    const runId = newId();
    h.db.insert('runs', {
      id: runId, workspaceId: h.workspaceId, agentId, wakeupIdsJson: [], runtimeId: 'claude',
      status: 'running', turnEpoch: 1, cwd: h.ctx.paths.workers, startedAt: nowIso(), createdAt: nowIso(),
    });
    // Present in this process's own active-run map, so boot recovery (which runs first on the same
    // tick) treats it as a genuinely in-flight run rather than one orphaned by a previous daemon.
    runState(h.ctx).active.set(runId, { runId, agentId, startedAt: Date.now(), pid: null, cancel: async () => undefined });
    await supervisor.tick();
    expect(cancel).not.toHaveBeenCalled();
  });

  it('does not touch an ordinary (non-session) idle worker', async () => {
    h.ctx.config.defaults.interactiveSessionIdleTimeoutMinutes = 60;
    const ticketId = seedTicket(h, { status: 'in_progress' });
    h.addWorker(ticketId, { lastRunAt: new Date(Date.now() - 61 * 60_000).toISOString() });
    await supervisor.tick();
    expect(cancel).not.toHaveBeenCalled();
  });
});

describe('supervisor abandoned handover sweep (VS-249)', () => {
  let h: TestHarness;
  let supervisor: Supervisor;
  let comment: ReturnType<typeof vi.fn>;

  function configHomeFor(runtimeId: string): string {
    const dir = join(h.ctx.paths.runtimesHome, runtimeId);
    mkdirSync(dir, { recursive: true });
    return dir;
  }

  function seedHold(over: Record<string, unknown> = {}): { agentId: string; holdId: string } {
    const agentId = h.addWorker(null, { runtimeId: 'fake', status: 'paused', worktreePath: null });
    const holdId = newId();
    const now = nowIso();
    h.db.insert('agent_handovers', {
      id: holdId, agentId, ticketId: null, runtimeId: 'fake', sessionRefJson: { sessionId: 'sess-1' },
      worktreeHead: null, worktreeBranch: null, startedAt: now, startedBy: 'victor', status: 'active',
      lastActivitySignal: null, lastActivityAt: now, createdAt: now, updatedAt: now, ...over,
    });
    return { agentId, holdId };
  }

  beforeEach(() => {
    h = makeHarness();
    h.services.wake = fakeWake() as never;
    comment = vi.fn(() => ({ id: 'c1' }));
    h.services.workers = { spawnForTicket: vi.fn(), retireIfLanded: vi.fn(), conductor: () => ({ id: h.conductorId }), cancel: vi.fn() } as never;
    h.services.tickets = { livenessViolations: () => [], comment } as never;
    h.services.decisions = { expireDue: vi.fn(async () => []) } as never;
    h.services.projects = { fetch: vi.fn(async () => ({ head: 'abc', fastForwarded: false })) } as never;
    h.services.accounts = { list: () => [], get: () => null, refresh: vi.fn(async () => []) } as never;
    h.ctx.config.defaults.handoverAbandonTimeoutMinutes = 120;
    h.ctx.config.defaults.handoverQuietMinutes = 30;
    supervisor = createSupervisor(h.ctx, h.deps);
  });
  afterEach(() => { supervisor.stop(); h.cleanup(); });

  it('closes a never-touched hold once past the abandon timeout, with the never-active note', async () => {
    configHomeFor('fake');
    const { agentId, holdId } = seedHold({ startedAt: new Date(Date.now() - 121 * 60_000).toISOString(), lastActivityAt: new Date(Date.now() - 121 * 60_000).toISOString() });
    await supervisor.tick();

    expect(h.db.get<{ status: string }>('SELECT status FROM agents WHERE id = ?', [agentId])!.status).toBe('active');
    const hold = h.db.get<{ status: string; note: string }>('SELECT status, note FROM agent_handovers WHERE id = ?', [holdId])!;
    expect(hold.status).toBe('abandoned');
    expect(hold.note).toMatch(/no session activity was ever detected/);
  });

  it('leaves a hold past the abandon timeout open when the activity signal changed this tick', async () => {
    const dir = configHomeFor('fake');
    const { agentId, holdId } = seedHold({ startedAt: new Date(Date.now() - 121 * 60_000).toISOString(), lastActivityAt: new Date(Date.now() - 121 * 60_000).toISOString(), lastActivitySignal: null });
    writeFileSync(join(dir, 'session.jsonl'), '{"a":1}\n');

    await supervisor.tick();

    expect(h.db.get<{ status: string }>('SELECT status FROM agents WHERE id = ?', [agentId])!.status).toBe('paused');
    const hold = h.db.get<{ status: string; lastActivitySignal: string | null }>('SELECT status, last_activity_signal AS lastActivitySignal FROM agent_handovers WHERE id = ?', [holdId])!;
    expect(hold.status).toBe('active');
    expect(hold.lastActivitySignal).not.toBeNull();
  });

  it('closes a hold whose activity stopped handoverQuietMinutes ago, with the activity-then-quiet note', async () => {
    const dir = configHomeFor('fake');
    writeFileSync(join(dir, 'session.jsonl'), '{"a":1}\n');
    const { sessionActivitySignal } = await import('../workers/activity-signal.js');
    const signal = sessionActivitySignal(dir);
    const { agentId, holdId } = seedHold({
      startedAt: new Date(Date.now() - 200 * 60_000).toISOString(),
      lastActivitySignal: signal,
      lastActivityAt: new Date(Date.now() - 31 * 60_000).toISOString(),
    });

    await supervisor.tick();

    expect(h.db.get<{ status: string }>('SELECT status FROM agents WHERE id = ?', [agentId])!.status).toBe('active');
    const hold = h.db.get<{ status: string; note: string }>('SELECT status, note FROM agent_handovers WHERE id = ?', [holdId])!;
    expect(hold.status).toBe('abandoned');
    expect(hold.note).toMatch(/activity stopped/);
  });

  it('never closes a hold with continuous activity, however long it has been open', async () => {
    const dir = configHomeFor('fake');
    writeFileSync(join(dir, 'session.jsonl'), '{"a":1}\n');
    const { sessionActivitySignal } = await import('../workers/activity-signal.js');
    const staleSignal = sessionActivitySignal(dir);
    const { agentId, holdId } = seedHold({
      startedAt: new Date(Date.now() - 300 * 60_000).toISOString(),
      lastActivitySignal: staleSignal,
      lastActivityAt: new Date(Date.now() - 300 * 60_000).toISOString(),
    });
    // Activity right now, this tick — the signal must differ from what was stored.
    writeFileSync(join(dir, 'session.jsonl'), '{"a":2,"more":"data-to-change-size"}\n');

    await supervisor.tick();

    expect(h.db.get<{ status: string }>('SELECT status FROM agents WHERE id = ?', [agentId])!.status).toBe('paused');
    expect(h.db.get<{ status: string }>('SELECT status FROM agent_handovers WHERE id = ?', [holdId])!.status).toBe('active');
  });

  it('posts the reconciliation and note as a ticket comment when the ticket is known', async () => {
    configHomeFor('fake');
    const ticketId = seedTicket(h, { status: 'in_progress' });
    const agentId = h.addWorker(ticketId, { runtimeId: 'fake', status: 'paused', worktreePath: null });
    const holdId = newId();
    const started = new Date(Date.now() - 121 * 60_000).toISOString();
    h.db.insert('agent_handovers', {
      id: holdId, agentId, ticketId, runtimeId: 'fake', sessionRefJson: { sessionId: 'sess-1' },
      worktreeHead: null, worktreeBranch: null, startedAt: started, startedBy: 'victor', status: 'active',
      lastActivitySignal: null, lastActivityAt: started, createdAt: started, updatedAt: started,
    });

    await supervisor.tick();

    expect(comment).toHaveBeenCalledWith(
      { kind: 'system', id: null }, ticketId, expect.stringContaining('no activity detected'), 'status', 'trusted',
    );
  });
});

/**
 * VS-202: the watchdog above only ever inspects `runs` with `status = 'running'`, so a worker whose
 * turn ended cleanly and was simply never re-woken (the VS-199 incident shape) is invisible to it.
 * `stalledWorkerScan` is a fully independent detection pass reading `agents`/`tickets`/`decisions`/
 * `wakeups`, gated on the same `LIVENESS_EVERY_MS` cadence as `livenessScan`/`approvalIntegrityScan`.
 */
describe('stalled worker detection (VS-202)', () => {
  let h: TestHarness;
  let supervisor: Supervisor;
  let wake: ReturnType<typeof fakeWake>;

  beforeEach(() => {
    h = makeHarness();
    wake = fakeWake();
    h.services.wake = wake as never;
    h.services.workers = { spawnForTicket: vi.fn(), retireIfLanded: vi.fn(), conductor: () => ({ id: h.conductorId }) } as never;
    h.services.tickets = { livenessViolations: () => [] } as never;
    h.services.decisions = { expireDue: vi.fn(async () => []) } as never;
    h.services.projects = { fetch: vi.fn(async () => ({ head: 'abc', fastForwarded: false })) } as never;
    h.services.accounts = { list: () => [], get: () => null, refresh: vi.fn(async () => []) } as never;
    h.ctx.config.defaults.stalledWorkerTimeoutSec = 60;
    supervisor = createSupervisor(h.ctx, h.deps);
  });
  afterEach(() => { vi.useRealTimers(); supervisor.stop(); h.cleanup(); });

  const stalledEventsFor = (agentId: string) => h.events.filter((e) => e.type === 'worker.stalled' && e.entityId === agentId);
  const oldTimestamp = () => new Date(Date.now() - 120_000).toISOString(); // past the 60s test threshold

  it('flags a worker whose last run ended succeeded, no wakeup was ever queued, and its ticket is still open (the VS-199 shape)', async () => {
    const ticketId = seedTicket(h, { status: 'in_progress' });
    const old = oldTimestamp();
    const agentId = h.addWorker(ticketId, { lastRunAt: old });
    h.db.insert('runs', {
      id: newId(), workspaceId: h.workspaceId, agentId, ticketId, wakeupIdsJson: [], runtimeId: 'claude',
      status: 'succeeded', turnEpoch: 1, cwd: h.ctx.paths.workers, startedAt: old, finishedAt: old, createdAt: old,
    });
    await supervisor.tick();
    expect(stalledEventsFor(agentId)).toHaveLength(1);
  });

  it('reaches the conductor through the existing digest path with no additional wiring', async () => {
    const ticketId = seedTicket(h, { status: 'in_progress' });
    const agentId = h.addWorker(ticketId, { lastRunAt: oldTimestamp() });
    await supervisor.tick();
    const digest = wake.calls.find((c) => (c.input as { reason: string }).reason === 'digest');
    expect(digest).toBeDefined();
    const events = (digest!.input as { payload: { events: Array<{ type: string; entityId: string }> } }).payload.events;
    expect(events.some((e) => e.type === 'worker.stalled' && e.entityId === agentId)).toBe(true);
  });

  it('does not flag a worker with a run still queued or running, whatever its last_run_at', async () => {
    const ticketId = seedTicket(h, { status: 'in_progress' });
    const agentId = h.addWorker(ticketId, { lastRunAt: oldTimestamp() });
    const runId = newId();
    h.db.insert('runs', {
      id: runId, workspaceId: h.workspaceId, agentId, ticketId, wakeupIdsJson: [], runtimeId: 'claude',
      status: 'running', turnEpoch: 1, cwd: h.ctx.paths.workers, startedAt: nowIso(), createdAt: nowIso(),
    });
    // Present in this process's own active-run map, so boot recovery (which runs first on the same
    // tick) treats it as genuinely in-flight rather than an orphan left by a previous daemon.
    runState(h.ctx).active.set(runId, { runId, agentId, startedAt: Date.now(), pid: null, cancel: async () => undefined });
    await supervisor.tick();
    expect(stalledEventsFor(agentId)).toHaveLength(0);
  });

  it('does not flag a worker whose ticket has an open decision awaiting a human', async () => {
    const ticketId = seedTicket(h, { status: 'in_progress' });
    const agentId = h.addWorker(ticketId, { lastRunAt: oldTimestamp() });
    h.db.insert('decisions', {
      id: newId(), workspaceId: h.workspaceId, ticketId, kind: 'question', owner: 'human', title: 'Which approach?',
      context: '', optionsJson: [], allowFreeText: 1, status: 'open', createdAt: nowIso(),
    });
    await supervisor.tick();
    expect(stalledEventsFor(agentId)).toHaveLength(0);
  });

  it('does not flag an operational worker waiting on an open action_approval', async () => {
    const ticketId = seedTicket(h, { status: 'in_progress', kind: 'operational' });
    const agentId = h.addWorker(ticketId, { lastRunAt: oldTimestamp() });
    h.db.insert('decisions', {
      id: newId(), workspaceId: h.workspaceId, ticketId, kind: 'action_approval', owner: 'human',
      title: 'Approve the action?', context: '', optionsJson: [], allowFreeText: 1, status: 'open', createdAt: nowIso(),
    });
    await supervisor.tick();
    expect(stalledEventsFor(agentId)).toHaveLength(0);
  });

  it('does not flag a worker with a wakeup already queued', async () => {
    const ticketId = seedTicket(h, { status: 'in_progress' });
    const agentId = h.addWorker(ticketId, { lastRunAt: oldTimestamp() });
    h.db.insert('wakeups', {
      id: newId(), workspaceId: h.workspaceId, agentId, source: 'system', reason: 'x', payloadJson: {},
      status: 'queued', createdAt: nowIso(),
    });
    await supervisor.tick();
    expect(stalledEventsFor(agentId)).toHaveLength(0);
  });

  it('does not flag a worker whose ticket is an interactive session (VS-213)', async () => {
    const ticketId = seedTicket(h, { status: 'in_progress', interactiveSession: true });
    const agentId = h.addWorker(ticketId, { lastRunAt: oldTimestamp() });
    await supervisor.tick();
    expect(stalledEventsFor(agentId)).toHaveLength(0);
  });

  it('does not flag a worker whose ticket is done', async () => {
    const ticketId = seedTicket(h, { status: 'done' });
    const agentId = h.addWorker(ticketId, { lastRunAt: oldTimestamp() });
    await supervisor.tick();
    expect(stalledEventsFor(agentId)).toHaveLength(0);
  });

  it('does not flag a worker whose last run finished less than the threshold ago', async () => {
    const ticketId = seedTicket(h, { status: 'in_progress' });
    const agentId = h.addWorker(ticketId, { lastRunAt: nowIso() });
    await supervisor.tick();
    expect(stalledEventsFor(agentId)).toHaveLength(0);
  });

  it('never flags the conductor: its ticket_id is always null, which excludes it from the join', async () => {
    h.db.update('agents', h.conductorId, { lastRunAt: oldTimestamp() });
    await supervisor.tick();
    expect(h.events.filter((e) => e.type === 'worker.stalled')).toHaveLength(0);
  });

  it('does not re-emit for a worker that is still stalled, but does once it gets a new run and stalls again', async () => {
    const ticketId = seedTicket(h, { status: 'in_progress' });
    const agentId = h.addWorker(ticketId, { lastRunAt: oldTimestamp() });

    await supervisor.tick();
    expect(stalledEventsFor(agentId)).toHaveLength(1);

    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(Date.now() + 61_000)); // past LIVENESS_EVERY_MS, so the sweep runs again
    await supervisor.tick();
    expect(stalledEventsFor(agentId)).toHaveLength(1); // same stall, not re-notified

    h.db.update('agents', agentId, { lastRunAt: oldTimestamp() }); // a new run happened, then it stalled again
    vi.setSystemTime(new Date(Date.now() + 61_000));
    await supervisor.tick();
    expect(stalledEventsFor(agentId)).toHaveLength(2);
  });

  it('does not fail the tick when the scan itself throws', async () => {
    const originalAll = h.db.all.bind(h.db);
    h.db.all = ((sql: string, params?: unknown[]) => {
      if (sql.includes('FROM agents a JOIN tickets t')) throw new Error('db unavailable');
      return originalAll(sql as never, params as never);
    }) as typeof h.db.all;
    seedTicket(h, { status: 'in_progress' });
    await expect(supervisor.tick()).resolves.toBeUndefined();
  });

  it('enqueues a conductor wake for a due routine (VS-220)', async () => {
    const { createWakeService } = await import('../wake/index.js');
    const { createRoutinesService } = await import('../routines/index.js');
    const wakeSvc = createWakeService(h.ctx, h.deps);
    h.services.wake = wakeSvc as never;
    h.services.workers = { spawnForTicket: vi.fn(), retireIfLanded: vi.fn(), conductor: () => ({ id: h.conductorId }) } as never;
    const routines = createRoutinesService(h.ctx, h.deps);
    h.services.routines = routines as never;
    const r = routines.create({ kind: 'human', id: 'victor' }, {
      name: 'Tick check',
      trigger: { kind: 'schedule', timezone: 'UTC', everyMinutes: 15 },
      instruction: 'Say hello.',
    });
    h.db.update('routines', r.id, { nextFireAt: '2020-01-01T00:00:00.000Z' });
    await supervisor.tick();
    const wakes = h.db.all<{ source: string; agentId: string }>('SELECT source, agent_id FROM wakeups WHERE source = ?', ['routine']);
    expect(wakes).toEqual([{ source: 'routine', agentId: h.conductorId }]);
  });
});

/**
 * VS-245: a finished run's stored report summary reaches the conductor in its digest wake, capped,
 * attributed to the agent, explicit when there is no report, and bounded across a burst of runs.
 * See `worker-supervision/conductor-digest`.
 */
describe('conductor digest run summaries (VS-245)', () => {
  let h: TestHarness;
  let supervisor: Supervisor;
  let wake: ReturnType<typeof fakeWake>;

  beforeEach(() => {
    h = makeHarness();
    wake = fakeWake();
    h.services.wake = wake as never;
    h.services.workers = { spawnForTicket: vi.fn(), retireIfLanded: vi.fn(), conductor: () => ({ id: h.conductorId }) } as never;
    h.services.tickets = { livenessViolations: () => [] } as never;
    h.services.decisions = { expireDue: vi.fn(async () => []) } as never;
    h.services.projects = { fetch: vi.fn(async () => ({ head: 'abc', fastForwarded: false })) } as never;
    h.services.accounts = { list: () => [], get: () => null, refresh: vi.fn(async () => []) } as never;
    h.ctx.config.defaults.conductorDigestIntervalSec = 0;
    supervisor = createSupervisor(h.ctx, h.deps);
  });
  afterEach(() => { supervisor.stop(); h.cleanup(); });

  /**
   * A finished run, its stored report and its `run.finished` event. `eventSummary` deliberately
   * differs from `reportSummary`: the engine's event carries a fallback that conflates a report
   * summary with a final-text excerpt and a failure message, so the digest must read the report.
   */
  function finishedRun(workerId: string, over: { reportSummary?: string; eventSummary?: string; resultJson?: Record<string, unknown> | null; liveness?: string } = {}): string {
    const runId = newId();
    const at = nowIso();
    const resultJson = over.resultJson === undefined
      ? { state: 'blocked', summary: over.reportSummary ?? 'the agent report', knowledge: { recorded: false, reason: 'none' } }
      : over.resultJson;
    h.db.insert('runs', {
      id: runId, workspaceId: h.workspaceId, agentId: workerId, wakeupIdsJson: [], runtimeId: 'claude',
      status: 'failed', turnEpoch: 1, cwd: h.ctx.paths.workers, startedAt: at, finishedAt: at, createdAt: at,
      resultJson, summary: over.reportSummary ?? null,
    });
    h.ctx.events.emit('run.finished', 'run', runId, { agentId: workerId, liveness: over.liveness ?? 'blocked', summary: over.eventSummary ?? over.reportSummary });
    return runId;
  }

  const digestEvents = (): Array<Record<string, unknown>> => {
    const digest = wake.calls.find((c) => (c.input as { reason: string }).reason === 'digest');
    return (digest!.input as { payload: { events: Array<Record<string, unknown>> } }).payload.events;
  };
  const entryFor = (runId: string): Record<string, unknown> => digestEvents().find((e) => e.entityId === runId)!;

  it('carries the stored report summary, attributed to the agent, not the event fallback', async () => {
    const workerId = h.addWorker(null);
    const runId = finishedRun(workerId, { reportSummary: 'Fixed the flaky test and opened a PR.', eventSummary: 'event payload fallback text' });
    await supervisor.tick();
    expect(entryFor(runId).agentReportedSummary).toBe('Fixed the flaky test and opened a PR.');
    expect(entryFor(runId).summaryOmitted).toBeUndefined();
  });

  it('says plainly when a run stored no report, including one that failed', async () => {
    const workerId = h.addWorker(null);
    const noReport = finishedRun(workerId, { resultJson: null, eventSummary: 'the runtime died' });
    const failedNoReport = finishedRun(workerId, { resultJson: null, eventSummary: 'exit 1', liveness: 'failed' });
    await supervisor.tick();
    for (const id of [noReport, failedNoReport]) {
      expect(entryFor(id).agentReportedSummary).toBeUndefined();
      expect(entryFor(id).summaryOmitted).toBe('no_report');
    }
  });

  it('caps a single long summary with a visible truncation marker', async () => {
    const workerId = h.addWorker(null);
    const long = 'x'.repeat(1_000);
    const runId = finishedRun(workerId, { reportSummary: long });
    await supervisor.tick();
    const carried = entryFor(runId).agentReportedSummary as string;
    expect(carried.length).toBeLessThanOrEqual(400);
    expect(carried.length).toBeLessThan(long.length);
    expect(carried.endsWith('…')).toBe(true);
  });

  it('bounds the total summary text when many runs finish between digests', async () => {
    const workerId = h.addWorker(null);
    for (let i = 0; i < 60; i += 1) finishedRun(workerId, { reportSummary: `summary ${i} `.padEnd(300, 'x') });
    await supervisor.tick();
    const events = digestEvents();
    const carried = events.map((e) => e.agentReportedSummary).filter((s): s is string => typeof s === 'string');
    expect(carried.length).toBeGreaterThan(0);
    expect(carried.reduce((n, s) => n + s.length, 0)).toBeLessThanOrEqual(1_600);
    expect(events.some((e) => e.summaryOmitted === 'digest_cap')).toBe(true);
    expect(events.length).toBeLessThanOrEqual(30);
  });
});
