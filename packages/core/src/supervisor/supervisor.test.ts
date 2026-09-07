import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { newId, nowIso } from '@agent-conductor/db';
import type { Run, Ticket } from '@agent-conductor/shared';
import { makeHarness, fakeWake, type TestHarness } from '../testing/context.js';
import { createSupervisor } from './index.js';
import { createKnowledgeService } from '../knowledge/service.js';
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
