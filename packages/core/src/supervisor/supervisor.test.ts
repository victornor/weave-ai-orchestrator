import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { newId, nowIso } from '@weave-ai/db';
import { estimateTokens, type Run, type Ticket } from '@weave-ai/shared';
import { makeHarness, fakeWake, type TestHarness } from '../testing/context.js';
import { createSupervisor } from './index.js';
import { createKnowledgeService } from '../knowledge/service.js';
import { createDecisionsService } from '../decisions/service.js';
import { createWakeService } from '../wake/index.js';
import { runState } from '../runs/active.js';
import { isWorkerStalled } from './stall-state.js';
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
    h.services.decisions = { expireDue: vi.fn(async () => []), sweepTerminalTickets: vi.fn(() => 0) } as never;
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

  // VS-625: a restart puts an interrupted worker back to work, so a card that still says it is
  // stopped is stale and must close before the re-queued turn is claimed.
  it('closes a recovered worker\'s stale parking card on a daemon restart', async () => {
    const decisions = createDecisionsService(h.ctx, h.deps);
    h.services.decisions = decisions;
    const ticketId = seedTicket(h);
    const workerId = h.addWorker(ticketId, { status: 'running' });
    const card = decisions.create({ kind: 'system', id: null }, { ticketId, kind: 'retry_approval', owner: 'human', title: 'failed', correlationKey: `retry:${workerId}`, target: { agentId: workerId, ticketId } });
    h.db.insert('runs', {
      id: newId(), workspaceId: h.workspaceId, agentId: workerId, ticketId, wakeupIdsJson: [], runtimeId: 'claude',
      status: 'running', turnEpoch: 1, cwd: '/tmp/w', pid: 999_999, startedAt: nowIso(), createdAt: nowIso(),
    });

    await supervisor.tick();

    expect(decisions.get(card.id).status).toBe('superseded');
    expect(decisions.get(card.id).answerText).toMatch(/daemon restart/);
    expect(h.db.get<{ status: string }>('SELECT status FROM agents WHERE id = ?', [workerId])!.status).toBe('active');
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
    h.services.decisions = { expireDue: vi.fn(async () => []), sweepTerminalTickets: vi.fn(() => 0) } as never;
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

    it('recounts a byte-ratio size from disk before deriving the over-budget verdict (VS-488)', async () => {
      const requestCuration = vi.fn(async () => ({}));
      const real = createKnowledgeService(h.ctx, h.deps);
      h.services.knowledge = { ...real, requestCuration } as never;
      // A row left by the old heuristic: an absurd byte-ratio size for a tiny file on disk.
      const id = seedKnowledgeFile({ tokenEstimate: 999_999, curationPending: 0, updatedAt: new Date().toISOString() });
      await supervisor.tick();
      // The verdict and the stored count follow the tokenizer, so a tiny file is neither curated
      // nor left over budget on the strength of a stale number.
      expect(requestCuration).not.toHaveBeenCalled();
      const row = h.db.get<{ tokenEstimate: number }>('SELECT token_estimate AS tokenEstimate FROM knowledge_files WHERE id = ?', [id])!;
      expect(row.tokenEstimate).toBe(estimateTokens('# Knowledge\n'));
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

    // VS-492: never-read is a third curation condition, additive to budget and age.
    function seedNeverReadDoc(): void {
      const now = Date.now();
      seedKnowledgeFile({
        path: 'projects/api/docs/never-read-doc.md', scope: 'project', projectId: h.projectId,
        lastCuratedAt: new Date(now).toISOString(), tokenEstimate: 100,
        updatedAt: new Date(now - 120 * 86_400_000).toISOString(),
      });
    }

    it('asks for curation on a document nobody has read within the window (VS-492)', async () => {
      const requestCuration = vi.fn(async () => ({}));
      h.services.knowledge = { requestCuration, recountSizes: vi.fn() } as never;
      h.services.knowledgeUsage = { neverRead: vi.fn(() => [{ scope: 'project', projectId: h.projectId, slug: 'never-read-doc', title: null, tokenEstimate: 10 }]) } as never;
      seedNeverReadDoc();
      await supervisor.tick();
      expect(requestCuration).toHaveBeenCalledWith({ kind: 'system', id: null }, 'project', h.projectId);
    });

    it('does not ask for curation when the document was read within the window (VS-492)', async () => {
      const requestCuration = vi.fn(async () => ({}));
      h.services.knowledge = { requestCuration, recountSizes: vi.fn() } as never;
      h.services.knowledgeUsage = { neverRead: vi.fn(() => []) } as never;
      seedNeverReadDoc();
      await supervisor.tick();
      expect(requestCuration).not.toHaveBeenCalled();
    });
  });

  describe('knowledge health (VS-102)', () => {
    const emptyHealth = { hubs: [{ path: 'workspace/WORKSPACE.md', scope: 'workspace', projectId: null, projectSlug: null, tokenEstimate: 100, budgetTokens: 10_000, pct: 1, nearBudget: false, curationPending: false, lastCuratedAt: null }], orphans: [] as Array<{ path: string }>, stale: [] as Array<{ path: string }>, neverRead: [] as Array<{ path: string }>, unresolvedLinks: [] as Array<{ fromPath: string; toSlug: string }> };
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

    // VS-492: the never-read measure rides the same compared signature and wake.
    it('wakes the conductor when a document becomes never-read between sweeps (VS-492)', async () => {
      const health = vi.fn(() => ({ ...emptyHealth }));
      h.services.knowledge = { requestCuration: vi.fn(async () => ({})), health } as never;
      await supervisor.tick(); // first sweep: seeds, clean
      reopenGates();
      health.mockReturnValue({ ...emptyHealth, neverRead: [{ path: 'projects/api/docs/unread.md' }] });
      await supervisor.tick();
      const woken = wake.calls.find((c) => (c.input as { payload?: { kind?: string } }).payload?.kind === 'knowledge_health');
      expect(woken).toBeDefined();
      expect((woken!.input as { payload: { neverReadDocs: string[] } }).payload.neverReadDocs).toContain('projects/api/docs/unread.md');
    });

    // VS-492: the bounded duplicate sweep surfaces pairs through the same wake, and a persisting pair
    // does not re-wake because the pair key is part of the compared signature.
    it('wakes the conductor on a new likely-duplicate pair and stays silent while it persists (VS-492)', async () => {
      const health = vi.fn(() => ({ ...emptyHealth }));
      const duplicates = vi.fn((): { pairs: unknown[]; scanned: number; capped: boolean } => ({ pairs: [], scanned: 0, capped: false }));
      h.services.knowledge = { requestCuration: vi.fn(async () => ({})), health, duplicates } as never;
      const pair = {
        score: 0.9,
        a: { path: 'projects/api/PROJECT.md', scope: 'project', projectId: h.projectId, slug: null, section: 'Learnings', text: 'Retries are idempotent.', line: '- Retries are idempotent.' },
        b: { path: 'projects/api/docs/x.md', scope: 'project', projectId: h.projectId, slug: 'x', section: 'Learnings', text: 'Idempotent retries.', line: '- Idempotent retries.' },
      };
      const healthWakes = (): number => wake.calls.filter((c) => (c.input as { payload?: { kind?: string } }).payload?.kind === 'knowledge_health').length;
      await supervisor.tick(); // first sweep: seeds
      const before = healthWakes();
      reopenGates();
      duplicates.mockReturnValue({ pairs: [pair], scanned: 2, capped: false });
      await supervisor.tick();
      const afterNew = healthWakes();
      expect(afterNew).toBeGreaterThan(before);
      const woken = wake.calls.find((c) => (c.input as { payload?: { kind?: string } }).payload?.kind === 'knowledge_health')!;
      const payload = (woken.input as { payload: { duplicatePairs: Array<{ a: string; b: string; pathA: string }> } }).payload;
      expect(payload.duplicatePairs[0]).toMatchObject({ a: 'Retries are idempotent.', b: 'Idempotent retries.', pathA: 'projects/api/PROJECT.md' });
      reopenGates();
      await supervisor.tick(); // the same pair: not new, so no further wake
      expect(healthWakes()).toBe(afterNew);
    });

    it('stays silent when duplicate, pointer and redirect candidates have all been filtered (VS-501)', async () => {
      const health = vi.fn(() => ({ ...emptyHealth }));
      const duplicates = vi.fn(() => ({ pairs: [], scanned: 0, capped: false }));
      h.services.knowledge = { requestCuration: vi.fn(async () => ({})), health, duplicates } as never;
      const healthWakes = (): number => wake.calls.filter((c) => (c.input as { payload?: { kind?: string } }).payload?.kind === 'knowledge_health').length;

      await supervisor.tick(); // first sweep records the already-filtered baseline
      reopenGates();
      await supervisor.tick(); // no short Status pair, hub pointer, or redirect orphan remains

      expect(healthWakes()).toBe(0);
      expect(duplicates).toHaveBeenCalled();
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

    it('checks a held merge review against the PR head (VS-365)', async () => {
      h.services.projects = { fetch: vi.fn(async () => ({ head: 'a', fastForwarded: false })) } as never;
      const noteHeldReviewHead = vi.fn(async () => ({ woken: true }));
      h.services.tickets = { livenessViolations: () => [], autoMergeSweep: async () => 0, transition: vi.fn(async () => ({})), noteHeldReviewHead } as never;
      h.ctx.registries.forges.set('github', { id: 'github', detect: async () => true, prState: async () => ({ state: 'open' as const, headSha: 'sha-2' }), mergePr: async () => ({}) });
      const ticketId = seedPrTicket();

      await supervisor.tick();

      expect(noteHeldReviewHead).toHaveBeenCalledWith({ kind: 'system', id: null }, ticketId, 'sha-2');
    });

    it('updates the check tally while the PR stays open, and refreshes the board (VS-328)', async () => {
      h.services.projects = { fetch: vi.fn(async () => ({ head: 'a', fastForwarded: false })) } as never;
      h.services.tickets = { livenessViolations: () => [], autoMergeSweep: async () => 0, transition: vi.fn(async () => ({})) } as never;
      type PrState = { state: 'open' | 'merged' | 'closed'; ciState?: 'pending' | 'success' | 'failure' | 'none'; checks?: { passed: number; total: number }; checkDetails?: Array<{ name: string; state: 'pending' | 'success' | 'failure' | 'none'; url: string | null }>; headSha?: string };
      const prState = vi.fn(async (): Promise<PrState> => ({ state: 'open' as const, ciState: 'pending', checks: { passed: 1, total: 3 }, checkDetails: [{ name: 'lint', state: 'pending', url: null }], headSha: 'sha-1' }));
      h.ctx.registries.forges.set('github', { id: 'github', detect: async () => true, prState, mergePr: async () => ({}) });
      const ticketId = seedPrTicket();

      await supervisor.tick();
      expect(h.db.get<{ delivery: { prChecks: unknown; ciState: unknown; ciChecks: unknown; prHead: unknown } }>('SELECT delivery_json FROM tickets WHERE id = ?', [ticketId])?.delivery).toMatchObject({ prChecks: { passed: 1, total: 3 }, ciState: 'pending', ciChecks: [{ name: 'lint', state: 'pending', url: null }], prHead: 'sha-1' });

      // The PR is still open; only the checks moved. Reset the reconcile throttle and tick again.
      h.db.run("UPDATE meta SET value = '0' WHERE key = 'supervisor:reconcile_at'");
      prState.mockResolvedValue({ state: 'open' as const, ciState: 'success', checks: { passed: 3, total: 3 } });
      const before = h.events.filter((e) => e.type === 'ticket.updated').length;
      await supervisor.tick();
      expect(h.db.get<{ delivery: { prChecks: unknown; ciState: unknown } }>('SELECT delivery_json FROM tickets WHERE id = ?', [ticketId])?.delivery).toMatchObject({ prChecks: { passed: 3, total: 3 }, ciState: 'success' });
      expect(h.events.filter((e) => e.type === 'ticket.updated').length).toBeGreaterThan(before);
    });

    describe('merge-slot progress (VS-391)', () => {
      type MergePrState = { state: 'open' | 'merged' | 'closed'; ciState?: 'pending' | 'success' | 'failure' | 'none'; checks?: { passed: number; total: number }; checkDetails?: Array<{ name: string; state: 'pending' | 'success' | 'failure' | 'none'; url: string | null }>; headSha?: string; mergeState?: 'clean' | 'blocked' | 'behind' | 'dirty'; isDraft?: boolean };
      const resetMergePoll = (): void => { h.db.run("UPDATE meta SET value = '0' WHERE key = 'supervisor:merge_ci_at'"); };
      const wakesFor = (ticketId: string): Array<{ input: Record<string, unknown> }> =>
        wake.calls.filter((c) => {
          const input = c.input as { source?: string; payload?: { ticketId?: string } };
          return input.source === 'merge_approved' && input.payload?.ticketId === ticketId;
        });
      const wakeReason = (ticketId: string): string => String((wakesFor(ticketId)[0]!.input as { reason?: string }).reason ?? '');

      function seedMergingPr(over: Record<string, unknown> = {}): string {
        const ticketId = seedTicket(h, { status: 'merging', kind: 'change', mergeStartedAt: nowIso(), ...over });
        h.db.insert('ticket_work_products', {
          id: newId(), ticketId, type: 'pull_request', provider: 'github', url: 'https://github.com/acme/api/pull/7',
          title: 'PR 7', state: 'open', isPrimary: 1, metadataJson: {}, createdAt: nowIso(), updatedAt: nowIso(),
        });
        mkdirSync(join(h.ctx.paths.projects, h.projectSlug), { recursive: true });
        h.db.update('projects', h.projectId, { status: 'ready' });
        h.addWorker(ticketId);
        return ticketId;
      }

      function setForge(prState: ReturnType<typeof vi.fn>): void {
        h.ctx.registries.forges.set('github', { id: 'github', detect: async () => true, prState, mergePr: async () => ({}) } as never);
      }

      it('wakes the worker once when the checks go pending → success', async () => {
        let ciState: 'pending' | 'success' = 'pending';
        const prState = vi.fn(async (): Promise<MergePrState> => ({ state: 'open', ciState, headSha: 'sha-1', checks: { passed: 1, total: 2 } }));
        setForge(prState);
        const ticketId = seedMergingPr();

        await supervisor.tick();
        expect(wakesFor(ticketId)).toHaveLength(0);

        resetMergePoll();
        ciState = 'success';
        await supervisor.tick();
        expect(wakesFor(ticketId)).toHaveLength(1);
        expect(wakeReason(ticketId)).toContain('passed');

        resetMergePoll();
        await supervisor.tick();
        expect(wakesFor(ticketId)).toHaveLength(1);
      });

      it('records the named checks and the head on the delivery (VS-481)', async () => {
        const prState = vi.fn(async (): Promise<MergePrState> => ({
          state: 'open', ciState: 'pending', headSha: 'sha-9',
          checks: { passed: 1, total: 2 },
          checkDetails: [{ name: 'lint', state: 'pending', url: null }, { name: 'build', state: 'success', url: null }],
        }));
        setForge(prState);
        const ticketId = seedMergingPr();

        await supervisor.tick();

        const delivery = h.db.get<{ delivery: { ciChecks: unknown; prHead: unknown; ciHead: unknown } }>('SELECT delivery_json FROM tickets WHERE id = ?', [ticketId])?.delivery;
        expect(delivery).toMatchObject({ ciChecks: [{ name: 'lint', state: 'pending', url: null }, { name: 'build', state: 'success', url: null }], prHead: 'sha-9', ciHead: 'sha-9' });
      });

      it('wakes the worker with the failure when the checks fail', async () => {        let ciState: 'pending' | 'failure' = 'pending';
        const prState = vi.fn(async (): Promise<MergePrState> => ({ state: 'open', ciState }));
        setForge(prState);
        const ticketId = seedMergingPr();

        await supervisor.tick();
        resetMergePoll();
        ciState = 'failure';
        await supervisor.tick();

        expect(wakesFor(ticketId)).toHaveLength(1);
        expect(wakeReason(ticketId)).toContain('failed');
      });

      it('does not poll a merging ticket still waiting in the queue', async () => {
        const prState = vi.fn(async (): Promise<MergePrState> => ({ state: 'open', ciState: 'success' }));
        setForge(prState);
        const ticketId = seedMergingPr({ mergeStartedAt: null, mergeQueuedAt: nowIso() });

        await supervisor.tick();

        expect(prState).not.toHaveBeenCalled();
        expect(wakesFor(ticketId)).toHaveLength(0);
      });

      it('does not wake on blocked while the checks are still pending', async () => {
        const prState = vi.fn(async (): Promise<MergePrState> => ({ state: 'open', ciState: 'pending', mergeState: 'blocked' }));
        setForge(prState);
        const ticketId = seedMergingPr();

        await supervisor.tick();

        expect(wakesFor(ticketId)).toHaveLength(0);
      });

      it('wakes on a clean merge state', async () => {
        const prState = vi.fn(async (): Promise<MergePrState> => ({ state: 'open', ciState: 'success', headSha: 'sha-1', mergeState: 'clean' }));
        setForge(prState);
        const ticketId = seedMergingPr({ deliveryJson: { ciState: 'success', ciHead: 'sha-1', prState: 'open', mergeState: 'blocked', mergeStateHead: 'sha-1' } });

        await supervisor.tick();

        expect(wakesFor(ticketId)).toHaveLength(1);
        expect(wakeReason(ticketId)).toContain('merge state is clean');
      });

      it('never wakes for a draft pull request', async () => {
        const prState = vi.fn(async (): Promise<MergePrState> => ({ state: 'open', ciState: 'success', headSha: 'sha-1', mergeState: 'clean', isDraft: true }));
        setForge(prState);
        const ticketId = seedMergingPr();

        await supervisor.tick();

        expect(wakesFor(ticketId)).toHaveLength(0);
      });

      it('throttles the forge poll so a second immediate tick does not call it again', async () => {
        const prState = vi.fn(async (): Promise<MergePrState> => ({ state: 'open', ciState: 'pending' }));
        setForge(prState);
        seedMergingPr();

        await supervisor.tick();
        await supervisor.tick();

        expect(prState).toHaveBeenCalledTimes(1);
      });

      it('leaves the delivery unchanged when the forge throws', async () => {
        const prState = vi.fn(async () => { throw new Error('gh down'); });
        setForge(prState);
        const ticketId = seedMergingPr();

        await expect(supervisor.tick()).resolves.toBeUndefined();
        expect(h.db.get<{ delivery: unknown }>('SELECT delivery_json FROM tickets WHERE id = ?', [ticketId])?.delivery).toBeNull();
      });

      describe('stalled-check alarm (VS-467)', () => {
        const alarmsFor = (ticketId: string): Array<Record<string, unknown>> =>
          wake.calls
            .map((c) => c.input as Record<string, unknown>)
            .filter((input) => input.source === 'system'
              && (input.payload as { kind?: string } | undefined)?.kind === 'merge_stalled'
              && (input.payload as { ticketId?: string } | undefined)?.ticketId === ticketId);

        it('alarms the conductor once the holder has waited past the threshold (VS-467)', async () => {
          const prState = vi.fn(async (): Promise<MergePrState> => ({ state: 'open', ciState: 'pending', headSha: 'sha-1', checks: { passed: 1, total: 3 } }));
          setForge(prState);
          const ticketId = seedMergingPr({ mergeStartedAt: new Date(Date.now() - 21 * 60_000).toISOString() });

          await supervisor.tick();

          const alarms = alarmsFor(ticketId);
          expect(alarms).toHaveLength(1);
          const reason = String(alarms[0]!['reason']);
          expect(reason).toContain('TST-1');
          expect(reason).toContain('sha-1');
          expect(reason).toContain('run is in progress');
        });

        it('does not alarm before the threshold, then alarms and throttles at the cadence (VS-467)', async () => {
          const prState = vi.fn(async (): Promise<MergePrState> => ({ state: 'open', ciState: 'pending' }));
          setForge(prState);
          const ticketId = seedMergingPr(); // admitted just now

          await supervisor.tick();
          expect(alarmsFor(ticketId)).toHaveLength(0);

          vi.useFakeTimers({ toFake: ['Date'] });
          try {
            vi.setSystemTime(Date.now() + 21 * 60_000);
            resetMergePoll();
            await supervisor.tick();
            expect(alarmsFor(ticketId)).toHaveLength(1);

            // A poll inside the cadence does not repeat the alarm.
            resetMergePoll();
            await supervisor.tick();
            expect(alarmsFor(ticketId)).toHaveLength(1);

            // Past the cadence again, it repeats.
            vi.setSystemTime(Date.now() + 21 * 60_000);
            resetMergePoll();
            await supervisor.tick();
            expect(alarmsFor(ticketId)).toHaveLength(2);
          } finally { vi.useRealTimers(); }
        });

        it('clears the alarm when the checks resolve, so a later stall alarms afresh (VS-467)', async () => {
          let ciState: 'pending' | 'success' = 'pending';
          const prState = vi.fn(async (): Promise<MergePrState> => ({ state: 'open', ciState }));
          setForge(prState);
          const ticketId = seedMergingPr({ mergeStartedAt: new Date(Date.now() - 21 * 60_000).toISOString() });

          await supervisor.tick();
          expect(alarmsFor(ticketId)).toHaveLength(1);

          resetMergePoll();
          ciState = 'success';
          await supervisor.tick();
          expect(alarmsFor(ticketId)).toHaveLength(1); // resolution is the existing worker wake, not an alarm

          resetMergePoll();
          ciState = 'pending';
          await supervisor.tick();
          expect(alarmsFor(ticketId)).toHaveLength(2);
        });

        it('names a self-hosted label no online runner serves (VS-467)', async () => {
          const prState = vi.fn(async (): Promise<MergePrState> => ({ state: 'open', ciState: 'pending' }));
          const runnerStatus = vi.fn(async () => ({ onlineLabels: ['self-hosted'] }));
          h.ctx.registries.forges.set('github', { id: 'github', detect: async () => true, prState, mergePr: async () => ({}), runnerStatus } as never);
          const ticketId = seedMergingPr({ mergeStartedAt: new Date(Date.now() - 21 * 60_000).toISOString() });
          mkdirSync(join(h.ctx.paths.projects, h.projectSlug, '.github', 'workflows'), { recursive: true });
          writeFileSync(join(h.ctx.paths.projects, h.projectSlug, '.github', 'workflows', 'ci.yml'), 'jobs:\n  a:\n    runs-on: [self-hosted, weave-ci]\n');

          await supervisor.tick();

          expect(prState).toHaveBeenCalled();
          expect(alarmsFor(ticketId)).toHaveLength(1);
          expect(runnerStatus).toHaveBeenCalled();
          expect(String(alarmsFor(ticketId)[0]!['reason'])).toContain('no online runner for `weave-ci`');
        });

        it('never alarms a holder still in draft (VS-467)', async () => {
          const prState = vi.fn(async (): Promise<MergePrState> => ({ state: 'open', ciState: 'pending', isDraft: true }));
          setForge(prState);
          const ticketId = seedMergingPr({ mergeStartedAt: new Date(Date.now() - 21 * 60_000).toISOString() });
          await supervisor.tick();
          expect(alarmsFor(ticketId)).toHaveLength(0);
        });
      });
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
      expect(String((woken!.input as { reason: string }).reason)).toContain('weave_ticket_merge_done');
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

    it('clears a pending spec-archive mark once the change is archived (VS-389)', async () => {
      h.services.projects = { fetch: vi.fn(async () => ({ head: 'a', fastForwarded: false })) } as never;
      h.services.openspec = { archiveAfterMerge: vi.fn(async () => ({ archivedAs: null, skipped: null })) } as never;
      const ticketId = seedTicket(h, { status: 'done', kind: 'change', openspecChangeName: 'add-dark-mode' });
      const clone = join(h.ctx.paths.projects, h.projectSlug);
      mkdirSync(join(clone, 'openspec', 'changes', 'archive', '2026-09-01-add-dark-mode'), { recursive: true });
      h.db.update('tickets', ticketId, { deliveryJson: { openspecArchive: { changeName: 'add-dark-mode', state: 'pending', pendingPrUrl: 'https://example.com/pr/313' } } });

      await supervisor.tick();

      const row = h.db.get<{ delivery: Record<string, unknown> | null }>('SELECT delivery_json FROM tickets WHERE id = ?', [ticketId]);
      expect(row?.delivery?.['openspecArchive']).toMatchObject({ state: 'landed' });
    });

    const openArchiveCard = (ticketId: string): string => {
      const id = newId();
      h.db.insert('decisions', {
        id, workspaceId: h.workspaceId, ticketId, projectId: h.projectId, kind: 'merge_approval', owner: 'human',
        title: 'Approve the spec archive', context: '', optionsJson: [], allowFreeText: 1, status: 'open',
        correlationKey: `merge_approval:archive:${ticketId}:add-dark-mode`,
        targetJson: { archive: { changeName: 'add-dark-mode', branch: 'ac/archive-add-dark-mode', prUrl: 'https://example.com/pr/313' } },
        createdAt: nowIso(),
      });
      return id;
    };
    const stubArchiveSweep = (landArchiveBackfill: ReturnType<typeof vi.fn>): void => {
      h.services.projects = { fetch: vi.fn(async () => ({ head: 'a', fastForwarded: false })) } as never;
      h.services.openspec = { archiveAfterMerge: vi.fn(async () => ({ archivedAs: null, skipped: null, changeName: 'add-dark-mode', branch: 'ac/archive-add-dark-mode', pendingPrUrl: 'https://example.com/pr/313', pendingPrNumber: 313 })) } as never;
      h.services.tickets = { livenessViolations: () => [], autoMergeSweep: async () => 0, landArchiveBackfill, comment: vi.fn() } as never;
    };

    it('lands a pending archive pull request itself and raises no decision (VS-570)', async () => {
      const landArchiveBackfill = vi.fn(async () => ({ landed: true }));
      stubArchiveSweep(landArchiveBackfill);
      const ticketId = seedTicket(h, { status: 'done', kind: 'change', openspecChangeName: 'add-dark-mode' });
      mkdirSync(join(h.ctx.paths.projects, h.projectSlug, 'openspec', 'changes', 'add-dark-mode'), { recursive: true });

      await supervisor.tick();

      expect(landArchiveBackfill).toHaveBeenCalledWith({ kind: 'system', id: null }, {
        ticketId, changeName: 'add-dark-mode', branch: 'ac/archive-add-dark-mode', prUrl: 'https://example.com/pr/313',
      });
      expect(h.db.all('SELECT id FROM decisions WHERE ticket_id = ?', [ticketId])).toHaveLength(0);
    });

    it('withdraws an archive card an earlier version left open and lands the pull request (VS-570)', async () => {
      const landArchiveBackfill = vi.fn(async () => ({ landed: true }));
      stubArchiveSweep(landArchiveBackfill);
      h.services.decisions = createDecisionsService(h.ctx, h.deps);
      const ticketId = seedTicket(h, { status: 'done', kind: 'change', openspecChangeName: 'add-dark-mode' });
      mkdirSync(join(h.ctx.paths.projects, h.projectSlug, 'openspec', 'changes', 'add-dark-mode'), { recursive: true });
      const cardId = openArchiveCard(ticketId);

      await supervisor.tick();

      expect(h.db.get<{ status: string }>('SELECT status FROM decisions WHERE id = ?', [cardId])?.status).toBe('withdrawn');
      expect(landArchiveBackfill).toHaveBeenCalledTimes(1);
    });

    it('retries a deferred landing on the next sweep (VS-570)', async () => {
      const landArchiveBackfill = vi.fn(async () => ({ landed: false, reason: 'required checks are pending' }));
      stubArchiveSweep(landArchiveBackfill);
      const ticketId = seedTicket(h, { status: 'done', kind: 'change', openspecChangeName: 'add-dark-mode' });
      mkdirSync(join(h.ctx.paths.projects, h.projectSlug, 'openspec', 'changes', 'add-dark-mode'), { recursive: true });

      await supervisor.tick();
      h.db.run("UPDATE meta SET value = '0' WHERE key = 'supervisor:reconcile_at'");
      await supervisor.tick();

      expect(landArchiveBackfill).toHaveBeenCalledTimes(2);
      expect(h.db.all('SELECT id FROM decisions WHERE ticket_id = ?', [ticketId])).toHaveLength(0);
    });
  });

  describe('knowledge-repo switch reconcile (VS-359)', () => {
    const switchOn = { direction: 'on' as const, branch: 'ac/knowledge-api-on', prUrl: 'https://github.com/acme/api/pull/9', startedAt: nowIso() };

    function seedReadySwitch(over: Record<string, unknown> = {}): void {
      mkdirSync(join(h.ctx.paths.projects, h.projectSlug), { recursive: true });
      h.db.update('projects', h.projectId, { status: 'ready', knowledgeRepoEnabled: 0, knowledgeSwitchJson: switchOn, ...over });
    }
    function stubProjects(state: 'open' | 'merged' | 'closed') {
      const apply = vi.fn(async (_p: unknown, enabled: boolean) => {
        h.db.update('projects', h.projectId, { knowledgeRepoEnabled: enabled ? 1 : 0, knowledgeSwitchJson: null });
      });
      h.services.projects = {
        fetch: vi.fn(async () => ({ head: 'a', fastForwarded: false })),
        get: () => ({ id: h.projectId, slug: h.projectSlug, clonePath: join(h.ctx.paths.projects, h.projectSlug) }),
        applyKnowledgeRepoSwitch: apply,
      } as never;
      h.ctx.registries.forges.set('github', { id: 'github', detect: async () => true, prState: async () => ({ state }), mergePr: async () => ({}) });
      return { apply };
    }

    it('a merged enabling pull request flips the opt-in and clears the pending switch', async () => {
      seedReadySwitch();
      const { apply } = stubProjects('merged');
      await supervisor.tick();
      expect(apply).toHaveBeenCalledWith(expect.objectContaining({ id: h.projectId }), true);
      const row = h.db.get<{ knowledgeRepoEnabled: number; knowledgeSwitch: unknown }>('SELECT knowledge_repo_enabled, knowledge_switch_json FROM projects WHERE id = ?', [h.projectId])!;
      expect(row.knowledgeRepoEnabled).toBe(1);
      expect(row.knowledgeSwitch).toBeNull();
    });

    it('a merged disabling pull request turns the opt-in off', async () => {
      seedReadySwitch({ knowledgeRepoEnabled: 1, knowledgeSwitchJson: { ...switchOn, direction: 'off', branch: 'ac/knowledge-api-off' } });
      const { apply } = stubProjects('merged');
      await supervisor.tick();
      expect(apply).toHaveBeenCalledWith(expect.objectContaining({ id: h.projectId }), false);
    });

    it('a closed pull request cancels the switch and leaves the opt-in as it was', async () => {
      seedReadySwitch({ knowledgeRepoEnabled: 0 });
      const { apply } = stubProjects('closed');
      await supervisor.tick();
      expect(apply).not.toHaveBeenCalled();
      const row = h.db.get<{ knowledgeRepoEnabled: number; knowledgeSwitch: unknown }>('SELECT knowledge_repo_enabled, knowledge_switch_json FROM projects WHERE id = ?', [h.projectId])!;
      expect(row.knowledgeRepoEnabled).toBe(0);
      expect(row.knowledgeSwitch).toBeNull();
    });

    it('an open pull request changes nothing', async () => {
      seedReadySwitch();
      const { apply } = stubProjects('open');
      await supervisor.tick();
      expect(apply).not.toHaveBeenCalled();
      const row = h.db.get<{ knowledgeSwitch: unknown }>('SELECT knowledge_switch_json FROM projects WHERE id = ?', [h.projectId])!;
      expect(row.knowledgeSwitch).not.toBeNull();
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
    h.services.decisions = { expireDue: vi.fn(async () => []), sweepTerminalTickets: vi.fn(() => 0) } as never;
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
    h.services.decisions = { expireDue: vi.fn(async () => []), sweepTerminalTickets: vi.fn(() => 0), list: () => [], withdraw: vi.fn() } as never;
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
    h.services.decisions = { expireDue: vi.fn(async () => []), sweepTerminalTickets: vi.fn(() => 0) } as never;
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
    h.services.decisions = { expireDue: vi.fn(async () => []), sweepTerminalTickets: vi.fn(() => 0) } as never;
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
    h.services.decisions = { expireDue: vi.fn(async () => []), sweepTerminalTickets: vi.fn(() => 0) } as never;
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

  it('does not flag a worker waiting on its own scheduled self-wake (VS-317)', async () => {
    const ticketId = seedTicket(h, { status: 'in_progress' });
    const agentId = h.addWorker(ticketId, { lastRunAt: oldTimestamp() });
    h.db.insert('wakeups', {
      id: newId(), workspaceId: h.workspaceId, agentId, source: 'self_scheduled', reason: 'check the sweep', payloadJson: {},
      status: 'queued', notBefore: new Date(Date.now() + 20 * 60_000).toISOString(), createdAt: nowIso(),
    });
    await supervisor.tick();
    expect(stalledEventsFor(agentId)).toHaveLength(0);
  });

  it('does not flag a worker a moment past its self-wake, before the grace margin (VS-317)', async () => {
    const ticketId = seedTicket(h, { status: 'in_progress' });
    const agentId = h.addWorker(ticketId, { lastRunAt: oldTimestamp() });
    h.db.insert('wakeups', {
      id: newId(), workspaceId: h.workspaceId, agentId, source: 'self_scheduled', reason: 'check the sweep', payloadJson: {},
      status: 'queued', notBefore: new Date(Date.now() - 10_000).toISOString(), createdAt: nowIso(),
    });
    await supervisor.tick();
    expect(stalledEventsFor(agentId)).toHaveLength(0);
  });

  it('flags a worker idle well past its own self-wake (VS-317)', async () => {
    const ticketId = seedTicket(h, { status: 'in_progress' });
    const agentId = h.addWorker(ticketId, { lastRunAt: oldTimestamp() });
    h.db.insert('wakeups', {
      id: newId(), workspaceId: h.workspaceId, agentId, source: 'self_scheduled', reason: 'check the sweep', payloadJson: {},
      status: 'queued', notBefore: new Date(Date.now() - 5 * 60_000).toISOString(), createdAt: nowIso(),
    });
    await supervisor.tick();
    expect(stalledEventsFor(agentId)).toHaveLength(1);
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

    // A new run happened (its own auto-recovery wake was claimed and completed), then it stalled again.
    h.db.run("UPDATE wakeups SET status = 'completed' WHERE agent_id = ? AND status = 'queued'", [agentId]);
    h.db.update('agents', agentId, { lastRunAt: oldTimestamp() });
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
 * VS-498: a worker detected as stalled (VS-202, above) is now automatically nudged, bounded, before
 * the supervisor gives up and hands it to the weaver — reproducing the exact VS-495 shape end to end.
 */
describe('bounded stall recovery and escalation (VS-498)', () => {
  let h: TestHarness;
  let supervisor: Supervisor;
  let wake: ReturnType<typeof createWakeService>;
  let decisions: ReturnType<typeof createDecisionsService>;

  beforeEach(() => {
    h = makeHarness();
    wake = createWakeService(h.ctx, h.deps);
    decisions = createDecisionsService(h.ctx, h.deps);
    h.services.wake = wake as never;
    h.services.decisions = decisions as never;
    h.services.workers = { spawnForTicket: vi.fn(), retireIfLanded: vi.fn(), conductor: () => ({ id: h.conductorId }) } as never;
    h.services.tickets = { livenessViolations: () => [] } as never;
    h.services.projects = { fetch: vi.fn(async () => ({ head: 'abc', fastForwarded: false })) } as never;
    h.services.accounts = { list: () => [], get: () => null, refresh: vi.fn(async () => []) } as never;
    h.ctx.config.defaults.stalledWorkerTimeoutSec = 60;
    h.ctx.config.defaults.stalledWorkerMaxAutoRecoverAttempts = 2;
    supervisor = createSupervisor(h.ctx, h.deps);
    fakeTimeActive = false;
  });
  afterEach(() => { vi.useRealTimers(); supervisor.stop(); h.cleanup(); });

  const oldTimestamp = () => new Date(Date.now() - 120_000).toISOString();
  // Fake time is kept running across calls (never toggled back to real in between) so successive
  // advances accumulate on the same clock, the way the supervisor's own `lastLiveness` gate expects.
  let fakeTimeActive = false;
  const tickLater = async (ms = 61_000) => {
    if (!fakeTimeActive) { vi.useFakeTimers({ toFake: ['Date'] }); fakeTimeActive = true; }
    vi.setSystemTime(new Date(Date.now() + ms));
    await supervisor.tick();
  };
  /** Simulates the auto-recovery wake being claimed and completed by a turn that leaves no evidence. */
  const simulateInertRecoveryTurn = (agentId: string) => {
    h.db.run("UPDATE wakeups SET status = 'completed' WHERE agent_id = ? AND status = 'queued'", [agentId]);
    h.db.update('agents', agentId, { lastRunAt: oldTimestamp() });
  };

  it('reproduces the VS-495 shape end to end: detected, auto-recovered within the bound, then escalated to the weaver', async () => {
    const ticketId = seedTicket(h, { status: 'in_progress' });
    const agentId = h.addWorker(ticketId, { lastRunAt: oldTimestamp() });

    await supervisor.tick();
    expect(h.events.some((e) => e.type === 'worker.stalled' && e.entityId === agentId)).toBe(true);
    const attemptsOf = () => h.db.get<{ attempts: number }>('SELECT * FROM worker_stall_state WHERE agent_id = ?', [agentId])?.attempts;
    expect(attemptsOf()).toBe(1);
    const rows = () => h.db.all<{ status: string; idempotencyKey: string }>('SELECT status, idempotency_key FROM wakeups WHERE agent_id = ?', [agentId]);
    expect(rows().some((w) => w.idempotencyKey === `stall-recovery:${agentId}:1` && w.status === 'queued')).toBe(true);

    // Attempt 1 produced nothing; the worker stalls again and gets attempt 2.
    simulateInertRecoveryTurn(agentId);
    await tickLater();
    expect(attemptsOf()).toBe(2);
    expect(rows().some((w) => w.idempotencyKey === `stall-recovery:${agentId}:2` && w.status === 'queued')).toBe(true);

    // Attempt 2 also produced nothing; the cap (2) is now reached — escalate instead of a third wake.
    simulateInertRecoveryTurn(agentId);
    await tickLater();
    expect(rows().some((w) => w.idempotencyKey === `stall-recovery:${agentId}:3`)).toBe(false);
    const finding = decisions.list({ ticketId, status: ['open'] }).find((d) => d.kind === 'gate_finding');
    expect(finding).toBeDefined();
    expect(finding!.owner).toBe('weaver');
    expect(finding!.correlationKey).toBe(`stalled-worker:${agentId}`);
    const escalation = h.db.get<{ escalatedAt: string | null; escalationDecisionId: string | null }>('SELECT * FROM worker_stall_state WHERE agent_id = ?', [agentId]);
    expect(escalation?.escalatedAt).not.toBeNull();
    expect(escalation?.escalationDecisionId).toBe(finding!.id);

    // No path produced a second worker for this ticket throughout.
    expect(h.services.workers!.spawnForTicket).not.toHaveBeenCalled();
    expect(h.db.get<{ workerId: string }>('SELECT worker_id FROM tickets WHERE id = ?', [ticketId])?.workerId).toBe(agentId);
    expect(h.db.all('SELECT id FROM agents WHERE ticket_id = ? AND kind = ?', [ticketId, 'worker'])).toHaveLength(1);

    // Once escalated, the open decision excludes the worker from further detection/recovery.
    await tickLater();
    expect(rows().filter((w) => w.idempotencyKey?.startsWith(`stall-recovery:${agentId}:`))).toHaveLength(2);
  });

  it('a long-running healthy turn is never treated as stalled, however long it runs', async () => {
    const ticketId = seedTicket(h, { status: 'in_progress' });
    const agentId = h.addWorker(ticketId, { lastRunAt: oldTimestamp() });
    const runId = newId();
    h.db.insert('runs', {
      id: runId, workspaceId: h.workspaceId, agentId, ticketId, wakeupIdsJson: [], runtimeId: 'claude',
      status: 'running', turnEpoch: 1, cwd: h.ctx.paths.workers, startedAt: nowIso(), createdAt: nowIso(),
    });
    runState(h.ctx).active.set(runId, { runId, agentId, startedAt: Date.now(), pid: null, cancel: async () => undefined });
    await supervisor.tick();
    await tickLater();
    await tickLater();
    expect(h.db.get('SELECT 1 FROM worker_stall_state WHERE agent_id = ?', [agentId])).toBeUndefined();
  });

  it('a worker waiting on an open decision is never auto-recovered or escalated', async () => {
    const ticketId = seedTicket(h, { status: 'in_progress' });
    const agentId = h.addWorker(ticketId, { lastRunAt: oldTimestamp() });
    decisions.create({ kind: 'agent', id: agentId }, { ticketId, kind: 'question', title: 'Which approach?', askedByAgentId: agentId });
    await supervisor.tick();
    expect(h.db.get('SELECT 1 FROM worker_stall_state WHERE agent_id = ?', [agentId])).toBeUndefined();
  });

  it('a worker with a scheduled future self-wake is never auto-recovered', async () => {
    const ticketId = seedTicket(h, { status: 'in_progress' });
    const agentId = h.addWorker(ticketId, { lastRunAt: oldTimestamp() });
    wake.scheduleSelfWake(agentId, { reason: 'check back later', delayMs: 20 * 60_000 });
    await supervisor.tick();
    expect(h.db.get('SELECT 1 FROM worker_stall_state WHERE agent_id = ?', [agentId])).toBeUndefined();
  });

  it('a worker whose ticket is blocked is never auto-recovered, even with no open decision', async () => {
    const ticketId = seedTicket(h, { status: 'blocked' });
    const agentId = h.addWorker(ticketId, { lastRunAt: oldTimestamp() });
    await supervisor.tick();
    expect(h.db.get('SELECT 1 FROM worker_stall_state WHERE agent_id = ?', [agentId])).toBeUndefined();
  });

  it('resets the attempt count once a recovered run leaves observable evidence of progress', async () => {
    const ticketId = seedTicket(h, { status: 'in_progress' });
    const agentId = h.addWorker(ticketId, { lastRunAt: oldTimestamp() });

    await supervisor.tick();
    expect(h.db.get<{ attempts: number }>('SELECT attempts FROM worker_stall_state WHERE agent_id = ?', [agentId])?.attempts).toBe(1);

    // The recovered turn leaves a ticket comment: real evidence of progress. Advance the clock first
    // so the run's timestamp is fresh relative to the tick that will observe it, not stale by the
    // time that tick's own cutoff is computed.
    if (!fakeTimeActive) { vi.useFakeTimers({ toFake: ['Date'] }); fakeTimeActive = true; }
    vi.setSystemTime(new Date(Date.now() + 61_000));
    h.db.run("UPDATE wakeups SET status = 'completed' WHERE agent_id = ? AND status = 'queued'", [agentId]);
    const runId = newId();
    const finishedAt = nowIso();
    h.db.insert('runs', {
      id: runId, workspaceId: h.workspaceId, agentId, ticketId, wakeupIdsJson: [], runtimeId: 'claude',
      status: 'succeeded', turnEpoch: 2, cwd: h.ctx.paths.workers, startedAt: finishedAt, finishedAt, createdAt: finishedAt,
    });
    h.db.insert('ticket_comments', { id: newId(), ticketId, authorKind: 'agent', runId, body: 'made progress', kind: 'status', createdAt: finishedAt });
    h.db.update('agents', agentId, { lastRunAt: finishedAt });

    await supervisor.tick();
    // Cleared: no longer in an active stall/recovery cycle.
    expect(h.db.get('SELECT 1 FROM worker_stall_state WHERE agent_id = ?', [agentId])).toBeUndefined();

    // It stalls again later; it gets the full number of attempts again, not a continuation from 1.
    h.db.update('agents', agentId, { lastRunAt: oldTimestamp() });
    await tickLater();
    expect(h.db.get<{ attempts: number }>('SELECT attempts FROM worker_stall_state WHERE agent_id = ?', [agentId])?.attempts).toBe(1);
  });

  it('resolving the escalation makes the worker eligible for detection again, with a full fresh set of attempts', async () => {
    h.ctx.config.defaults.stalledWorkerMaxAutoRecoverAttempts = 1;
    const ticketId = seedTicket(h, { status: 'in_progress' });
    const agentId = h.addWorker(ticketId, { lastRunAt: oldTimestamp() });

    await supervisor.tick(); // attempt 1
    expect(h.db.get<{ attempts: number }>('SELECT attempts FROM worker_stall_state WHERE agent_id = ?', [agentId])?.attempts).toBe(1);

    simulateInertRecoveryTurn(agentId);
    await tickLater(); // cap (1) reached — escalates
    const finding = decisions.list({ ticketId, status: ['open'] }).find((d) => d.kind === 'gate_finding');
    expect(finding).toBeDefined();

    // The weaver resolves it without the worker itself having made any progress. Its last_run_at is
    // still stale, so the very next sweep detects and recovers it again — no leftover exclusion, and
    // a full fresh set of attempts rather than treating it as already at the exhausted cap.
    decisions.withdraw({ kind: 'agent', id: h.conductorId }, finding!.id, 'steered the worker directly');
    await tickLater();
    expect(h.db.get<{ attempts: number; escalatedAt: string | null }>('SELECT * FROM worker_stall_state WHERE agent_id = ?', [agentId]))
      .toMatchObject({ attempts: 1, escalatedAt: null });
  });

  it('the workers and tickets reads distinguish a stalled worker from a working one', async () => {
    const ticketId = seedTicket(h, { status: 'in_progress' });
    const agentId = h.addWorker(ticketId, { lastRunAt: oldTimestamp() });
    expect(isWorkerStalled(h.ctx, agentId)).toBe(false);
    await supervisor.tick();
    expect(isWorkerStalled(h.ctx, agentId)).toBe(true);

    const otherTicketId = seedTicket(h, { status: 'in_progress', number: 2, identifier: 'TST-2' });
    const workingAgentId = h.addWorker(otherTicketId, { lastRunAt: nowIso() });
    expect(isWorkerStalled(h.ctx, workingAgentId)).toBe(false);
  });
});

/**
 * VS-516: a worker waiting for merge-queue admission is not a stall — the queue is what wakes it when
 * a slot frees. A worker that holds the slot is a stall exactly as before (the VS-391 shape).
 */
describe('a merge-queue wait is not a stall (VS-516)', () => {
  let h: TestHarness;
  let supervisor: Supervisor;
  let decisions: ReturnType<typeof createDecisionsService>;

  beforeEach(() => {
    h = makeHarness();
    const wake = createWakeService(h.ctx, h.deps);
    decisions = createDecisionsService(h.ctx, h.deps);
    h.services.wake = wake as never;
    h.services.decisions = decisions as never;
    h.services.workers = { spawnForTicket: vi.fn(), retireIfLanded: vi.fn(), conductor: () => ({ id: h.conductorId }) } as never;
    h.services.tickets = { livenessViolations: () => [] } as never;
    h.services.projects = { fetch: vi.fn(async () => ({ head: 'abc', fastForwarded: false })) } as never;
    h.services.accounts = { list: () => [], get: () => null, refresh: vi.fn(async () => []) } as never;
    h.ctx.config.defaults.stalledWorkerTimeoutSec = 60;
    h.ctx.config.defaults.stalledWorkerMaxAutoRecoverAttempts = 2;
    supervisor = createSupervisor(h.ctx, h.deps);
  });
  afterEach(() => { vi.useRealTimers(); supervisor.stop(); h.cleanup(); });

  const oldTimestamp = () => new Date(Date.now() - 120_000).toISOString();
  const recoveryWakes = (agentId: string) =>
    h.db.all<{ idempotencyKey: string }>(
      'SELECT idempotency_key AS idempotencyKey FROM wakeups WHERE agent_id = ? AND idempotency_key LIKE ?',
      [agentId, `stall-recovery:${agentId}:%`],
    );

  it('a queued-but-not-admitted worker gets no nudge, no finding and no stalled fact', async () => {
    const ticketId = seedTicket(h, { status: 'merging', mergeQueuedAt: oldTimestamp() });
    const agentId = h.addWorker(ticketId, { lastRunAt: oldTimestamp() });

    await supervisor.tick();

    expect(h.events.some((e) => e.type === 'worker.stalled' && e.entityId === agentId)).toBe(false);
    expect(recoveryWakes(agentId)).toHaveLength(0);
    expect(h.db.get('SELECT 1 FROM worker_stall_state WHERE agent_id = ?', [agentId])).toBeUndefined();
    expect(isWorkerStalled(h.ctx, agentId)).toBe(false);
    expect(decisions.list({ ticketId, status: ['open'] })).toHaveLength(0);
  });

  it('a slot-holding worker that ended a turn with work left and no wake is still nudged', async () => {
    const ticketId = seedTicket(h, { status: 'merging', mergeQueuedAt: oldTimestamp(), mergeStartedAt: oldTimestamp() });
    const agentId = h.addWorker(ticketId, { lastRunAt: oldTimestamp() });

    await supervisor.tick();

    expect(h.events.some((e) => e.type === 'worker.stalled' && e.entityId === agentId)).toBe(true);
    expect(h.db.get<{ attempts: number }>('SELECT attempts FROM worker_stall_state WHERE agent_id = ?', [agentId])?.attempts).toBe(1);
    expect(recoveryWakes(agentId).some((w) => w.idempotencyKey === `stall-recovery:${agentId}:1`)).toBe(true);
  });

  it('clears a carried stalled fact when the worker enters the merge-queue wait', async () => {
    const ticketId = seedTicket(h, { status: 'in_progress' });
    const agentId = h.addWorker(ticketId, { lastRunAt: oldTimestamp() });
    await supervisor.tick();
    expect(isWorkerStalled(h.ctx, agentId)).toBe(true);

    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(Date.now() + 61_000));
    h.db.update('tickets', ticketId, { status: 'merging', mergeQueuedAt: nowIso(), mergeStartedAt: null });
    await supervisor.tick();

    expect(h.db.get('SELECT 1 FROM worker_stall_state WHERE agent_id = ?', [agentId])).toBeUndefined();
    expect(isWorkerStalled(h.ctx, agentId)).toBe(false);
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
    h.services.decisions = { expireDue: vi.fn(async () => []), sweepTerminalTickets: vi.fn(() => 0) } as never;
    h.services.projects = { fetch: vi.fn(async () => ({ head: 'abc', fastForwarded: false })) } as never;
    h.services.accounts = { list: () => [], get: () => null, refresh: vi.fn(async () => []) } as never;
    h.ctx.config.defaults.weaverDigestIntervalSec = 0;
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

  it('keeps a worker-raised human-owned approval and a system-raised one, and drops a decision the weaver asked (VS-361)', async () => {
    const workerId = h.addWorker(null);
    h.ctx.events.emit('decision.created', 'decision', 'd-worker', { kind: 'merge_approval', owner: 'human', askedByAgentId: workerId, askedInRunId: 'run-1' });
    h.ctx.events.emit('decision.created', 'decision', 'd-system', { kind: 'plan_approval', owner: 'human', askedByAgentId: null, askedInRunId: null });
    h.ctx.events.emit('decision.created', 'decision', 'd-weaver', { kind: 'question', owner: 'human', askedByAgentId: h.conductorId, askedInRunId: 'run-weaver' });
    await supervisor.tick();
    const ids = digestEvents().map((e) => e.entityId);
    expect(ids).toContain('d-worker');
    expect(ids).toContain('d-system');
    expect(ids).not.toContain('d-weaver');
  });
});

/**
 * VS-306: the stale-terminal sweep is wired into the same `LIVENESS_EVERY_MS` block as the
 * approval-integrity scan. It withdraws an `open` decision attached to a ticket that is already
 * terminal and older than the 24h grace, and touches nothing on a live ticket.
 */
describe('stale terminal-decision sweep (VS-306)', () => {
  let h: TestHarness;
  let supervisor: Supervisor;

  beforeEach(() => {
    h = makeHarness();
    const decisions = createDecisionsService(h.ctx, h.deps);
    h.services.decisions = decisions as never;
    h.services.wake = fakeWake() as never;
    h.services.workers = { spawnForTicket: vi.fn(), retireIfLanded: vi.fn(), conductor: () => ({ id: h.conductorId }) } as never;
    h.services.tickets = { livenessViolations: () => [] } as never;
    h.services.projects = { fetch: vi.fn(async () => ({ head: 'abc', fastForwarded: false })) } as never;
    h.services.accounts = { list: () => [], get: () => null, refresh: vi.fn(async () => []) } as never;
    supervisor = createSupervisor(h.ctx, h.deps);
  });
  afterEach(() => { supervisor.stop(); h.cleanup(); });

  it('withdraws a stale open decision on a done ticket and leaves a live one alone', async () => {
    const doneId = seedTicket(h, { status: 'done' });
    const liveId = seedTicket(h, { status: 'in_progress', number: 2 });
    const old = new Date(Date.now() - 48 * 3600e3).toISOString();
    h.db.insert('decisions', {
      id: newId(), workspaceId: h.workspaceId, ticketId: doneId, kind: 'question', owner: 'human', title: 'stale',
      context: '', optionsJson: [], allowFreeText: 1, status: 'open', correlationKey: `question:${doneId}`, createdAt: old,
    });
    h.db.insert('decisions', {
      id: newId(), workspaceId: h.workspaceId, ticketId: liveId, kind: 'question', owner: 'human', title: 'live',
      context: '', optionsJson: [], allowFreeText: 1, status: 'open', correlationKey: `question:${liveId}`, createdAt: old,
    });

    await supervisor.tick();

    const rows = h.db.all<{ title: string; status: string }>('SELECT title, status FROM decisions WHERE workspace_id = ?', [h.workspaceId]);
    expect(rows.find((r) => r.title === 'stale')!.status).toBe('withdrawn');
    expect(rows.find((r) => r.title === 'live')!.status).toBe('open');
  });
});

/**
 * VS-461: the silence window measures *progress*, not any event, and a second consecutive no-progress
 * cut parks the worker instead of auto-resuming it again. Modelled on the 2026-09-14 DeepSeek outage,
 * where a retry loop re-emitted session/step-boundary events and a run's provider error lived only in
 * the runtime's own log.
 */
describe('supervisor silence watchdog (VS-461)', () => {
  let h: TestHarness;
  let supervisor: Supervisor;
  let wake: ReturnType<typeof fakeWake>;

  beforeEach(() => {
    h = makeHarness();
    wake = fakeWake();
    h.services.wake = wake as never;
    h.services.workers = { spawnForTicket: vi.fn(async () => ({ id: 'w1' })), retireIfLanded: vi.fn(async () => ({ retired: true })), conductor: () => ({ id: h.conductorId }) } as never;
    h.services.tickets = { livenessViolations: () => [] } as never;
    h.services.decisions = { expireDue: vi.fn(async () => []), sweepTerminalTickets: vi.fn(() => 0) } as never;
    h.services.projects = { fetch: vi.fn(async () => ({ head: 'abc', fastForwarded: false })) } as never;
    h.services.accounts = { list: () => [], get: () => null, refresh: vi.fn(async () => []) } as never;
    h.ctx.config.defaults.silenceTimeoutSec = 60;
    supervisor = createSupervisor(h.ctx, h.deps);
  });
  afterEach(() => { supervisor.stop(); h.cleanup(); });

  const secondsAgo = (s: number): string => new Date(Date.now() - s * 1000).toISOString();

  /** A `running` run registered in the in-memory state, so `bootRecovery` leaves it alone. */
  function seedRunning(workerId: string, over: Record<string, unknown> = {}): string {
    const runId = newId();
    h.db.insert('runs', {
      id: runId, workspaceId: h.workspaceId, agentId: workerId, wakeupIdsJson: [], runtimeId: 'opencode',
      status: 'running', turnEpoch: 1, cwd: '/w', startedAt: secondsAgo(120), lastProgressAt: secondsAgo(120),
      lastEventAt: secondsAgo(1), createdAt: secondsAgo(120), ...over,
    });
    runState(h.ctx).active.set(runId, { runId, agentId: workerId, startedAt: Date.now(), pid: null, cancel: async () => { /* stubbed */ } });
    return runId;
  }

  const actionEvents = (runId: string): Array<{ action: string; lastError?: string }> =>
    h.db.all<{ payload: { action: string; lastError?: string } }>('SELECT payload_json FROM run_events WHERE run_id = ?', [runId]).map((r) => r.payload);

  it('interrupts a run whose only fresh events are non-progress, naming its last upstream error', async () => {
    const workerId = h.addWorker(seedTicket(h));
    const runId = seedRunning(workerId, { lastError: 'provider deepseek: unable to start processing your request within the 900-second timeout limit' });
    await supervisor.tick();
    const actions = actionEvents(runId).filter((p) => p.action === 'silence_interrupt');
    expect(actions).toHaveLength(1);
    expect(actions[0]!.lastError).toContain('900-second timeout');
  });

  it('does not interrupt a run that recorded a progress event inside the window', async () => {
    const workerId = h.addWorker(seedTicket(h));
    const runId = seedRunning(workerId, { lastProgressAt: secondsAgo(5), lastEventAt: secondsAgo(5) });
    await supervisor.tick();
    expect(actionEvents(runId).some((p) => p.action === 'silence_interrupt')).toBe(false);
  });

  it('parks the worker after a second consecutive no-progress silence cut instead of retrying again', async () => {
    const workerId = h.addWorker(seedTicket(h));
    const priorId = newId();
    h.db.insert('runs', {
      id: priorId, workspaceId: h.workspaceId, agentId: workerId, wakeupIdsJson: [], runtimeId: 'opencode',
      status: 'interrupted', turnEpoch: 1, cwd: '/w', startedAt: secondsAgo(600), lastProgressAt: secondsAgo(600),
      finishedAt: secondsAgo(500), createdAt: secondsAgo(600),
    });
    h.db.run(
      "INSERT INTO run_events (run_id, seq, ts, type, stream, level, payload_json) VALUES (?, 1, ?, 'supervisor.action', 'system', 'warn', ?)",
      [priorId, secondsAgo(500), JSON.stringify({ action: 'silence_interrupt', silentMs: 600_000 })],
    );
    const runId = seedRunning(workerId, { lastError: 'provider deepseek: timed out' });
    await supervisor.tick();
    expect(actionEvents(runId).some((p) => p.action === 'park_after_repeated_silence')).toBe(true);
    const agent = h.db.get<{ status: string; pauseReason: string | null }>('SELECT status, pause_reason FROM agents WHERE id = ?', [workerId])!;
    expect(agent.status).toBe('paused');
    expect(agent.pauseReason).toContain('repeated_provider_no_progress');
  });

  describe('review reminders (VS-469)', () => {
    const minutesAgo = (m: number): string => new Date(Date.now() - m * 60_000).toISOString();
    const seedApproval = (over: Record<string, unknown> = {}): string => {
      const id = newId();
      h.db.insert('decisions', {
        id, workspaceId: h.workspaceId, ticketId: null, kind: 'merge_approval', owner: 'human',
        title: 'Merge TST-1?', context: '', optionsJson: [], allowFreeText: 1, status: 'open',
        createdAt: nowIso(), ...over,
      });
      return id;
    };
    const reminders = (): Array<{ agentId: string; input: Record<string, unknown> }> =>
      wake.calls.filter((c) => (c.input as { payload?: { kind?: string } }).payload?.kind === 'review_reminder');
    const reminderKeys = (): Array<string | undefined> =>
      reminders().map((c) => (c.input as { idempotencyKey?: string }).idempotencyKey);

    it('wakes the weaver for a human-owned approval unseen past the first threshold', async () => {
      const ticketId = seedTicket(h, { status: 'in_review' });
      const id = seedApproval({ ticketId, createdAt: minutesAgo(11) });
      await supervisor.tick();
      const sent = reminders();
      expect(sent).toHaveLength(1);
      expect(sent[0]!.agentId).toBe(h.conductorId);
      expect((sent[0]!.input as { reason: string }).reason).toContain('TST-1');
      expect((sent[0]!.input as { reason: string }).reason).toContain('merge');
      expect((sent[0]!.input as { payload: { decisionId: string } }).payload.decisionId).toBe(id);
      // An ordinary system wake: no forced dispatch and no future scheduling, so the run limit holds.
      expect((sent[0]!.input as { source: string }).source).toBe('system');
      expect((sent[0]!.input as { notBefore?: unknown }).notBefore).toBeUndefined();
      expect(reminderKeys()).toEqual([`review-reminder:${id}:0`]);
    });

    it('does not remind for a card still inside the first threshold', async () => {
      seedApproval({ createdAt: minutesAgo(5) });
      await supervisor.tick();
      expect(reminders()).toHaveLength(0);
    });

    it('does not remind for a card already marked looked', async () => {
      seedApproval({ createdAt: minutesAgo(11), weaverReviewStatus: 'looked' });
      await supervisor.tick();
      expect(reminders()).toHaveLength(0);
    });

    it('does not remind for a weaver-owned approval', async () => {
      seedApproval({ createdAt: minutesAgo(11), owner: 'weaver' });
      await supervisor.tick();
      expect(reminders()).toHaveLength(0);
    });

    it('does not remind for a kind that carries no review', async () => {
      seedApproval({ createdAt: minutesAgo(11), kind: 'question' });
      await supervisor.tick();
      expect(reminders()).toHaveLength(0);
    });

    it('uses a per-stage key so the same stage cannot stack duplicate wakes', async () => {
      h.services.wake = createWakeService(h.ctx, h.deps) as never;
      seedApproval({ createdAt: minutesAgo(11) });
      await supervisor.tick();
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date(Date.now() + 61_000));
      await supervisor.tick();
      vi.useRealTimers();
      const rows = h.db.all<{ status: string }>("SELECT status FROM wakeups WHERE idempotency_key LIKE 'review-reminder:%'");
      expect(rows).toHaveLength(1);
      expect(rows[0]!.status).toBe('queued');
    });

    it('moves to the next stage as the card waits longer', async () => {
      const fresh = seedApproval({ createdAt: minutesAgo(11) });
      const stale = seedApproval({ createdAt: minutesAgo(41) });
      await supervisor.tick();
      const keys = reminderKeys();
      expect(keys).toContain(`review-reminder:${fresh}:0`);
      expect(keys).toContain(`review-reminder:${stale}:1`);
    });

    it('keeps the decision id when a reminder coalesces into a queued weaver wake', async () => {
      h.services.wake = createWakeService(h.ctx, h.deps) as never;
      const id = seedApproval({ createdAt: minutesAgo(11) });
      // A weaver wake is already queued (e.g. a digest); the reminder must ride it, not be dropped.
      h.db.insert('wakeups', {
        id: newId(), workspaceId: h.workspaceId, agentId: h.conductorId, source: 'system', reason: 'digest',
        payloadJson: {}, status: 'queued', createdAt: nowIso(),
      });
      await supervisor.tick();
      const target = h.db.get<{ payload: { bundle?: Array<{ payload?: { decisionId?: string } }> } }>(
        "SELECT payload_json FROM wakeups WHERE agent_id = ? AND reason = 'digest' AND status = 'queued'",
        [h.conductorId],
      );
      expect(target!.payload.bundle?.some((e) => e.payload?.decisionId === id)).toBe(true);
    });

    it('stops reminding once the weaver marks the card looked', async () => {
      const decisions = createDecisionsService(h.ctx, h.deps);
      h.services.decisions = decisions as never;
      const id = seedApproval({ createdAt: minutesAgo(11) });
      await supervisor.tick();
      expect(reminders()).toHaveLength(1);
      decisions.review({ kind: 'agent', id: h.conductorId }, id, { status: 'looked', note: 'read the diff, clean' });
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date(Date.now() + 61_000));
      await supervisor.tick();
      vi.useRealTimers();
      expect(reminders()).toHaveLength(1);
    });

    it('carries the unreviewed card in the digest and names it in the reason', async () => {
      const ticketId = seedTicket(h, { status: 'in_review' });
      const id = seedApproval({ ticketId, createdAt: nowIso() });
      h.ctx.events.emit('decision.created', 'decision', id, { kind: 'merge_approval', owner: 'human', askedByAgentId: 'w1' });
      await supervisor.tick();
      const digest = wake.calls.find((c) => (c.input as { reason: string }).reason.startsWith('digest'));
      expect(digest).toBeTruthy();
      const payload = (digest!.input as { payload: { pendingReview: Array<{ decisionId: string; ticketIdentifier: string | null }> } }).payload;
      expect(payload.pendingReview.map((p) => p.decisionId)).toContain(id);
      expect(payload.pendingReview.find((p) => p.decisionId === id)!.ticketIdentifier).toBe('TST-1');
      expect((digest!.input as { reason: string }).reason).toContain('not reviewed');
      expect((digest!.input as { reason: string }).reason).toContain('TST-1');
    });

    it('does not list a reviewed card in the digest not-reviewed list', async () => {
      const ticketId = seedTicket(h, { status: 'in_review' });
      const id = seedApproval({ ticketId, createdAt: nowIso(), weaverReviewStatus: 'looked' });
      h.ctx.events.emit('decision.created', 'decision', id, { kind: 'merge_approval', owner: 'human', askedByAgentId: 'w1' });
      await supervisor.tick();
      const digest = wake.calls.find((c) => (c.input as { reason: string }).reason.startsWith('digest'));
      expect(digest).toBeTruthy();
      const pending = (digest!.input as { payload: { pendingReview?: unknown[] } }).payload.pendingReview ?? [];
      expect(pending).toHaveLength(0);
      expect((digest!.input as { reason: string }).reason).not.toContain('not reviewed');
    });

    it('reproduces the VOFM-77 shape end to end with the real wake and review services', async () => {
      h.services.wake = createWakeService(h.ctx, h.deps) as never;
      const decisions = createDecisionsService(h.ctx, h.deps);
      h.services.decisions = decisions as never;
      const ticketId = seedTicket(h, { status: 'in_review' });
      const workerId = h.addWorker(ticketId);
      // A worker raises the merge approval; the weaver is woken at creation (VS-361) and its turn
      // ends without ever calling the review. VOFM-77's summary said "marked looked" here.
      const approval = decisions.create({ kind: 'agent', id: workerId }, {
        ticketId, kind: 'merge_approval', title: 'Merge TST-1?', askedByAgentId: workerId,
      });
      // The weaver's run fired and ended without reviewing, so its creation wake is done.
      h.db.run("UPDATE wakeups SET status = 'completed' WHERE idempotency_key = ?", [`decision-review:${approval.id}`]);
      const stage0 = (): Array<{ status: string }> => h.db.all<{ status: string }>('SELECT status FROM wakeups WHERE idempotency_key = ?', [`review-reminder:${approval.id}:0`]);
      expect(stage0()).toHaveLength(0);

      // Three hours on, still unseen.
      h.db.update('decisions', approval.id, { createdAt: minutesAgo(11) });
      await supervisor.tick();
      expect(decisions.get(approval.id).weaverReviewStatus).toBe('unseen');
      expect(stage0()).toHaveLength(1);
      expect(stage0()[0]!.status).toBe('queued');

      // The digest names the card as not reviewed, and the API state still reads unseen.
      const digest = h.db.get<{ payload: { pendingReview?: Array<{ decisionId: string }> } }>(
        "SELECT payload_json FROM wakeups WHERE agent_id = ? AND source = 'system' AND reason LIKE 'digest%' ORDER BY created_at DESC LIMIT 1",
        [h.conductorId],
      );
      expect(digest!.payload.pendingReview?.map((p) => p.decisionId)).toContain(approval.id);

      // The weaver actually reviews it; the reminders stop and the card is countable again.
      decisions.review({ kind: 'agent', id: h.conductorId }, approval.id, { status: 'looked', note: 'read the diff, clean' });
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date(Date.now() + 61_000));
      await supervisor.tick();
      vi.useRealTimers();
      expect(stage0()).toHaveLength(1);
      expect(decisions.get(approval.id).weaverReviewStatus).toBe('looked');
    });
  });
});
