import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { newId, nowIso } from '@weave-ai/db';
import { FakeRuntime, type TurnInput, type TurnSink, type TurnResult } from '@weave-ai/runtime-sdk';
import { RECORDED_RUN_PHASES, RUN_PHASES, type Decision, type Run, type Wakeup } from '@weave-ai/shared';
import { makeHarness, type TestHarness } from '../testing/context.js';
import type { Actor } from '../api.js';
import { createDecisionsService } from '../decisions/service.js';
import { createTicketsService } from '../tickets/service.js';
import { createProjectsService } from '../projects/index.js';
import { createWakeService } from '../wake/index.js';
import { createAccountsService } from '../usage/accounts.js';
import { createKnowledgeUsageService } from '../knowledge/index.js';
import { LOGIN_PAUSE_CODE, loginCorrelationKey, ungateRuntime } from './authgate.js';
import { createRunsService } from './index.js';
import { createDispatcher, type CoreDispatcher } from './dispatcher.js';
import { countRetries, executeRun } from './engine.js';
import { makeRedactor } from './engine.js';
import { runTokenSecret, verifyRunToken } from './runtoken.js';
import { git } from '../util/git.js';
import { runState } from './active.js';

const tick = () => new Promise((r) => setImmediate(r));

const IDLE_OTHER: Partial<TurnResult> = {
  structured: { state: 'idle', summary: 'other agent', tickets: [], knowledge: { recorded: false, reason: 'test fixture' } },
};

function seedTicket(h: TestHarness, over: Record<string, unknown> = {}): string {
  const id = newId();
  const now = nowIso();
  h.db.insert('tickets', {
    id, workspaceId: h.workspaceId, projectId: h.projectId, number: 1, identifier: 'TST-1', kind: 'task',
    title: 'Add a README badge', description: 'Do it.', status: 'todo', priority: 'medium',
    assigneeRoleId: h.roleId, createdByKind: 'human', createdAt: now, updatedAt: now, ...over,
  });
  return id;
}

describe('run engine', () => {
  let h: TestHarness;
  let runtime: FakeRuntime;
  let dispatcher: CoreDispatcher;

  beforeEach(() => {
    h = makeHarness();
    runtime = new FakeRuntime();
    h.ctx.registries.runtimes.set('fake', runtime);
    // Both settings, because a suite here runs conductor turns and worker turns (VS-77).
    h.ctx.config.models = { weaver: { runtime: 'fake', model: null }, workers: { runtime: 'fake', model: null }, workerOptions: [] };
    h.services.wake = createWakeService(h.ctx, h.deps);
    h.services.runs = createRunsService(h.ctx, h.deps);
    dispatcher = createDispatcher(h.ctx, h.deps);
    h.services.dispatcher = dispatcher;
  });
  afterEach(async () => { await dispatcher.stop(); h.cleanup(); });

  /**
   * VS-218: a conductor-owned gate_finding (VS-137) queues a conductor wake. After ungate, tick()
   * starts that turn *and* the worker's, they share FakeRuntime.queue, and `ORDER BY created_at DESC`
   * is non-deterministic on a millisecond tie. Return the run this test named, or fail if tick
   * started nothing for it.
   */
  async function runOnce(agentId?: string): Promise<Run> {
    const before = new Set(h.db.all<{ id: string }>('SELECT id FROM runs').map((r) => r.id));
    await dispatcher.tick();
    const started = h.db.all<{ id: string; agentId: string }>('SELECT id, agent_id FROM runs').filter((r) => !before.has(r.id));
    if (started.length === 0) {
      const agents = h.db.all<{ id: string; status: string; runtimeId: string }>('SELECT id, status, runtime_id FROM agents');
      const wakes = h.db.all<{ id: string; agentId: string; status: string }>('SELECT id, agent_id, status FROM wakeups');
      throw new Error(
        `dispatcher.tick() started no run; agents=${JSON.stringify(agents)}; wakes=${JSON.stringify(wakes)}; gated=${JSON.stringify(h.services.accounts?.gatedRuntimes?.() ?? 'no-accounts')}; stopping=${runState(h.ctx).stopping}; active=${runState(h.ctx).active.size}`,
      );
    }
    await dispatcher.drain();
    const match = agentId ? started.filter((r) => r.agentId === agentId) : started;
    if (match.length === 0) {
      throw new Error(
        `dispatcher.tick() started ${started.length} run(s) for ${JSON.stringify(started.map((s) => s.agentId))} but none for ${agentId}`,
      );
    }
    if (!agentId && match.length !== 1) {
      throw new Error(
        `dispatcher.tick() started ${match.length} runs (${JSON.stringify(started.map((s) => s.agentId))}); pass the agentId this test is asserting`,
      );
    }
    return h.db.get<Run>('SELECT * FROM runs WHERE id = ?', [match[0]!.id])!;
  }

  /** Script a result that a coincidental conductor turn (gate_finding wake) must not consume. */
  function resultFor(
    agentId: string,
    result: Partial<TurnResult> | ((input: TurnInput) => Partial<TurnResult> | Promise<Partial<TurnResult>>),
  ): (input: TurnInput) => Partial<TurnResult> | Promise<Partial<TurnResult>> {
    const deliver = (input: TurnInput): Partial<TurnResult> | Promise<Partial<TurnResult>> => {
      const owner = h.db.get<{ agentId: string }>('SELECT agent_id FROM runs WHERE id = ?', [input.runId])?.agentId;
      if (owner !== agentId) {
        runtime.queue.unshift(deliver);
        return IDLE_OTHER;
      }
      return typeof result === 'function' ? result(input) : result;
    };
    return deliver;
  }

  it('runs a turn end to end: prompt file, events, usage, session, wake completion', async () => {
    runtime.queue.push({ structured: { state: 'done', summary: 'created the ticket', tickets: [], knowledge: { recorded: false, reason: 'test fixture' } } });
    const wake = h.services.wake!.enqueue(h.conductorId, { source: 'human_message', reason: 'add a README badge' });

    const run = await runOnce();
    expect(run.status).toBe('succeeded');
    expect(run.liveness).toBe('advanced');
    expect(run.turnEpoch).toBe(1);
    expect(run.summary).toBe('created the ticket');
    expect((run.wakeupIds as string[])).toEqual([wake.id]);

    const promptPath = join(h.ctx.paths.runs, run.id, 'prompt.md');
    expect(existsSync(promptPath)).toBe(true);
    const prompt = readFileSync(promptPath, 'utf8');
    expect(prompt).toContain('## Why you were woken');
    expect(prompt).toContain('human_message: add a README badge');

    const events = h.db.all<{ type: string }>('SELECT type FROM run_events WHERE run_id = ? ORDER BY seq', [run.id]);
    expect(events.map((e) => e.type)).toContain('run.started');
    expect(events.map((e) => e.type)).toContain('run.finalized');
    expect(existsSync(join(h.ctx.paths.runs, run.id, 'events.jsonl'))).toBe(true);

    expect(h.db.get<{ n: number }>('SELECT COUNT(*) n FROM usage_events WHERE run_id = ?', [run.id])!.n).toBe(1);
    const wakeRow = h.db.get<Wakeup>('SELECT * FROM wakeups WHERE id = ?', [wake.id])!;
    expect(wakeRow.status).toBe('completed');
    const agent = h.db.get<{ status: string; turnCount: number; turnEpoch: number }>('SELECT status, turn_count, turn_epoch FROM agents WHERE id = ?', [h.conductorId])!;
    expect(agent).toMatchObject({ status: 'active', turnCount: 1, turnEpoch: 1 });
    const session = h.db.get<{ sessionRef: { sessionId: string }; turnCount: number }>('SELECT * FROM agent_sessions WHERE agent_id = ?', [h.conductorId])!;
    expect(session.turnCount).toBe(1);
    expect(session.sessionRef.sessionId).toBeTruthy();

    await tick();
    expect(h.events.filter((e) => e.type === 'run.started')).toHaveLength(1);
    expect(h.events.filter((e) => e.type === 'run.finished')).toHaveLength(1);
  });

  it('times exactly the phases RECORDED_RUN_PHASES declares, in that order', async () => {
    // Anything deriving "which phase is this run in" from `run.phase.timing` walks that list, so a
    // phase added to or dropped from the engine has to move the list with it. `RUN_PHASES` is wider:
    // it declares `spawn` and `finalize`, which nothing records.
    runtime.queue.push({ structured: { state: 'done', summary: 'done', tickets: [], knowledge: { recorded: false, reason: 'test fixture' } } });
    h.services.wake!.enqueue(h.conductorId, { source: 'human_message', reason: 'anything' });
    const run = await runOnce();

    const timed = h.services.runs!.phaseTimings(run.id).map((e) => (e.payload as { phase: string }).phase);

    // The conductor has no worktree, so it skips `prepare_worktree` — the one phase that is conditional.
    expect(timed).toEqual(RECORDED_RUN_PHASES.filter((p) => p !== 'prepare_worktree'));
    expect(RECORDED_RUN_PHASES.every((p) => RUN_PHASES.includes(p))).toBe(true);
  });

  it("records the first turn's bootstrap digest as this run's knowledge context (VS-110)", async () => {
    h.services.knowledge = {
      bootstrapDigest: () => ({
        text: 'digest text', tokens: 5, truncated: false,
        parts: [{ scope: 'shared', projectId: null, tokens: 40 }, { scope: 'project', projectId: h.projectId, tokens: 25 }],
      }),
    } as never;
    h.services.knowledgeUsage = createKnowledgeUsageService(h.ctx, h.deps);
    runtime.queue.push({ structured: { state: 'done', summary: 'done', tickets: [], knowledge: { recorded: false, reason: 'test fixture' } } });
    h.services.wake!.enqueue(h.conductorId, { source: 'human_message', reason: 'anything' });
    const run = await runOnce();

    const rows = h.db.all<{ kind: string; scope: string; tokens: number; docProjectId: string | null }>(
      'SELECT kind, scope, tokens, doc_project_id AS docProjectId FROM knowledge_usage_events WHERE run_id = ? ORDER BY scope', [run.id],
    );
    expect(rows).toEqual([
      { kind: 'hub', scope: 'project', tokens: 25, docProjectId: h.projectId },
      { kind: 'hub', scope: 'shared', tokens: 40, docProjectId: null },
    ]);
  });

  it('injects the system prompt on the first turn only and resumes the session afterwards', async () => {
    h.services.wake!.enqueue(h.conductorId, { source: 'human_message', reason: 'one' });
    await runOnce();
    h.services.wake!.enqueue(h.conductorId, { source: 'human_message', reason: 'two' });
    await runOnce();

    expect(runtime.inputs).toHaveLength(2);
    expect(runtime.inputs[0]!.session.isFirstTurn).toBe(true);
    expect(runtime.inputs[0]!.systemPrompt.mode).toBe('inject');
    expect(runtime.inputs[0]!.systemPrompt.text).toContain('weaver');
    expect(runtime.inputs[1]!.session.isFirstTurn).toBe(false);
    expect(runtime.inputs[1]!.systemPrompt.mode).toBe('skip');
    expect(runtime.inputs[1]!.session.ref).toEqual(runtime.inputs[0]!.session.ref ?? expect.anything());
    expect(runtime.inputs[1]!.turnEpoch).toBe(2);
  });

  it('passes the MCP endpoint, the run token and the AC_* environment to the runtime', async () => {
    h.services.wake!.enqueue(h.conductorId, { source: 'system', reason: 'digest' });
    const run = await runOnce();
    const input = runtime.inputs[0]!;
    expect(input.mcpServers['weave-ai']).toMatchObject({ type: 'http', url: `${h.ctx.loopbackUrl}/mcp/runs/${run.id}` });
    const authHeader = input.mcpServers['weave-ai']!.headers!.Authorization!;
    expect(authHeader.startsWith('Bearer rt_')).toBe(true);
    expect(input.env.AC_RUN_TOKEN).toBe(authHeader.slice('Bearer '.length));
    expect(input.env.AC_RUN_ID).toBe(run.id);
    expect(input.env.AC_AGENT_KIND).toBe('weaver');
    expect(input.env.AC_WORKSPACE_ID).toBe(h.workspaceId);
    expect(input.outputSchema).toBeTruthy();
    const claims = await verifyRunToken(runTokenSecret(h.db), input.env.AC_RUN_TOKEN!);
    expect(claims).toMatchObject({ workspaceId: h.workspaceId, runId: run.id, agentId: h.conductorId, agentKind: 'weaver' });
  });

  it('bundles every queued wake for one agent into a single run', async () => {
    const a = h.services.wake!.enqueue(h.conductorId, { source: 'human_message', reason: 'first' });
    const b = h.services.wake!.enqueue(h.conductorId, { source: 'ticket_comment', reason: 'second' });
    expect(b.status).toBe('coalesced');
    const run = await runOnce();
    expect((run.wakeupIds as string[])).toEqual([a.id]);
    const prompt = readFileSync(join(h.ctx.paths.runs, run.id, 'prompt.md'), 'utf8');
    expect(prompt).toContain('first');
    expect(prompt).toContain('second');   // the coalesced payload is flattened into the digest
    expect(h.db.all('SELECT * FROM runs')).toHaveLength(1);
  });

  it('records an empty turn when the agent produces no report', async () => {
    runtime.queue.push({ structured: undefined, finalText: 'I looked around and did nothing' });
    h.services.wake!.enqueue(h.conductorId, { source: 'timer', reason: 'heartbeat' });
    const run = await runOnce();
    expect(run.status).toBe('succeeded');
    expect(run.liveness).toBe('empty');
  });

  it('treats a report with an incomplete knowledge decision as no report at all (VS-102)', async () => {
    // Every other field is valid; `knowledge.recorded: true` with no `where` fails the schema, so
    // the whole report fails to parse — the same "incomplete report" outcome a missing `state` gets.
    runtime.queue.push({ structured: { state: 'done', summary: 'finished the ticket', tickets: [], knowledge: { recorded: true } } });
    h.services.wake!.enqueue(h.conductorId, { source: 'human_message', reason: 'go' });
    const run = await runOnce();
    expect(run.status).toBe('succeeded');
    expect(run.liveness).toBe('empty');
  });

  it('marks needs_decision liveness from the structured report', async () => {
    runtime.queue.push({ structured: { state: 'needs_decision', summary: 'asked the human', tickets: [], knowledge: { recorded: false, reason: 'test fixture' } } });
    h.services.wake!.enqueue(h.conductorId, { source: 'human_message', reason: 'hmm' });
    expect((await runOnce()).liveness).toBe('needs_decision');
  });

  it('fails the run and schedules a backed-off retry for transient errors', async () => {
    runtime.queue.push({ error: { code: 'overloaded', family: 'transient_upstream', message: 'upstream busy' }, exitCode: 1 });
    h.services.wake!.enqueue(h.conductorId, { source: 'human_message', reason: 'go' });
    const run = await runOnce();
    expect(run.status).toBe('failed');
    expect(run.errorFamily).toBe('transient_upstream');
    expect(run.liveness).toBe('failed');
    const retry = h.db.get<Wakeup>("SELECT * FROM wakeups WHERE source = 'retry'")!;
    expect(retry.status).toBe('queued');
    expect(new Date(retry.notBefore!).getTime()).toBeGreaterThan(Date.now() + 20_000);
    expect(h.db.get<{ status: string }>('SELECT status FROM agents WHERE id = ?', [h.conductorId])!.status).toBe('active');
  });

  it('puts the agent in error after a non-retryable failure', async () => {
    runtime.queue.push({ error: { code: 'refused', family: 'model_refusal', message: 'refused' }, exitCode: 1 });
    h.services.wake!.enqueue(h.conductorId, { source: 'human_message', reason: 'go' });
    const run = await runOnce();
    expect(run.status).toBe('failed');
    expect(h.db.get<{ status: string }>('SELECT status FROM agents WHERE id = ?', [h.conductorId])!.status).toBe('error');
    expect(h.db.get<{ n: number }>("SELECT COUNT(*) n FROM wakeups WHERE source = 'retry'")!.n).toBe(0);
  });

  it('fails cleanly when the runtime is not registered', async () => {
    h.ctx.config.models = { ...h.ctx.config.models, weaver: { runtime: 'nope', model: null } };
    h.services.wake!.enqueue(h.conductorId, { source: 'human_message', reason: 'go' });
    const run = await runOnce();
    expect(run.status).toBe('failed');
    expect(run.errorFamily).toBe('tooling');
    expect(run.errorCode).toBe('runtime_unreachable');
  });

  it('redacts the run token from persisted events', async () => {
    class LeakyRuntime extends FakeRuntime {
      override async runTurn(input: TurnInput, sink: TurnSink): Promise<TurnResult> {
        sink.onEvent({ ts: nowIso(), type: 'assistant.text', payload: { text: `curl -H "Authorization: Bearer ${input.env.AC_RUN_TOKEN}"` } });
        return super.runTurn(input, sink);
      }
    }
    h.ctx.registries.runtimes.set('fake', new LeakyRuntime());
    h.services.wake!.enqueue(h.conductorId, { source: 'human_message', reason: 'go' });
    const run = await runOnce();
    const rows = h.db.all<{ payload: { text?: string } }>("SELECT payload_json FROM run_events WHERE run_id = ? AND type = 'assistant.text'", [run.id]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.payload.text).not.toContain('eyJ');
    expect(rows[0]!.payload.text).toContain('[redacted]');
  });

  // VS-92: a role's secrets in its workers' environment, from the store as well as the host.
  describe("a role's secrets", () => {
    /** Not a credential: a fixture, long enough for makeRedactor's 8-character floor. */
    const FAKE = 'cf-not-a-real-token-0000000000';

    const workerWithSecrets = (names: string[]): string => {
      h.db.update('roles', h.roleId, { secretsJson: names });
      const ticketId = seedTicket(h, { status: 'in_progress' });
      const workerId = h.addWorker(ticketId, { runtimeId: 'fake' });
      h.services.wake!.enqueue(workerId, { source: 'ticket_assigned', reason: 'TST-1' });
      return workerId;
    };

    it('takes the value from the workspace store when the daemon has no such variable', async () => {
      h.services.secrets!.put({ kind: 'human', id: 'victor' }, { name: 'CF_READONLY_TOKEN' }, FAKE);
      workerWithSecrets(['CF_READONLY_TOKEN']);
      await runOnce();
      expect(runtime.inputs[0]!.env.CF_READONLY_TOKEN).toBe(FAKE);
    });

    it('exposes it under the environment variable name the secret was registered with', async () => {
      h.services.secrets!.put({ kind: 'human', id: 'victor' }, { name: 'cloudflare-read', envVarName: 'CF_TOKEN' }, FAKE);
      workerWithSecrets(['cloudflare-read']);
      await runOnce();
      expect(runtime.inputs[0]!.env.CF_TOKEN).toBe(FAKE);
      expect(runtime.inputs[0]!.env['cloudflare-read']).toBeUndefined();
    });

    it("lets the daemon's own environment win over the store", async () => {
      h.services.secrets!.put({ kind: 'human', id: 'victor' }, { name: 'CF_READONLY_TOKEN' }, FAKE);
      process.env.CF_READONLY_TOKEN = 'from-the-host-0000000000';
      try {
        workerWithSecrets(['CF_READONLY_TOKEN']);
        await runOnce();
        expect(runtime.inputs[0]!.env.CF_READONLY_TOKEN).toBe('from-the-host-0000000000');
      } finally {
        delete process.env.CF_READONLY_TOKEN;
      }
    });

    it('omits a listed secret no one holds rather than passing it empty', async () => {
      workerWithSecrets(['NEVER_REGISTERED']);
      await runOnce();
      expect(runtime.inputs[0]!.env.NEVER_REGISTERED).toBeUndefined();
    });

    it('redacts the value from what the turn records', async () => {
      h.services.secrets!.put({ kind: 'human', id: 'victor' }, { name: 'CF_READONLY_TOKEN' }, FAKE);
      class LeakyRuntime extends FakeRuntime {
        override async runTurn(input: TurnInput, sink: TurnSink): Promise<TurnResult> {
          sink.onEvent({ ts: nowIso(), type: 'assistant.text', payload: { text: `curl -H "X-Auth: ${input.env.CF_READONLY_TOKEN}"` } });
          return super.runTurn(input, sink);
        }
      }
      h.ctx.registries.runtimes.set('fake', new LeakyRuntime());
      workerWithSecrets(['CF_READONLY_TOKEN']);
      const run = await runOnce();
      const rows = h.db.all<{ payload: { text?: string } }>("SELECT payload_json FROM run_events WHERE run_id = ? AND type = 'assistant.text'", [run.id]);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.payload.text).not.toContain(FAKE);
      expect(rows[0]!.payload.text).toContain('[redacted]');
    });
  });

  it('describes the worker ticket and worktree state in the turn prompt', async () => {
    const ticketId = seedTicket(h, { status: 'in_progress' });
    const workerId = h.addWorker(ticketId, { runtimeId: 'fake', worktreePath: null, branch: 'ac/tst-1-add-a-readme-badge' });
    h.services.wake!.enqueue(workerId, { source: 'ticket_assigned', reason: 'TST-1: Add a README badge' });
    const run = await runOnce();
    const prompt = readFileSync(join(h.ctx.paths.runs, run.id, 'prompt.md'), 'utf8');
    expect(prompt).toContain('## Your ticket');
    expect(prompt).toContain('TST-1 [in_progress] Add a README badge');
    expect(run.ticketId).toBe(ticketId);
    expect(h.db.get<{ executionRunId: string | null }>('SELECT execution_run_id FROM tickets WHERE id = ?', [ticketId])!.executionRunId).toBeNull();
  });

  describe('planning agent turn (VS-398)', () => {
    function seedPlanner(over: Record<string, unknown> = {}): string {
      const id = newId();
      const now = nowIso();
      h.db.insert('agents', {
        id, workspaceId: h.workspaceId, kind: 'planner', projectId: h.projectId, planId: null,
        name: 'Planner', runtimeId: 'fake', status: 'active', homePath: join(h.ctx.paths.workers, id),
        turnEpoch: 0, turnCount: 0, spawnedBy: 'human', briefRevision: 1, createdAt: now, updatedAt: now, ...over,
      });
      return id;
    }

    it('restricts every turn to the planner allowlist, mode restricted, no built-in write tool', async () => {
      const plannerId = seedPlanner();
      h.services.wake!.enqueue(plannerId, { source: 'human_message', reason: 'let’s plan the redesign' });
      runtime.queue.push({ structured: { state: 'working', summary: 'drafting', tickets: [], knowledge: { recorded: false, reason: 'test fixture' } } });
      await runOnce(plannerId);

      expect(runtime.inputs[0]!.permission.mode).toBe('restricted');
      expect(runtime.inputs[0]!.permission.allowedTools).toEqual(expect.arrayContaining(['Read', 'Grep', 'Glob', 'weave_plan_draft_add', 'weave_plan_reply']));
      for (const denied of ['Write', 'Edit', 'NotebookEdit', 'Bash', 'weave_ticket_create', 'weave_plan_submit']) {
        expect(runtime.inputs[0]!.permission.allowedTools).not.toContain(denied);
      }
    });

    it('keeps the same allowlist on a later turn, not only the first (unlike the interactive-session hold)', async () => {
      const plannerId = seedPlanner({ turnCount: 5 });
      h.services.wake!.enqueue(plannerId, { source: 'human_message', reason: 'one more thing' });
      runtime.queue.push({ structured: { state: 'working', summary: 'still drafting', tickets: [], knowledge: { recorded: false, reason: 'test fixture' } } });
      await runOnce(plannerId);

      expect(runtime.inputs[0]!.permission.allowedTools).toContain('weave_plan_draft_update');
      expect(runtime.inputs[0]!.permission.allowedTools).not.toContain('Write');
    });

    it('fails closed rather than run unrestricted when the runtime cannot enforce restricted mode', async () => {
      runtime.permissionModes = ['auto'];
      const plannerId = seedPlanner();
      h.services.wake!.enqueue(plannerId, { source: 'human_message', reason: 'hello' });
      const run = await runOnce(plannerId);

      expect(run.status).toBe('failed');
      expect(run.errorFamily).toBe('tooling');
      expect(run.errorCode).toBe('runtime_unreachable');
      expect(runtime.inputs).toHaveLength(0);
    });
  });

  describe('interactive session first-turn hold (VS-101)', () => {
    it('restricts the first turn to the read-and-report allowlist', async () => {
      const ticketId = seedTicket(h, { interactiveSession: true });
      const workerId = h.addWorker(ticketId, { runtimeId: 'fake', worktreePath: null });
      h.services.wake!.enqueue(workerId, { source: 'ticket_assigned', reason: 'TST-1' });
      runtime.queue.push({ structured: { state: 'working', summary: 'stated understanding', tickets: [], knowledge: { recorded: false, reason: 'test fixture' } } });
      await runOnce();

      // VS-462: the ticket's read tools and the one comment tool, and nothing that could read the
      // repository, run a command, or move the ticket.
      expect(runtime.inputs[0]!.permission.allowedTools).toEqual([
        'weave_inbox', 'weave_ticket_get', 'weave_ticket_comments', 'weave_ticket_comment', 'weave_ticket_document_get',
      ]);
      expect(runtime.inputs[0]!.permission.firstTurn).toBe(true);
    });

    it('lifts the restriction from the second turn on', async () => {
      const ticketId = seedTicket(h, { interactiveSession: true });
      const workerId = h.addWorker(ticketId, { runtimeId: 'fake', worktreePath: null });
      h.services.wake!.enqueue(workerId, { source: 'ticket_assigned', reason: 'TST-1' });
      runtime.queue.push({ structured: { state: 'working', summary: 'stated understanding', tickets: [], knowledge: { recorded: false, reason: 'test fixture' } } });
      await runOnce();

      h.services.wake!.enqueue(workerId, { source: 'conductor_request', reason: 'go ahead' });
      runtime.queue.push({ structured: { state: 'done', summary: 'did the work', tickets: [], knowledge: { recorded: false, reason: 'test fixture' } } });
      await runOnce();

      expect(runtime.inputs).toHaveLength(2);
      expect(runtime.inputs[1]!.permission.allowedTools).toBeUndefined();
      expect(runtime.inputs[1]!.permission.firstTurn).toBeUndefined();
    });

    it('does not restrict an ordinary (non-session) ticket\'s first turn', async () => {
      const ticketId = seedTicket(h);
      const workerId = h.addWorker(ticketId, { runtimeId: 'fake', worktreePath: null });
      h.services.wake!.enqueue(workerId, { source: 'ticket_assigned', reason: 'TST-1' });
      runtime.queue.push({ structured: { state: 'working', summary: 'started', tickets: [], knowledge: { recorded: false, reason: 'test fixture' } } });
      await runOnce();

      expect(runtime.inputs[0]!.permission.allowedTools).toBeUndefined();
    });

    it('never widens beyond a role that already denies one of the allowlisted tools', async () => {
      h.db.update('roles', h.roleId, { permissionJson: { mode: 'auto', denied: ['weave_ticket_comment'] } });
      const ticketId = seedTicket(h, { interactiveSession: true });
      const workerId = h.addWorker(ticketId, { runtimeId: 'fake', worktreePath: null });
      h.services.wake!.enqueue(workerId, { source: 'ticket_assigned', reason: 'TST-1' });
      runtime.queue.push({ structured: { state: 'working', summary: 'stated understanding', tickets: [], knowledge: { recorded: false, reason: 'test fixture' } } });
      await runOnce();

      expect(runtime.inputs[0]!.permission.allowedTools).not.toContain('weave_ticket_comment');
      expect(runtime.inputs[0]!.permission.deniedTools).toEqual(['weave_ticket_comment']);
    });
  });

  describe('conductor permission bypass (VS-171)', () => {
    it('a conductor turn is bypass even when workspace default is auto', async () => {
      expect(h.ctx.config.defaults.permissionMode).toBe('auto');
      h.services.wake!.enqueue(h.conductorId, { source: 'human_message', reason: 'hello' });
      runtime.queue.push({ structured: { state: 'idle', summary: 'ok', tickets: [], knowledge: { recorded: false, reason: 'test fixture' } } });
      await runOnce();
      expect(runtime.inputs[0]!.permission.mode).toBe('bypass');
    });

    it('a weave role set to auto is still bypass', async () => {
      h.db.update('roles', h.roleId, { permissionJson: { mode: 'auto' } });
      h.db.update('agents', h.conductorId, { roleId: h.roleId });
      h.services.wake!.enqueue(h.conductorId, { source: 'human_message', reason: 'hello' });
      runtime.queue.push({ structured: { state: 'idle', summary: 'ok', tickets: [], knowledge: { recorded: false, reason: 'test fixture' } } });
      await runOnce();
      expect(runtime.inputs[0]!.permission.mode).toBe('bypass');
    });

    it('a worker with workspace default auto and no role mode stays auto', async () => {
      const ticketId = seedTicket(h);
      const workerId = h.addWorker(ticketId, { runtimeId: 'fake', worktreePath: null });
      h.services.wake!.enqueue(workerId, { source: 'ticket_assigned', reason: 'TST-1' });
      runtime.queue.push({ structured: { state: 'working', summary: 'started', tickets: [], knowledge: { recorded: false, reason: 'test fixture' } } });
      await runOnce();
      expect(runtime.inputs[0]!.permission.mode).toBe('auto');
    });

    it('a worker role bypass still applies', async () => {
      h.db.update('roles', h.roleId, { permissionJson: { mode: 'bypass' } });
      const ticketId = seedTicket(h);
      const workerId = h.addWorker(ticketId, { runtimeId: 'fake', worktreePath: null });
      h.services.wake!.enqueue(workerId, { source: 'ticket_assigned', reason: 'TST-1' });
      runtime.queue.push({ structured: { state: 'working', summary: 'started', tickets: [], knowledge: { recorded: false, reason: 'test fixture' } } });
      await runOnce();
      expect(runtime.inputs[0]!.permission.mode).toBe('bypass');
    });

    it('a worker role restricted still applies', async () => {
      h.db.update('roles', h.roleId, { permissionJson: { mode: 'restricted' } });
      const ticketId = seedTicket(h);
      const workerId = h.addWorker(ticketId, { runtimeId: 'fake', worktreePath: null });
      h.services.wake!.enqueue(workerId, { source: 'ticket_assigned', reason: 'TST-1' });
      runtime.queue.push({ structured: { state: 'working', summary: 'started', tickets: [], knowledge: { recorded: false, reason: 'test fixture' } } });
      await runOnce();
      expect(runtime.inputs[0]!.permission.mode).toBe('restricted');
    });
  });

  describe('the runtime\'s own scheduler tools are denied on worker turns (VS-317)', () => {
    it('adds the adapter-declared tools to a worker turn, preserving the role\'s own denials', async () => {
      runtime.workerDeniedTools = ['ScheduleWakeup', 'CronCreate', 'CronList', 'CronDelete'];
      h.db.update('roles', h.roleId, { permissionJson: { denied: ['WebFetch'] } });
      const ticketId = seedTicket(h);
      const workerId = h.addWorker(ticketId, { runtimeId: 'fake', worktreePath: null });
      h.services.wake!.enqueue(workerId, { source: 'ticket_assigned', reason: 'TST-1' });
      runtime.queue.push({ structured: { state: 'working', summary: 'started', tickets: [], knowledge: { recorded: false, reason: 'test fixture' } } });
      await runOnce();
      expect(runtime.inputs[0]!.permission.deniedTools).toEqual(expect.arrayContaining(['WebFetch', 'ScheduleWakeup', 'CronCreate', 'CronList', 'CronDelete']));
    });

    it('leaves the weaver\'s turn alone', async () => {
      runtime.workerDeniedTools = ['ScheduleWakeup', 'CronCreate', 'CronList', 'CronDelete'];
      h.services.wake!.enqueue(h.conductorId, { source: 'human_message', reason: 'hello' });
      runtime.queue.push({ structured: { state: 'idle', summary: 'ok', tickets: [], knowledge: { recorded: false, reason: 'test fixture' } } });
      await runOnce();
      expect(runtime.inputs[0]!.permission.deniedTools ?? []).not.toContain('ScheduleWakeup');
    });
  });

  it('carries the runtime’s live-input handle onto the active run, and clears it at finalize (VS-99)', async () => {
    runtime.streamingInput = true;
    runtime.delayMs = 30;
    const runId = newId();
    h.db.insert('runs', {
      id: runId, workspaceId: h.workspaceId, agentId: h.conductorId, wakeupIdsJson: [], runtimeId: 'fake',
      status: 'queued', turnEpoch: 1, cwd: h.ctx.paths.weaver, createdAt: nowIso(),
    });
    const handleReady = runtime.nextHandle();
    const done = executeRun(h.ctx, h.deps, runId);
    const handle = await Promise.race([
      handleReady,
      done.then((run) => {
        throw new Error(
          `executeRun finished without a live-input handle; status=${run.status} errorFamily=${run.errorFamily} errorCode=${run.errorCode}`,
        );
      }),
    ]);
    expect(handle?.send).toBeTypeOf('function');
    const midFlight = runState(h.ctx).active.get(runId);
    await expect(midFlight!.send!('hello')).resolves.toBe('delivered');
    expect(runtime.sentInputs).toEqual(['hello']);

    await done;
    expect(runState(h.ctx).active.get(runId)).toBeUndefined();
  });

  it('can execute a run directly for a bare agent', async () => {
    const runId = newId();
    h.db.insert('runs', {
      id: runId, workspaceId: h.workspaceId, agentId: h.conductorId, wakeupIdsJson: [], runtimeId: 'fake',
      status: 'queued', turnEpoch: 7, cwd: h.ctx.paths.weaver, createdAt: nowIso(),
    });
    const run = await executeRun(h.ctx, h.deps, runId);
    expect(run.status).toBe('succeeded');
    expect(run.turnEpoch).toBe(7);
  });

  describe('interrupted by a live human message (VS-254)', () => {
    // A run's `cancelled` cause is set by `runs.cancel(actor, id, 'interrupt', cause)` — pre-seeding
    // it here on the in-memory active-run map, before `executeRun`, is exactly what that call does,
    // without needing a real streaming turn to interrupt mid-flight.
    function seedRunning(agentId: string, cancelled: { mode: 'interrupt' | 'kill'; cause?: 'message' }): string {
      const runId = newId();
      h.db.insert('runs', {
        id: runId, workspaceId: h.workspaceId, agentId, wakeupIdsJson: [], runtimeId: 'fake',
        status: 'queued', turnEpoch: 1, cwd: h.ctx.paths.weaver, createdAt: nowIso(),
      });
      runState(h.ctx).active.set(runId, { runId, agentId, startedAt: Date.now(), pid: null, cancel: async () => undefined, cancelled });
      return runId;
    }

    it("a run interrupted for a human's live message finalizes as interrupted with a distinguishing errorCode", async () => {
      const runId = seedRunning(h.conductorId, { mode: 'interrupt', cause: 'message' });
      const run = await executeRun(h.ctx, h.deps, runId);
      expect(run.status).toBe('interrupted');
      expect(run.errorCode).toBe('interrupted_by_message');
      expect(run.errorFamily).toBe('tooling');
    });

    it('a run interrupted with no cause (daemon shutdown, `/runs/:id/cancel`) still finalizes as plain `interrupted`, unchanged', async () => {
      const runId = seedRunning(h.conductorId, { mode: 'interrupt' });
      const run = await executeRun(h.ctx, h.deps, runId);
      expect(run.status).toBe('interrupted');
      expect(run.errorCode).toBe('interrupted');
      expect(run.errorFamily).toBe('tooling');
    });

    it('a run killed (not interrupted) is recorded as `cancelled`, not `interrupted`, with or without a cause', async () => {
      const runId = seedRunning(h.conductorId, { mode: 'kill' });
      const run = await executeRun(h.ctx, h.deps, runId);
      expect(run.status).toBe('cancelled');
      expect(run.errorCode).toBe('cancelled');
    });

    it('a worker whose turn finalizes `interrupted_by_message` stays dispatchable: its next wake still starts a run', async () => {
      const ticketId = seedTicket(h);
      const workerId = h.addWorker(ticketId, { runtimeId: 'fake', worktreePath: null });
      const runId = seedRunning(workerId, { mode: 'interrupt', cause: 'message' });
      const run = await executeRun(h.ctx, h.deps, runId);
      expect(run.status).toBe('interrupted');
      const agent = h.db.get<{ status: string }>('SELECT status FROM agents WHERE id = ?', [workerId])!;
      expect(['active', 'error']).toContain(agent.status); // IDLE_AGENT_STATUSES — never parked, never a retry-ladder park
      const openDecisions = h.db.all('SELECT id FROM decisions WHERE ticket_id = ? AND status = ?', [ticketId, 'open']);
      expect(openDecisions).toHaveLength(0); // no parkForHuman card was raised for this

      runtime.queue.push({ structured: { state: 'working', summary: 'resumed', tickets: [], knowledge: { recorded: false, reason: 'test fixture' } } });
      h.services.wake!.enqueue(workerId, { source: 'live_interrupt', reason: 'stop, wrong direction', payload: { ticketId, message: 'stop, wrong direction', interruptedRunId: runId } });
      const resumed = await runOnce(workerId);
      expect(resumed.id).not.toBe(runId);
      expect(resumed.status).toBe('succeeded');
    });
  });

  // VS-339: a turn cut off by a daemon shutdown is interrupted whatever the child's exit code says,
  // and its wake is left queued to resume. The mark is what the daemon sets synchronously before any
  // child can be signalled; here it is set directly, with the run already executing.
  describe('cut off by a daemon shutdown (VS-339)', () => {
    const markShutdown = () => { runState(h.ctx).shuttingDown = { reason: 'SIGTERM', at: nowIso() }; };
    /** A queued run whose wake is already bound to it, ready for `executeRun` as if dispatched. */
    function seedRunWithWake(agentId: string): { runId: string; wakeId: string } {
      const wake = h.services.wake!.enqueue(agentId, { source: 'human_message', reason: 'go' });
      const runId = newId();
      h.db.insert('runs', {
        id: runId, workspaceId: h.workspaceId, agentId, wakeupIdsJson: [wake.id], runtimeId: 'fake',
        status: 'queued', turnEpoch: 1, cwd: h.ctx.paths.weaver, createdAt: nowIso(),
      });
      h.db.update('wakeups', wake.id, { status: 'claimed', runId });
      return { runId, wakeId: wake.id };
    }

    it('a SIGTERM exit carrying a runtime error is interrupted_by_shutdown', async () => {
      const { runId } = seedRunWithWake(h.conductorId);
      markShutdown();
      runtime.queue.push({ exitCode: 143, error: { code: 'exit_143', family: 'unknown', message: 'terminated' } });
      const run = await executeRun(h.ctx, h.deps, runId);
      expect(run.status).toBe('interrupted');
      expect(run.errorCode).toBe('interrupted_by_shutdown');
      expect(run.errorFamily).toBe('tooling');
    });

    it('an exit 1 during shutdown is interrupted_by_shutdown', async () => {
      const { runId } = seedRunWithWake(h.conductorId);
      markShutdown();
      runtime.queue.push({ exitCode: 1, error: { code: 'exit_1', family: 'unknown', message: 'parent terminated' } });
      const run = await executeRun(h.ctx, h.deps, runId);
      expect(run.status).toBe('interrupted');
      expect(run.errorCode).toBe('interrupted_by_shutdown');
    });

    it('the same result without the mark stays a genuine failure', async () => {
      const { runId } = seedRunWithWake(h.conductorId);
      runtime.queue.push({ exitCode: 143, error: { code: 'exit_143', family: 'unknown', message: 'crashed' } });
      const run = await executeRun(h.ctx, h.deps, runId);
      expect(run.status).toBe('failed');
      expect(run.errorCode).toBe('exit_143');
    });

    it('leaves the interrupted turn wake queued and the worker active, with no retry card', async () => {
      const ticketId = seedTicket(h);
      const workerId = h.addWorker(ticketId, { runtimeId: 'fake', worktreePath: null });
      const { runId, wakeId } = seedRunWithWake(workerId);
      markShutdown();
      runtime.queue.push({ exitCode: 1, error: { code: 'exit_1', family: 'unknown', message: 'parent terminated' } });
      const run = await executeRun(h.ctx, h.deps, runId);
      expect(run.status).toBe('interrupted');
      const wake = h.db.get<Wakeup>('SELECT * FROM wakeups WHERE id = ?', [wakeId])!;
      expect(wake.status).toBe('queued');
      expect(wake.runId).toBeNull();
      expect(h.db.get<{ status: string }>('SELECT status FROM agents WHERE id = ?', [workerId])!.status).toBe('active');
      expect(h.db.all("SELECT id FROM decisions WHERE ticket_id = ? AND status = 'open'", [ticketId])).toHaveLength(0);
    });

    it('a worker interrupted by shutdown dispatches normally again afterwards', async () => {
      const ticketId = seedTicket(h);
      const workerId = h.addWorker(ticketId, { runtimeId: 'fake', worktreePath: null });
      const { runId } = seedRunWithWake(workerId);
      markShutdown();
      runtime.queue.push({ exitCode: 1, error: { code: 'exit_1', family: 'unknown', message: 'parent terminated' } });
      await executeRun(h.ctx, h.deps, runId);
      // A restart starts the dispatcher again; the mark is cleared and the queued wake runs.
      dispatcher.start();
      runtime.queue.push({ structured: { state: 'working', summary: 'resumed', tickets: [], knowledge: { recorded: false, reason: 'test fixture' } } });
      const resumed = await runOnce(workerId);
      expect(resumed.status).toBe('succeeded');
    });

    it('dispatcher.start() clears the shutdown mark a drain set', () => {
      const d = createDispatcher(h.ctx, h.deps);
      d.beginShutdown('drain');
      expect(runState(h.ctx).shuttingDown).not.toBeNull();
      d.start();
      expect(runState(h.ctx).shuttingDown).toBeNull();
      d.stop();
    });
  });

  // VS-77: a turn's runtime, model and effort come from the workspace's two model settings, and
  // from nothing else. These are the tests that keep the old fallback chain from growing back.
  describe('resolving what a turn runs on', () => {
    /** A second adapter, so "the other runtime" is a real registration rather than a missing one. */
    let other: FakeRuntime;
    beforeEach(() => { other = new FakeRuntime(); h.ctx.registries.runtimes.set('other', other); });

    it('launches the conductor on the conductor setting', async () => {
      h.ctx.config.models.weaver = { runtime: 'fake', model: 'claude-fable-5-1', effort: 'low' };
      h.services.wake!.enqueue(h.conductorId, { source: 'human_message', reason: 'go' });
      await runOnce();
      expect(runtime.inputs.at(-1)).toMatchObject({ model: 'claude-fable-5-1', effort: 'low' });
    });

    it('launches a worker on the workers setting', async () => {
      h.ctx.config.models.workers = { runtime: 'fake', model: 'claude-opus-5', effort: 'high' };
      const ticketId = seedTicket(h);
      const workerId = h.addWorker(ticketId, { worktreePath: null });
      h.services.wake!.enqueue(workerId, { source: 'ticket_assigned', reason: 'TST-1' });
      await runOnce();
      expect(runtime.inputs.at(-1)).toMatchObject({ model: 'claude-opus-5', effort: 'high' });
    });

    it('launches on a filled daemon overlay when the workspace has not configured that control (VS-284)', async () => {
      // The outer beforeEach configures both workspace settings as this suite's baseline; clear
      // them so this test can exercise the "workspace unconfigured" case.
      h.ctx.config.models = { workerOptions: [] };
      h.ctx.daemon.models = {
        workers: { runtime: 'fake', model: 'daemon-workers' },
        weaver: { runtime: 'fake', model: 'daemon-conductor' },
      };
      h.services.wake!.enqueue(h.conductorId, { source: 'human_message', reason: 'go' });
      await runOnce();
      expect(runtime.inputs.at(-1)).toMatchObject({ model: 'daemon-conductor' });
      const ticketId = seedTicket(h);
      const workerId = h.addWorker(ticketId, { worktreePath: null });
      h.services.wake!.enqueue(workerId, { source: 'ticket_assigned', reason: 'TST-1' });
      await runOnce();
      expect(runtime.inputs.at(-1)).toMatchObject({ model: 'daemon-workers' });
    });

    it('launches on the workspace\'s own setting even when a daemon overlay is also filled (VS-284)', async () => {
      h.ctx.config.models.workers = { runtime: 'fake', model: 'workspace-workers' };
      h.ctx.config.models.weaver = { runtime: 'fake', model: 'workspace-conductor' };
      h.ctx.daemon.models = {
        workers: { runtime: 'fake', model: 'daemon-workers' },
        weaver: { runtime: 'fake', model: 'daemon-conductor' },
      };
      h.services.wake!.enqueue(h.conductorId, { source: 'human_message', reason: 'go' });
      await runOnce();
      expect(runtime.inputs.at(-1)).toMatchObject({ model: 'workspace-conductor' });
      const ticketId = seedTicket(h);
      const workerId = h.addWorker(ticketId, { worktreePath: null });
      h.services.wake!.enqueue(workerId, { source: 'ticket_assigned', reason: 'TST-1' });
      await runOnce();
      expect(runtime.inputs.at(-1)).toMatchObject({ model: 'workspace-workers' });
    });

    it('launches a worker on its ticket\'s catalog option (VS-162)', async () => {
      h.ctx.config.models.workers = { runtime: 'fake', model: 'the-default' };
      h.ctx.config.models.workerOptions = [
        { id: 'cheap', description: 'Scouts.', runtime: 'other', model: 'the-option-model' },
      ];
      const ticketId = seedTicket(h, { workerModelId: 'cheap' });
      const workerId = h.addWorker(ticketId, { worktreePath: null });
      h.services.wake!.enqueue(workerId, { source: 'ticket_assigned', reason: 'TST-1' });
      await runOnce();
      expect(runtime.inputs).toHaveLength(0);
      expect(other.inputs.at(-1)).toMatchObject({ model: 'the-option-model' });
    });

    it('refuses an unconfigured catalog option and starts no runtime (VS-236)', async () => {
      h.ctx.config.models.workers = { runtime: 'fake', model: 'the-default' };
      h.ctx.config.models.workerOptions = [
        { id: 'deep', description: 'Cause unknown.', runtime: null, model: null },
      ];
      const ticketId = seedTicket(h, { workerModelId: 'deep' });
      const workerId = h.addWorker(ticketId, { worktreePath: null });
      h.services.wake!.enqueue(workerId, { source: 'ticket_assigned', reason: 'TST-1' });
      const run = await runOnce();
      expect(run.status).toBe('failed');
      expect(run.errorCode).toBe('model_unconfigured');
      expect(run.errorFamily).toBe('tooling');
      expect(runtime.inputs).toHaveLength(0);
      expect(other.inputs).toHaveLength(0);
    });

    it('sends the two kinds to their own settings in the same workspace', async () => {
      h.ctx.config.models = {
        weaver: { runtime: 'fake', model: 'the-conductor-model' },
        workers: { runtime: 'other', model: 'the-worker-model' },
        workerOptions: [],
      };
      const ticketId = seedTicket(h);
      const workerId = h.addWorker(ticketId, { worktreePath: null });
      h.services.wake!.enqueue(h.conductorId, { source: 'human_message', reason: 'go' });
      await runOnce();
      h.services.wake!.enqueue(workerId, { source: 'ticket_assigned', reason: 'TST-1' });
      await runOnce();

      expect(runtime.inputs.at(-1)!.model).toBe('the-conductor-model');
      expect(other.inputs.at(-1)!.model).toBe('the-worker-model');
    });

    it('lets no role, project or agent row influence the choice', async () => {
      h.ctx.config.models.workers = { runtime: 'fake', model: 'the-setting-model', effort: 'high' };
      const ticketId = seedTicket(h);
      // Everything the old chain read, pointed somewhere else, written straight to the rows.
      const workerId = h.addWorker(ticketId, { runtimeId: 'other', worktreePath: null });
      h.services.wake!.enqueue(workerId, { source: 'ticket_assigned', reason: 'TST-1' });
      await runOnce();

      expect(other.inputs).toHaveLength(0);
      expect(runtime.inputs.at(-1)).toMatchObject({ model: 'the-setting-model', effort: 'high' });
      // And the row is corrected to what it really ran on, rather than left disagreeing.
      expect(h.db.get<{ runtimeId: string }>('SELECT runtime_id FROM agents WHERE id = ?', [workerId])!.runtimeId).toBe('fake');
    });

    it('changes what the next turn launches with when the setting changes', async () => {
      h.services.wake!.enqueue(h.conductorId, { source: 'human_message', reason: 'first' });
      await runOnce();
      expect(runtime.inputs.at(-1)!.model).toBeNull();

      h.ctx.config.models.weaver = { runtime: 'other', model: 'the-new-model' };
      h.services.wake!.enqueue(h.conductorId, { source: 'human_message', reason: 'second' });
      const second = await runOnce();

      expect(other.inputs.at(-1)!.model).toBe('the-new-model');
      expect(second.runtimeId).toBe('other');
    });

    it('records on the run what it really ran on, and leaves it there when the setting moves on', async () => {
      h.ctx.config.models.weaver = { runtime: 'fake', model: 'the-model-it-ran-on' };
      h.services.wake!.enqueue(h.conductorId, { source: 'human_message', reason: 'go' });
      const run = await runOnce();
      expect(run.runtimeId).toBe('fake');

      h.ctx.config.models.weaver = { runtime: 'other', model: 'something-else' };
      const stored = h.db.get<Run>('SELECT * FROM runs WHERE id = ?', [run.id])!;
      expect(stored.runtimeId).toBe('fake');
      // The adapter reported `fake-1`, and what the runtime says beats what the setting asked for.
      expect(stored.model).toBe('fake-1');
    });

    it('fails the turn naming the runtime the setting points at, rather than using another', async () => {
      h.ctx.config.models.weaver = { runtime: 'nope', model: null };
      h.services.wake!.enqueue(h.conductorId, { source: 'human_message', reason: 'go' });
      const run = await runOnce();
      expect(run.status).toBe('failed');
      expect(run.errorCode).toBe('runtime_unreachable');
      expect(other.inputs).toHaveLength(0);
    });

    it('retires a session the old runtime issued rather than handing its handle to the new one', async () => {
      h.services.wake!.enqueue(h.conductorId, { source: 'human_message', reason: 'first' });
      await runOnce();
      const first = h.db.get<{ id: string; runtimeId: string }>("SELECT id, runtime_id FROM agent_sessions WHERE agent_id = ? AND status = 'active'", [h.conductorId])!;
      expect(first.runtimeId).toBe('fake');

      h.ctx.config.models.weaver = { runtime: 'other', model: null };
      h.services.wake!.enqueue(h.conductorId, { source: 'human_message', reason: 'second' });
      await runOnce();

      // Nothing from the old CLI is passed to the new one, and the turn is told it started over.
      expect(other.inputs.at(-1)!.session.ref).toBeNull();
      expect(other.inputs.at(-1)!.session.isFirstTurn).toBe(true);
      const now = h.db.get<{ id: string; runtimeId: string }>("SELECT id, runtime_id FROM agent_sessions WHERE agent_id = ? AND status = 'active'", [h.conductorId])!;
      expect(now.id).not.toBe(first.id);
      expect(now.runtimeId).toBe('other');
      expect(h.db.get<{ status: string }>('SELECT status FROM agent_sessions WHERE id = ?', [first.id])!.status).toBe('stale');
    });

    it('keeps the session when only the model changes', async () => {
      h.services.wake!.enqueue(h.conductorId, { source: 'human_message', reason: 'first' });
      await runOnce();
      const before = h.db.get<{ id: string }>("SELECT id FROM agent_sessions WHERE agent_id = ? AND status = 'active'", [h.conductorId])!;

      h.ctx.config.models.weaver = { runtime: 'fake', model: 'a-different-model' };
      h.services.wake!.enqueue(h.conductorId, { source: 'human_message', reason: 'second' });
      await runOnce();

      expect(runtime.inputs.at(-1)!.session.ref).not.toBeNull();
      expect(h.db.get<{ id: string }>("SELECT id FROM agent_sessions WHERE agent_id = ? AND status = 'active'", [h.conductorId])!.id).toBe(before.id);
    });
  });

  // The dispatcher records, on the run it opens, which run it is retrying — the one writer of
  // runs.retry_of_run_id. Without it `countRetries` reads zero forever and the ladder never ends.
  describe('the retry link', () => {
    it('records the run a retry wake names, and nothing for an ordinary wake', async () => {
      runtime.queue.push({ structured: { state: 'working', summary: 'first', tickets: [], knowledge: { recorded: false, reason: 'test fixture' } } });
      h.services.wake!.enqueue(h.conductorId, { source: 'human_message', reason: 'go' });
      const first = await runOnce();
      expect(first.retryOfRunId).toBeNull();

      runtime.queue.push({ structured: { state: 'working', summary: 'second', tickets: [], knowledge: { recorded: false, reason: 'test fixture' } } });
      h.services.wake!.enqueue(h.conductorId, { source: 'retry', reason: 'retry after overloaded', payload: { retryOfRunId: first.id } });
      expect((await runOnce()).retryOfRunId).toBe(first.id);
    });

    // A retry enqueued while an ordinary wake is already queued is coalesced into it and its payload
    // ends up in that wake's `bundle`; the link has to survive that.
    it('records the link when the retry wake is coalesced into an ordinary one', async () => {
      runtime.queue.push({ structured: { state: 'working', summary: 'first', tickets: [], knowledge: { recorded: false, reason: 'test fixture' } } });
      h.services.wake!.enqueue(h.conductorId, { source: 'human_message', reason: 'go' });
      const first = await runOnce();

      runtime.queue.push({ structured: { state: 'working', summary: 'second', tickets: [], knowledge: { recorded: false, reason: 'test fixture' } } });
      h.services.wake!.enqueue(h.conductorId, { source: 'human_message', reason: 'and also this' });
      const coalesced = h.services.wake!.enqueue(h.conductorId, { source: 'retry', reason: 'retry after overloaded', payload: { retryOfRunId: first.id } });
      expect(coalesced.status).toBe('coalesced');
      expect((await runOnce()).retryOfRunId).toBe(first.id);
    });

    it('counts a chain of three, and terminates on a cycle', () => {
      let previous: string | null = null;
      for (const id of ['r1', 'r2', 'r3', 'r4']) {
        h.db.insert('runs', {
          id, workspaceId: h.workspaceId, agentId: h.conductorId, wakeupIdsJson: [], runtimeId: 'fake',
          status: 'failed', turnEpoch: 0, cwd: '/tmp', retryOfRunId: previous, createdAt: nowIso(),
        });
        previous = id;
      }
      expect(countRetries(h.ctx, 'r4')).toBe(3);
      expect(countRetries(h.ctx, 'r1')).toBe(0);

      h.db.update('runs', 'r1', { retryOfRunId: 'r4' });
      expect(countRetries(h.ctx, 'r4')).toBe(10);
    });
  });

  // A worker whose automatic retries are spent, or whose failure is not retryable at all, is parked
  // and the choice is put to the human as a retry_approval decision. That decision could not be
  // stored at all until VS-49 widened the kind CHECK, so the human never saw the card; these pin the
  // whole path, storage included.
  describe('parking a stuck worker for the human', () => {
    beforeEach(() => {
      h.services.knowledge = { appendDecision: vi.fn() } as never;
      h.services.roles = { activate: vi.fn(async () => ({ id: 'role' })) } as never;
      h.services.openspec = {
        validateForProposed: vi.fn(async () => ({ ok: true as const, plan: '# Plan' })),
        archiveAfterMerge: vi.fn(async () => ({ archivedAs: null, skipped: null })),
      } as never;
      h.services.tickets = createTicketsService(h.ctx, h.deps);
      h.services.decisions = createDecisionsService(h.ctx, h.deps);
      // A second runtime, so the card's "retry on another runtime" options have something to name.
      h.ctx.registries.runtimes.set('other', new FakeRuntime());
    });

    /** Collect what the run logger records at error, leaving the real logger otherwise intact. */
    function captureErrors(): Array<Record<string, unknown>> {
      const errors: Array<Record<string, unknown>> = [];
      const real = h.ctx.log;
      const wrap = (l: ReturnType<typeof real>): ReturnType<typeof real> => new Proxy(l, {
        get: (t, k) => {
          if (k === 'error') return (o: Record<string, unknown>) => { errors.push(o); };
          if (k === 'child') return (b: Record<string, unknown>) => wrap(t.child(b));
          const v = Reflect.get(t, k) as unknown;
          return typeof v === 'function' ? v.bind(t) : v;
        },
      });
      h.ctx.log = ((domain: Parameters<typeof real>[0]) => wrap(real(domain))) as typeof real;
      return errors;
    }

    /** A worker mid-ticket, woken once, whose turn fails the way `result` says. */
    async function failOnce(result: Record<string, unknown> | ((input: TurnInput) => Record<string, unknown>), n = 1, ticketOver: Record<string, unknown> = {}): Promise<{ ticketId: string; workerId: string }> {
      const ticketId = seedTicket(h, { status: 'in_progress', number: n, identifier: `TST-${n}`, ...ticketOver });
      const workerId = h.addWorker(ticketId, { runtimeId: 'fake', worktreePath: null });
      runtime.queue.push(resultFor(workerId, result as never));
      h.services.wake!.enqueue(workerId, { source: 'ticket_assigned', reason: 'TST-1: Add a README badge' });
      await runOnce(workerId);
      await tick();
      return { ticketId, workerId };
    }

    const openFor = (ticketId: string): Decision[] => h.services.decisions!.list({ status: ['open'], ticketId });

    // VS-75: an authentication failure is a fact about the runtime's one shared credential, not
    // about this worker. It leaves the ladder entirely — no retry, no per-worker card, no blocked
    // ticket — and gates the runtime once instead. The outage of 2026-09-07 produced three retry
    // cards for one expired login; these pin that it cannot happen again.
    describe('an authentication failure gates the runtime instead', () => {
      let notified: string[];

      beforeEach(() => {
        notified = [];
        h.services.accounts = createAccountsService(h.ctx);
        h.services.threads = { notifyHuman: async (_a: unknown, m: { text: string }) => { notified.push(m.text); } } as never;
      });

      const failAuth = (n = 1) => failOnce({ error: { code: 'oauth_expired', family: 'auth', message: 'OAuth session expired and could not be refreshed' } }, n);

      it('schedules no retry at all', async () => {
        const { workerId } = await failAuth();
        const wakes = h.db.all<Wakeup>("SELECT * FROM wakeups WHERE agent_id = ? AND source = 'retry'", [workerId]);
        expect(wakes).toHaveLength(0);
        const run = h.db.get<{ scheduledRetryAt: string | null }>('SELECT scheduled_retry_at FROM runs ORDER BY created_at DESC LIMIT 1')!;
        expect(run.scheduledRetryAt).toBeNull();
      });

      it('raises no per-worker retry card and does not block the ticket', async () => {
        const { ticketId } = await failAuth();
        expect(openFor(ticketId).filter((d) => d.kind === 'retry_approval')).toHaveLength(0);
        expect(h.db.get<{ status: string }>('SELECT status FROM tickets WHERE id = ?', [ticketId])!.status).toBe('in_progress');
      });

      it('gates the runtime, pauses the worker with the login reason and tells the human', async () => {
        const { workerId } = await failAuth();
        expect(h.services.accounts!.gatedRuntimes()).toEqual(['fake']);
        const agent = h.db.get<{ status: string; pauseDetail: { code?: string } | null }>('SELECT * FROM agents WHERE id = ?', [workerId])!;
        expect(agent.status).toBe('paused');
        expect(agent.pauseDetail?.code).toBe(LOGIN_PAUSE_CODE);
        expect(notified).toHaveLength(1);
      });

      it('raises one card however many workers fail', async () => {
        await failAuth(1);
        // The dispatcher will not start a second turn on a gated runtime; a worker already
        // in flight (or started directly) is the only way a second auth failure meets the gate.
        const ticketId = seedTicket(h, { status: 'in_progress', number: 2, identifier: 'TST-2' });
        const workerId = h.addWorker(ticketId, { runtimeId: 'fake', worktreePath: null });
        const runId = newId();
        h.db.insert('runs', {
          id: runId, workspaceId: h.workspaceId, agentId: workerId, ticketId, wakeupIdsJson: [],
          runtimeId: 'fake', model: null, status: 'queued', turnEpoch: 1,
          cwd: h.db.get<{ homePath: string }>('SELECT home_path FROM agents WHERE id = ?', [workerId])!.homePath,
          createdAt: nowIso(),
        });
        runtime.queue.push({ error: { code: 'oauth_expired', family: 'auth', message: 'OAuth session expired and could not be refreshed' } } as never);
        await executeRun(h.ctx, h.deps, runId);
        const open = h.services.decisions!.list({ status: ['open'] }).filter((d) => d.correlationKey === loginCorrelationKey('fake'));
        expect(open).toHaveLength(1);
        expect(notified).toHaveLength(1);
      });

      // There is only one credential; there is nothing to restore over it, and the owner may have
      // renewed it since this turn failed. The old code force-copied here and could overwrite a
      // working credential with a dead one — that was the outage.
      it('does not write the credential file', async () => {
        const home = join(h.ctx.paths.runtimesHome, 'fake');
        mkdirSync(home, { recursive: true });
        const path = join(home, '.credentials.json');
        writeFileSync(path, '{"renewed":true}');
        const before = statSync(path).mtimeMs;

        await failAuth();

        expect(readFileSync(path, 'utf8')).toBe('{"renewed":true}');
        expect(statSync(path).mtimeMs).toBe(before);
      });

      // A turn already in flight when another agent gates the runtime proves the credential works,
      // so it clears the gate rather than leaving the workspace stopped behind a stale one. The
      // dispatcher will not *start* a turn on a gated runtime, so this is the only way the two meet.
      it('clears a gate raised while a turn was already in flight', async () => {
        const { workerId } = await failAuth();
        expect(h.services.accounts!.gatedRuntimes()).toEqual(['fake']);

        h.db.update('agents', workerId, { status: 'active', pauseReason: null, pauseDetailJson: null, updatedAt: nowIso() });
        const runId = newId();
        h.db.insert('runs', {
          id: runId, workspaceId: h.workspaceId, agentId: workerId, ticketId: null, wakeupIdsJson: [],
          runtimeId: 'fake', model: null, status: 'queued', turnEpoch: 1,
          cwd: h.db.get<{ homePath: string }>('SELECT home_path FROM agents WHERE id = ?', [workerId])!.homePath,
          createdAt: nowIso(),
        });
        runtime.queue.push({ structured: { state: 'working', summary: 'back', tickets: [], knowledge: { recorded: false, reason: 'test fixture' } } } as never);
        await executeRun(h.ctx, h.deps, runId);
        await tick();

        expect(h.db.get<Run>('SELECT * FROM runs WHERE id = ?', [runId])!.status).toBe('succeeded');
        expect(h.services.accounts!.gatedRuntimes()).toEqual([]);
      });

      // VS-137: the wake that discovered the outage is the one wake the release-on-recovery path
      // cannot resume unless it survives the pause — every other agent's still-queued wake already
      // does; this pins that the triggering agent's does too.
      describe('the triggering agent keeps its own work across the pause (VS-137)', () => {
        const authError: Partial<TurnResult> = { error: { code: 'oauth_expired', family: 'auth', message: 'OAuth session expired and could not be refreshed' } };
        const authFails = (agentId: string) => h.db.all<{ id: string }>(
          "SELECT id FROM runs WHERE agent_id = ? AND status = 'failed' AND error_family = 'auth'",
          [agentId],
        ).length;

        it('preserves the wake instead of failing it, with no new retry wake', async () => {
          const { workerId } = await failAuth();
          const wakeRow = h.db.get<Wakeup>("SELECT * FROM wakeups WHERE agent_id = ? ORDER BY created_at DESC LIMIT 1", [workerId])!;
          expect(wakeRow.status).toBe('queued');
          expect(wakeRow.runId).toBeNull();
          expect(h.db.all<Wakeup>("SELECT * FROM wakeups WHERE agent_id = ? AND source = 'retry'", [workerId])).toHaveLength(0);
        });

        it('resumes the same ticket on its own once the runtime recovers, with no human resuming it', async () => {
          const { workerId, ticketId } = await failAuth();
          expect(h.db.get<{ status: string }>('SELECT status FROM agents WHERE id = ?', [workerId])!.status).toBe('paused');

          ungateRuntime(h.ctx, h.deps, 'fake');
          expect(h.db.get<{ status: string }>('SELECT status FROM agents WHERE id = ?', [workerId])!.status).toBe('active');

          runtime.queue.push(resultFor(workerId, { structured: { state: 'done', summary: 'resumed', tickets: [], knowledge: { recorded: false, reason: 'test fixture' } } }));
          const run = await runOnce(workerId);
          expect(run.status).toBe('succeeded');
          expect(run.agentId).toBe(workerId);
          expect(h.db.get<{ status: string }>('SELECT status FROM tickets WHERE id = ?', [ticketId])!.status).toBe('in_progress');
        });

        it('stops resuming automatically on the third consecutive authentication failure, and parks for the human', async () => {
          const { workerId, ticketId } = await failAuth();
          expect(authFails(workerId)).toBe(1);
          ungateRuntime(h.ctx, h.deps, 'fake');
          runtime.queue.push(resultFor(workerId, authError));
          const second = await runOnce(workerId);
          expect(second.status).toBe('failed');
          expect(second.errorFamily).toBe('auth');
          expect(authFails(workerId)).toBe(2);
          ungateRuntime(h.ctx, h.deps, 'fake');
          runtime.queue.push(resultFor(workerId, authError));
          const third = await runOnce(workerId);
          expect(third.status).toBe('failed');
          expect(third.errorFamily).toBe('auth');
          expect(authFails(workerId)).toBe(3);

          // Third in a row, no success in between: parked for the human like the retry ladder's own
          // exhaustion, not preserved-and-gated again.
          expect(openFor(ticketId).some((d) => d.kind === 'retry_approval')).toBe(true);
          expect(h.db.get<{ status: string }>('SELECT status FROM tickets WHERE id = ?', [ticketId])!.status).toBe('blocked');
          expect(h.db.get<{ status: string }>('SELECT status FROM agents WHERE id = ?', [workerId])!.status).toBe('paused');
          const wakeRow = h.db.get<Wakeup>("SELECT * FROM wakeups WHERE agent_id = ? ORDER BY created_at DESC LIMIT 1", [workerId])!;
          expect(wakeRow.status).toBe('failed');
        });

        it('withdraws the per-ticket gate_finding once the ticket moves again', async () => {
          const { ticketId, workerId } = await failAuth();
          expect(openFor(ticketId).some((d) => d.kind === 'gate_finding' && d.owner === 'weaver')).toBe(true);

          ungateRuntime(h.ctx, h.deps, 'fake');
          runtime.queue.push(resultFor(workerId, { structured: { state: 'done', summary: 'ok', tickets: [], knowledge: { recorded: false, reason: 'test fixture' } } }));
          await runOnce(workerId);
          await tick();

          expect(openFor(ticketId).some((d) => d.kind === 'gate_finding' && d.owner === 'weaver')).toBe(false);
        });

        it('a success between two authentication failures resets the streak', async () => {
          const { workerId, ticketId } = await failAuth();
          ungateRuntime(h.ctx, h.deps, 'fake');

          runtime.queue.push(resultFor(workerId, { structured: { state: 'done', summary: 'ok', tickets: [], knowledge: { recorded: false, reason: 'test fixture' } } }));
          const ok = await runOnce(workerId);
          expect(ok.status).toBe('succeeded');
          expect(h.db.get<{ n: number }>(
            "SELECT COUNT(*) AS n FROM runs WHERE agent_id = ? AND status = 'succeeded'",
            [workerId],
          )!.n).toBe(1);

          h.services.wake!.enqueue(workerId, { source: 'ticket_assigned', reason: 'more work' });
          runtime.queue.push(resultFor(workerId, authError));
          const again = await runOnce(workerId);
          expect(again.status).toBe('failed');
          expect(again.errorFamily).toBe('auth');
          expect(authFails(workerId)).toBe(2);

          // Only one failure in a row, since the success in between reset the count: preserved and
          // gated again, not parked for the human.
          expect(openFor(ticketId).some((d) => d.kind === 'retry_approval')).toBe(false);
          expect(h.db.get<{ status: string }>('SELECT status FROM tickets WHERE id = ?', [ticketId])!.status).toBe('in_progress');
          expect(h.db.get<{ status: string }>('SELECT status FROM agents WHERE id = ?', [workerId])!.status).toBe('paused');
          const wakeRow = h.db.get<Wakeup>("SELECT * FROM wakeups WHERE agent_id = ? ORDER BY created_at DESC LIMIT 1", [workerId])!;
          expect(wakeRow.status).toBe('queued');
        });
      });
    });

    // VS-285: the daemon no longer provokes a refresh ahead of a turn (removed VS-105 machinery).
    it('spawns a turn without probing for a refresh, even when the credential looks near expiry', async () => {
      class FakeCredentialRuntime extends FakeRuntime {
        describeCalls = 0;
        readCredential(): { present: boolean; expiresAt: string | null } {
          // Looks exactly like the case that used to force a refresh: present, but not valid for a
          // whole turn's duration.
          return { present: true, expiresAt: new Date(Date.now() - 1000).toISOString() };
        }
        async describeAccount(): Promise<never> {
          this.describeCalls += 1;
          throw new Error('describeAccount must never be called to provoke a refresh (VS-285)');
        }
      }
      const credRuntime = new FakeCredentialRuntime();
      credRuntime.queue.push({ structured: { state: 'done', summary: 'fine', tickets: [] } } as never);
      h.ctx.registries.runtimes.set('fake', credRuntime);

      h.services.wake!.enqueue(h.conductorId, { source: 'human_message', reason: 'go' });
      const run = await runOnce();

      expect(run.status).toBe('succeeded');
      expect(credRuntime.describeCalls).toBe(0);
      expect(credRuntime.inputs).toHaveLength(1);
    });

    it('raises a retry_approval card the human can answer, pauses the worker and blocks the ticket', async () => {
      const { ticketId, workerId } = await failOnce({ error: { code: 'boom', family: 'unknown', message: 'the CLI died' } });

      const open = openFor(ticketId);
      expect(open).toHaveLength(1);
      const card = open[0]!;
      expect(card.kind).toBe('retry_approval');
      expect(card.owner).toBe('human');
      expect(card.title).toContain('TST-1');
      expect(card.context).toContain('the CLI died');
      // No per-runtime option: the runtime is a workspace setting, and the card says which (VS-77).
      expect(card.context).toContain('models.workers');
      expect(card.options.map((o: { key: string }) => o.key)).toEqual(['retry', 'retry_1h', 'cancel']);
      expect(card.recommendation).toBe('retry');
      expect(card.target).toMatchObject({ agentId: workerId, ticketId, family: 'unknown', code: 'boom' });

      expect(h.db.get<{ status: string; pauseReason: string }>('SELECT status, pause_reason FROM agents WHERE id = ?', [workerId]))
        .toMatchObject({ status: 'paused', pauseReason: 'boom: waiting for a human' });
      expect(h.db.get<{ status: string }>('SELECT status FROM tickets WHERE id = ?', [ticketId])!.status).toBe('blocked');
    });

    // VS-201: a bare, unmarked slice used to cut the runtime's message to 400 chars before either
    // the decision or the paused agent's pause detail was written — discarding exactly the tail of a
    // structured message (a trailing comma-separated list) with no sign anything was removed.
    it('preserves a long, structured failure message intact, tail included', async () => {
      const models = Array.from({ length: 60 }, (_, i) => `gpt-5.${i}-sol-high`).join(', ');
      const longMessage = `Cannot use this model: grok-4-6. Available models: ${models}`;
      expect(longMessage.length).toBeLessThan(4000);
      const { ticketId, workerId } = await failOnce({ error: { code: 'bad_model', family: 'unknown', message: longMessage } });

      const card = openFor(ticketId)[0]!;
      expect(card.context).toContain(longMessage);
      expect(card.context).toContain('gpt-5.59-sol-high');

      const agent = h.db.get<{ pauseDetail: { message?: string } | null }>('SELECT * FROM agents WHERE id = ?', [workerId])!;
      expect(agent.pauseDetail?.message).toBe(longMessage);
    });

    it('marks a failure message longer than the generous limit instead of cutting it silently', async () => {
      const longMessage = 'x'.repeat(5000);
      const { ticketId, workerId } = await failOnce({ error: { code: 'huge', family: 'unknown', message: longMessage } });

      const card = openFor(ticketId)[0]!;
      expect(card.context).toMatch(/…\[\+\d+ chars\]/);
      expect(card.context.length).toBeLessThan(longMessage.length);

      const agent = h.db.get<{ pauseDetail: { message?: string } | null }>('SELECT * FROM agents WHERE id = ?', [workerId])!;
      expect(agent.pauseDetail?.message).toMatch(/…\[\+\d+ chars\]$/);
    });

    // The ladder is real now that the dispatcher links the attempts: four transient failures, three
    // of them retried on the documented backoff, then the card. `not_before` is cleared between
    // rounds so the test does not wait out 30 s / 2 min / 10 min — the payload, and so the link, is
    // untouched.
    it('retries a transient failure three times on the documented backoff, then parks the worker', async () => {
      const ticketId = seedTicket(h, { status: 'in_progress' });
      const workerId = h.addWorker(ticketId, { runtimeId: 'fake', worktreePath: null });
      const failNext = (): void => { runtime.queue.push({ error: { code: 'overloaded', family: 'transient_upstream', message: 'upstream busy' } } as never); };
      const queuedRetry = (): Wakeup | undefined =>
        h.db.get<Wakeup>("SELECT * FROM wakeups WHERE agent_id = ? AND status = 'queued' AND source = 'retry' ORDER BY created_at DESC LIMIT 1", [workerId]);

      failNext();
      h.services.wake!.enqueue(workerId, { source: 'ticket_assigned', reason: 'TST-1: Add a README badge' });
      const runs: Run[] = [await runOnce()];
      await tick();

      const delays: number[] = [];
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const retry = queuedRetry();
        expect(retry, `attempt ${attempt} should have been retried`).toBeTruthy();
        delays.push(new Date(retry!.notBefore!).getTime() - Date.now());
        expect(openFor(ticketId)).toHaveLength(0);
        expect(h.db.get<{ status: string }>('SELECT status FROM agents WHERE id = ?', [workerId])!.status).toBe('active');
        h.db.update('wakeups', retry!.id, { notBefore: null });
        failNext();
        runs.push(await runOnce());
        await tick();
      }

      // Every attempt after the first names the one before it, which is what makes the ladder end.
      expect(runs.map((r) => r.retryOfRunId)).toEqual([null, runs[0]!.id, runs[1]!.id, runs[2]!.id]);
      // The timings are unchanged: 30 s, 2 min, 10 min.
      expect(delays[0]).toBeGreaterThan(20_000);
      expect(delays[0]).toBeLessThan(40_000);
      expect(delays[1]).toBeGreaterThan(110_000);
      expect(delays[1]).toBeLessThan(130_000);
      expect(delays[2]).toBeGreaterThan(590_000);
      expect(delays[2]).toBeLessThan(610_000);

      // Fourth failure: the ladder is spent, so nothing more is queued and the human gets the card.
      expect(queuedRetry()).toBeUndefined();
      const card = openFor(ticketId)[0]!;
      expect(card.kind).toBe('retry_approval');
      expect(card.recommendation).toBe('retry');
      expect(h.db.get<{ status: string }>('SELECT status FROM agents WHERE id = ?', [workerId])!.status).toBe('paused');
      expect(h.db.get<{ status: string }>('SELECT status FROM tickets WHERE id = ?', [ticketId])!.status).toBe('blocked');
    });

    // A usage limit never enters the ladder (ADR 0010): the runtime has already said the window is
    // exhausted, so three more attempts are guaranteed waste.
    it('parks a usage limit on its first failure, scheduling nothing at all', async () => {
      const { ticketId, workerId } = await failOnce({ error: { code: 'rate_limit', family: 'provider_quota', message: 'limit resets in 2 hours' } });

      expect(h.db.get<{ n: number }>("SELECT COUNT(*) n FROM wakeups WHERE agent_id = ? AND source = 'retry'", [workerId])!.n).toBe(0);
      const card = openFor(ticketId)[0]!;
      expect(card.kind).toBe('retry_approval');
      expect(card.title).toContain('usage limit');
      expect(card.context).toContain('provider_quota');
      expect(card.context).toContain('limit resets in 2 hours');
      expect(card.context).toContain('nothing will run until you answer');
      expect(card.context).toContain('models.workers');
      // The reset time is offered, never booked.
      expect(card.recommendation).toBe('retry_at_reset');
      const reset = card.options.find((o: { key: string }) => o.key === 'retry_at_reset')!;
      expect(reset.label).toContain('Retry when the limit resets');
      expect(card.options.map((o: { key: string }) => o.key)).toEqual(['retry', 'retry_at_reset', 'cancel']);

      const agent = h.db.get<{ status: string; pauseReason: string; pauseDetail: Record<string, unknown> }>(
        'SELECT status, pause_reason, pause_detail_json FROM agents WHERE id = ?', [workerId])!;
      expect(agent.status).toBe('paused');
      expect(agent.pauseReason).toBe('rate_limit: waiting for a human');
      expect(agent.pauseDetail).toMatchObject({ family: 'provider_quota', code: 'rate_limit', message: 'limit resets in 2 hours' });
      expect(new Date(String(agent.pauseDetail.resetAt)).getTime()).toBeGreaterThan(Date.now() + 100 * 60_000);
      expect(h.db.get<{ status: string }>('SELECT status FROM tickets WHERE id = ?', [ticketId])!.status).toBe('blocked');
    });

    it('falls back to the hour offer when the runtime names no reset time', async () => {
      const { ticketId, workerId } = await failOnce({ error: { code: 'rate_limit', family: 'provider_quota', message: 'you are out of credits' } });
      const card = openFor(ticketId)[0]!;
      expect(card.options.map((o: { key: string }) => o.key)).toEqual(['retry', 'retry_1h', 'cancel']);
      expect(card.recommendation).toBe('retry_1h');
      expect(h.db.get<{ pauseDetail: { resetAt: string | null } }>('SELECT pause_detail_json FROM agents WHERE id = ?', [workerId])!.pauseDetail.resetAt).toBeNull();
      expect(h.db.get<{ n: number }>("SELECT COUNT(*) n FROM wakeups WHERE agent_id = ? AND source = 'retry'", [workerId])!.n).toBe(0);
    });

    it('recommends retry at the VS-234 reset instant when now is the failure, not the window start (VS-238)', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-09-11T17:00:12.000Z'));
      try {
        const message = readFileSync(
          join(dirname(fileURLToPath(import.meta.url)), 'fixtures/vs-234-opencode.txt'),
          'utf8',
        ).trim();
        const { ticketId, workerId } = await failOnce({ error: { code: 'rate_limit', family: 'provider_quota', message } });
        const card = openFor(ticketId)[0]!;
        expect(card.recommendation).toBe('retry_at_reset');
        expect(card.context).toContain('2026-09-11 17:54');
        expect(card.context).toContain('Your limit will reset at 2026-09-12 01:54:35');
        expect(card.context).not.toContain('2026-09-12 01:54 UTC');
        const agent = h.db.get<{ pauseDetail: { message?: string; resetAt?: string } }>('SELECT pause_detail_json FROM agents WHERE id = ?', [workerId])!;
        expect(agent.pauseDetail.message).toContain('Your limit will reset at 2026-09-12 01:54:35');
        expect(agent.pauseDetail.resetAt).toBe('2026-09-11T17:54:35.000Z');
        expect(h.db.get<{ n: number }>("SELECT COUNT(*) n FROM wakeups WHERE agent_id = ? AND source = 'retry'", [workerId])!.n).toBe(0);
      } finally {
        vi.useRealTimers();
      }
    });

    it('offers other catalog options on a quota card, never as the recommendation (VS-238)', async () => {
      h.ctx.config.models.workerOptions = [
        { id: 'standard', description: 'Specified work.', runtime: 'fake', model: null },
        { id: 'deep', description: 'Cause unknown.', runtime: 'fake', model: null },
      ];
      const { ticketId } = await failOnce(
        { error: { code: 'rate_limit', family: 'provider_quota', message: 'you are out of credits' } },
        1,
        { workerModelId: 'standard' },
      );
      const card = openFor(ticketId)[0]!;
      const keys = card.options.map((o: { key: string }) => o.key);
      expect(keys).toContain('switch:deep');
      expect(keys).not.toContain('switch:standard');
      expect(card.recommendation).not.toMatch(/^switch:/);
      expect(keys.at(-1)).toBe('cancel');
    });

    it('does not offer a catalog switch on a spent unknown failure (VS-238)', async () => {
      h.ctx.config.models.workerOptions = [
        { id: 'standard', description: 'Specified work.', runtime: 'fake', model: null },
        { id: 'deep', description: 'Cause unknown.', runtime: 'fake', model: null },
      ];
      const { ticketId } = await failOnce({ error: { code: 'boom', family: 'unknown', message: 'the CLI died' } });
      const keys = openFor(ticketId)[0]!.options.map((o: { key: string }) => o.key);
      expect(keys.some((k: string) => k.startsWith('switch:'))).toBe(false);
    });

    it('answering a catalog switch keeps the worktree and changes only the ticket option (VS-238)', async () => {
      h.ctx.config.models.workerOptions = [
        { id: 'standard', description: 'Specified work.', runtime: 'fake', model: null },
        { id: 'deep', description: 'Cause unknown.', runtime: 'opencode', model: 'kimi' },
      ];
      const { ticketId, workerId } = await failOnce(
        { error: { code: 'rate_limit', family: 'provider_quota', message: 'you are out of credits' } },
        1,
        { workerModelId: 'standard' },
      );
      const worktreePath = join(h.ctx.paths.workers, workerId, 'work');
      const branch = 'ac/vs-238-test';
      h.db.update('agents', workerId, { worktreePath, branch });
      const wtId = newId();
      h.db.insert('worktrees', {
        id: wtId, projectId: h.projectId, ticketId, agentId: workerId, provider: 'git',
        path: worktreePath, branch, status: 'active', createdAt: nowIso(),
      });
      h.services.tickets!.addWorkProduct({ kind: 'system', id: null }, ticketId, {
        type: 'commit', title: 'head', externalId: 'abc1234def', state: 'ready',
      });
      const resume = vi.fn((actor: Actor, id: string) => {
        h.db.update('agents', id, { status: 'active', pauseReason: null, pauseDetailJson: null, updatedAt: nowIso() });
        h.services.wake!.enqueue(id, { source: 'system', reason: 'resumed', payload: { resumed: true } });
        return h.db.get('SELECT * FROM agents WHERE id = ?', [id]);
      });
      h.services.workers = { resume, relaunch: vi.fn(async (a: Actor, id: string) => resume(a, id)) } as never;

      const card = openFor(ticketId)[0]!;
      await h.services.decisions!.answer({ kind: 'human', id: 'h1' }, card.id, { key: 'switch:deep' });
      await tick();

      expect(h.services.tickets!.get(ticketId).workerModelId).toBe('deep');
      const agentAfter = h.db.get<{ status: string; worktreePath: string; branch: string }>('SELECT * FROM agents WHERE id = ?', [workerId])!;
      expect(agentAfter).toMatchObject({ status: 'active', worktreePath, branch });
      const wt = h.db.get<{ path: string; branch: string }>('SELECT * FROM worktrees WHERE id = ?', [wtId])!;
      expect(wt).toMatchObject({ path: worktreePath, branch });
      expect(h.services.tickets!.workProducts(ticketId).some((wp) => wp.type === 'commit' && wp.externalId === 'abc1234def')).toBe(true);
      expect(resume).toHaveBeenCalled();
      expect(h.db.get<{ n: number }>("SELECT COUNT(*) n FROM wakeups WHERE agent_id = ? AND source = 'retry'", [workerId])!.n).toBe(0);
    });

    it('leaves workerModelId and the worktree untouched while the quota card is unanswered (VS-238)', async () => {
      h.ctx.config.models.workerOptions = [
        { id: 'standard', description: 'Specified work.', runtime: 'fake', model: null },
        { id: 'deep', description: 'Cause unknown.', runtime: 'fake', model: null },
      ];
      const { ticketId, workerId } = await failOnce(
        { error: { code: 'rate_limit', family: 'provider_quota', message: 'you are out of credits' } },
        1,
        { workerModelId: 'standard' },
      );
      const before = h.db.get<{ worktreePath: string; branch: string; status: string }>('SELECT worktree_path, branch, status FROM agents WHERE id = ?', [workerId])!;
      expect(h.services.tickets!.get(ticketId).workerModelId).toBe('standard');
      expect(before.status).toBe('paused');
      expect(h.db.get<{ n: number }>("SELECT COUNT(*) n FROM wakeups WHERE agent_id = ? AND source = 'retry'", [workerId])!.n).toBe(0);
      expect(openFor(ticketId)[0]!.options.some((o: { key: string }) => o.key === 'switch:deep')).toBe(true);
    });

    it('books the attempt only when the human chooses the reset option', async () => {
      const { ticketId, workerId } = await failOnce({ error: { code: 'rate_limit', family: 'provider_quota', message: 'limit resets in 2 hours' } });
      const card = openFor(ticketId)[0]!;
      const resetAt = h.db.get<{ pauseDetail: { resetAt: string } }>('SELECT pause_detail_json FROM agents WHERE id = ?', [workerId])!.pauseDetail.resetAt;

      await h.services.decisions!.answer({ kind: 'human', id: 'h1' }, card.id, { key: 'retry_at_reset' });

      const booked = h.db.all<Wakeup>("SELECT * FROM wakeups WHERE agent_id = ? AND source = 'retry'", [workerId]);
      expect(booked).toHaveLength(1);
      expect(booked[0]!.notBefore).toBe(resetAt);
      const agent = h.db.get<{ status: string; pauseReason: string | null; pauseDetail: unknown }>(
        'SELECT status, pause_reason, pause_detail_json FROM agents WHERE id = ?', [workerId])!;
      expect(agent).toMatchObject({ status: 'active', pauseReason: null, pauseDetail: null });
    });

    it('still blocks the ticket and logs at error when the card cannot be raised', async () => {
      const errors = captureErrors();
      h.services.decisions = {
        ...h.services.decisions!,
        create: () => { throw new Error('CHECK constraint failed: kind'); },
      } as never;

      const ticketId = seedTicket(h, { status: 'in_progress' });
      const workerId = h.addWorker(ticketId, { runtimeId: 'fake', worktreePath: null });
      runtime.queue.push({ error: { code: 'boom', family: 'unknown', message: 'the CLI died' } } as never);
      h.services.wake!.enqueue(workerId, { source: 'ticket_assigned', reason: 'TST-1: Add a README badge' });
      await runOnce();
      await tick();

      expect(h.db.get<{ n: number }>("SELECT COUNT(*) n FROM decisions WHERE kind = 'retry_approval'")!.n).toBe(0);
      expect(h.db.get<{ status: string }>('SELECT status FROM agents WHERE id = ?', [workerId])!.status).toBe('paused');
      expect(h.db.get<{ status: string }>('SELECT status FROM tickets WHERE id = ?', [ticketId])!.status).toBe('blocked');
      const raised = errors.find((e) => e.step === 'raise the decision');
      expect(raised).toBeTruthy();
      expect(raised).toMatchObject({ agentId: workerId, ticketId });
      expect(String(raised!.err)).toContain('CHECK constraint failed');
      // Blocking is the only thing left telling the human anything, so it carries the way out.
      expect(errors.some((e) => e.step === 'block the ticket')).toBe(false);
      expect(h.db.get<{ unblock: { owner: string; action: string } }>('SELECT unblock_json FROM tickets WHERE id = ?', [ticketId])!.unblock)
        .toMatchObject({ owner: 'human' });
    });

    it('withdraws the card when the worker recovers on its own', async () => {
      const { ticketId, workerId } = await failOnce({ error: { code: 'boom', family: 'unknown', message: 'the CLI died' } });
      const card = openFor(ticketId)[0]!;
      expect(card.kind).toBe('retry_approval');

      h.db.update('agents', workerId, { status: 'active' });
      runtime.queue.push(resultFor(workerId, { structured: { state: 'working', summary: 'back on it', tickets: [], knowledge: { recorded: false, reason: 'test fixture' } } }));
      h.services.wake!.enqueue(workerId, { source: 'retry', reason: 'retry after boom' });
      await runOnce(workerId);
      await tick();

      expect(openFor(ticketId)).toHaveLength(0);
      expect(h.db.get<{ status: string }>('SELECT status FROM decisions WHERE id = ?', [card.id])!.status).toBe('withdrawn');
      // A turn taken is a pause spent: the free-text reason and its structured twin go together.
      expect(h.db.get<{ pauseReason: string | null; pauseDetail: unknown }>('SELECT pause_reason, pause_detail_json FROM agents WHERE id = ?', [workerId]))
        .toMatchObject({ pauseReason: null, pauseDetail: null });
    });

    // VS-118: parking used to lose the ticket's real status because resuming picked `in_progress` vs
    // `todo` from `ticket.executionRunId`, which this very `finalize()` already nulls a few lines
    // above the `parkForHuman` call below — so it was always `todo`, and a `change` ticket that was
    // `approved` had to walk the whole propose path again, re-raising an approval the human already
    // gave for an unchanged plan.
    it('parks an approved change ticket and restores exactly that status on retry, with no new plan_approval', async () => {
      h.services.workers = { relaunch: vi.fn(async () => undefined) } as never;
      const ticketId = seedTicket(h, { kind: 'change', status: 'approved' });
      const workerId = h.addWorker(ticketId, { runtimeId: 'fake', worktreePath: null });
      runtime.queue.push({ error: { code: 'boom', family: 'unknown', message: 'the CLI died' } } as never);
      h.services.wake!.enqueue(workerId, { source: 'ticket_assigned', reason: 'TST-1: Add a README badge' });
      await runOnce();
      await tick();

      expect(h.db.get<{ status: string; blockedFromStatus: string | null }>('SELECT status, blocked_from_status as blockedFromStatus FROM tickets WHERE id = ?', [ticketId]))
        .toMatchObject({ status: 'blocked', blockedFromStatus: 'approved' });

      const card = openFor(ticketId)[0]!;
      expect(card.kind).toBe('retry_approval');
      await h.services.decisions!.answer({ kind: 'human', id: 'victor' }, card.id, { key: 'retry' });

      expect(h.db.get<{ status: string }>('SELECT status FROM tickets WHERE id = ?', [ticketId])!.status).toBe('approved');
      expect(openFor(ticketId).filter((d) => d.kind === 'plan_approval')).toHaveLength(0);
    });
  });

  describe('the stuck-worker gate (VS-145)', () => {
    beforeEach(() => {
      h.services.tickets = createTicketsService(h.ctx, h.deps);
      h.services.decisions = createDecisionsService(h.ctx, h.deps);
    });

    const openGateFindings = (ticketId: string): Decision[] =>
      h.services.decisions!.list({ status: ['open'], ticketId }).filter((d) => d.kind === 'gate_finding');

    /** Runs one worker turn on `ticketId`, returning the finished run. */
    async function runWorkerTurn(workerId: string, ticketId: string, reason = 'go'): Promise<Run> {
      if (runtime.queue.length > 0) {
        const next = runtime.queue.shift()!;
        runtime.queue.unshift(resultFor(workerId, next));
      }
      h.services.wake!.enqueue(workerId, { source: 'ticket_comment', reason });
      return runOnce(workerId);
    }

    it('records a validly idle report as its own liveness, not empty (PLAN §9.4)', async () => {
      const ticketId = seedTicket(h, { status: 'in_review' });
      const workerId = h.addWorker(ticketId, { runtimeId: 'fake', worktreePath: null });
      runtime.queue.push({ structured: { state: 'idle', summary: 'nothing actionable', tickets: [], knowledge: { recorded: false, reason: 'idle turn' } } });
      const run = await runWorkerTurn(workerId, ticketId);
      expect(run.liveness).toBe('idle');
    });

    it('does not count a run against the worker when it left evidence, whichever reporting channel produced it', async () => {
      // "Empty" turn one: the terminal report never parses (no StructuredOutput channel used), but the
      // turn posted a ticket comment mid-run — exactly what `weave_report` does today.
      const ticketId = seedTicket(h, { status: 'in_progress' });
      const workerId = h.addWorker(ticketId, { runtimeId: 'fake', worktreePath: null });
      for (let i = 0; i < 3; i += 1) {
        runtime.queue.push((input) => {
          h.db.insert('ticket_comments', {
            id: newId(), ticketId, authorKind: 'agent', authorId: workerId, runId: input.runId,
            body: `[working] turn ${i}`, kind: 'status', sourceTrust: 'agent', createdAt: nowIso(),
          });
          return { structured: undefined, finalText: 'not a valid report' };
        });
        const run = await runWorkerTurn(workerId, ticketId);
        expect(run.liveness).toBe('empty');
      }
      expect(openGateFindings(ticketId)).toHaveLength(0);
    });

    it('still raises the gate for three genuinely inert turns — no report, no evidence, a ticket the worker was expected to act on', async () => {
      const ticketId = seedTicket(h, { status: 'in_progress' });
      const workerId = h.addWorker(ticketId, { runtimeId: 'fake', worktreePath: null });
      for (let i = 0; i < 3; i += 1) {
        runtime.queue.push({ structured: undefined, finalText: 'I looked around and did nothing' });
        const run = await runWorkerTurn(workerId, ticketId);
        expect(run.liveness).toBe('empty');
      }
      const findings = openGateFindings(ticketId);
      expect(findings).toHaveLength(1);
      expect(findings[0]!.title).toContain('three empty turns');
    });

    it('does not raise the gate for a worker correctly idle on a ticket awaiting human approval', async () => {
      const ticketId = seedTicket(h, { status: 'in_review' });
      const workerId = h.addWorker(ticketId, { runtimeId: 'fake', worktreePath: null });
      for (let i = 0; i < 3; i += 1) {
        runtime.queue.push({ structured: { state: 'idle', summary: 'still waiting on review', tickets: [], knowledge: { recorded: false, reason: 'nothing new' } } });
        const run = await runWorkerTurn(workerId, ticketId, `unrelated activity ${i}`);
        expect(run.liveness).toBe('idle');
      }
      expect(openGateFindings(ticketId)).toHaveLength(0);
    });

    it('trips the gate once the same worker is expected to act again, counting only turns from that point', async () => {
      const HUMAN: Actor = { kind: 'human', id: 'victor' };
      const ticketId = seedTicket(h, { status: 'in_review' });
      // A raw-seeded ticket carries no creation history; anchor its starting status the way
      // `tickets.create()` would, so reconstructing an earlier run's status doesn't fall back to
      // reading the ticket's *current* status once it later transitions.
      h.db.insert('activity', {
        id: newId(), workspaceId: h.workspaceId, actorKind: 'human', actorId: 'victor', ticketId, entityType: 'ticket', entityId: ticketId,
        action: 'ticket.create', detailsJson: { kind: 'task', identifier: 'TST-1', status: 'in_review' }, createdAt: nowIso(),
      });
      const workerId = h.addWorker(ticketId, { runtimeId: 'fake', worktreePath: null });

      // Two turns while correctly parked: idle, no evidence, not expected to act.
      for (let i = 0; i < 2; i += 1) {
        runtime.queue.push({ structured: { state: 'idle', summary: 'waiting on review', tickets: [], knowledge: { recorded: false, reason: 'nothing new' } } });
        await runWorkerTurn(workerId, ticketId, `parked ${i}`);
      }
      expect(openGateFindings(ticketId)).toHaveLength(0);

      // The ticket is sent back for more work — logged through the real transition, so the gate can
      // tell "expected to act" apart from "still parked" for these two prior turns.
      await h.services.tickets!.transition(HUMAN, ticketId, { to: 'in_progress', note: 'needs another pass' });

      // Only one inert turn since then: not enough on its own.
      runtime.queue.push({ structured: undefined, finalText: 'nothing yet' });
      await runWorkerTurn(workerId, ticketId, 'back to it');
      expect(openGateFindings(ticketId)).toHaveLength(0);

      // A second and third inert turn while expected to act completes three in a row from that point.
      for (let i = 0; i < 2; i += 1) {
        runtime.queue.push({ structured: undefined, finalText: 'still nothing' });
        await runWorkerTurn(workerId, ticketId, `stuck ${i}`);
      }
      expect(openGateFindings(ticketId)).toHaveLength(1);
    });

    it('never counts an advanced turn toward the gate, whether or not it also called weave_report mid-turn', async () => {
      const ticketId = seedTicket(h, { status: 'in_progress' });
      const workerId = h.addWorker(ticketId, { runtimeId: 'fake', worktreePath: null });

      // Channel A: only the terminal structured report, no mid-turn comment.
      runtime.queue.push({ structured: { state: 'working', summary: 'made progress', tickets: [], knowledge: { recorded: false, reason: 'mid-task' } } });
      const runA = await runWorkerTurn(workerId, ticketId, 'first');
      expect(runA.liveness).toBe('advanced');

      // Channel B: the same valid terminal report, plus a mid-turn `weave_report`-shaped comment.
      runtime.queue.push((input) => {
        h.db.insert('ticket_comments', {
          id: newId(), ticketId, authorKind: 'agent', authorId: workerId, runId: input.runId,
          body: '[working] still going', kind: 'status', sourceTrust: 'agent', createdAt: nowIso(),
        });
        return { structured: { state: 'working', summary: 'made more progress', tickets: [], knowledge: { recorded: false, reason: 'mid-task' } } };
      });
      const runB = await runWorkerTurn(workerId, ticketId, 'second');
      expect(runB.liveness).toBe('advanced');

      expect(openGateFindings(ticketId)).toHaveLength(0);
    });
  });
  // VS-255: a curation worker had no worktree of its own and fact-checked against the primary clone
  // exactly as it happened to sit on disk — two days behind `origin/main` — and removed real
  // knowledge entries as "contradicted". VS-256 gates every curation turn on that clone being fetched
  // and fast-forwarded to `origin/<landingBranch>` first; when that cannot be established, the turn
  // never runs and the ticket is blocked instead.
  describe('curation checkout freshness gate (VS-256)', () => {
    const dirs: string[] = [];

    beforeEach(() => {
      h.services.tickets = createTicketsService(h.ctx, h.deps);
      h.services.projects = createProjectsService(h.ctx, h.deps);
    });
    afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

    async function initRepo(dir: string): Promise<void> {
      mkdirSync(dir, { recursive: true });
      await git(['init', '-b', 'main'], dir, 30_000);
      await git(['config', 'user.email', 'test@example.com'], dir, 10_000);
      await git(['config', 'user.name', 'Test'], dir, 10_000);
      // A second clone pushes into this one in one test below — a non-bare repo refuses a push to
      // its checked-out branch by default; nothing here ever reads this repo's own working tree.
      await git(['config', 'receive.denyCurrentBranch', 'ignore'], dir, 10_000);
    }
    async function commit(dir: string, file: string, contents: string, message: string): Promise<void> {
      mkdirSync(dirname(join(dir, file)), { recursive: true });
      writeFileSync(join(dir, file), contents, 'utf8');
      await git(['add', '.'], dir, 10_000);
      await git(['commit', '-m', message], dir, 10_000);
    }

    /** A fresh bare-ish `origin` and a real clone of it wired up as the project's own `clonePath`. */
    async function seedRemoteAndClone(): Promise<{ remoteDir: string; clonePath: string }> {
      const remoteDir = mkdtempSync(join(tmpdir(), 'ac-vs256-remote-'));
      dirs.push(remoteDir);
      await initRepo(remoteDir);
      await commit(remoteDir, 'README.md', '# api\n', 'init');
      const clonePath = h.db.get<{ clonePath: string }>('SELECT clone_path FROM projects WHERE id = ?', [h.projectId])!.clonePath;
      await git(['clone', remoteDir, clonePath], h.root, 30_000);
      await git(['config', 'user.email', 'test@example.com'], clonePath, 10_000);
      await git(['config', 'user.name', 'Test'], clonePath, 10_000);
      return { remoteDir, clonePath };
    }

    function seedCuration(over: Record<string, unknown> = {}): { ticketId: string; workerId: string } {
      const ticketId = seedTicket(h, { originKind: 'curation', ...over });
      const workerId = h.addWorker(ticketId, { runtimeId: 'fake', worktreePath: null, branch: null });
      return { ticketId, workerId };
    }

    it('fetches and fast-forwards a behind (not diverged) clone, then runs the turn against the now-current tree', async () => {
      const { remoteDir, clonePath } = await seedRemoteAndClone();
      // A second clone pushes a commit to origin after the primary clone above was cut — the exact
      // VS-255 shape: local HEAD behind origin/main, no local divergence.
      const otherClone = mkdtempSync(join(tmpdir(), 'ac-vs256-other-'));
      dirs.push(otherClone);
      await git(['clone', remoteDir, otherClone], h.root, 30_000);
      await git(['config', 'user.email', 'test@example.com'], otherClone, 10_000);
      await git(['config', 'user.name', 'Test'], otherClone, 10_000);
      await commit(otherClone, 'docs/backup-and-restore.md', '# Backup and restore\n', 'add backup runbook');
      const pushed = await git(['push'], otherClone, 30_000);
      expect(pushed.ok).toBe(true);
      // The primary clone has not fetched yet, so this file genuinely does not exist there until the gate runs.
      expect(existsSync(join(clonePath, 'docs', 'backup-and-restore.md'))).toBe(false);

      const { workerId } = seedCuration();
      runtime.queue.push({ structured: { state: 'done', summary: 'curated', tickets: [], knowledge: { recorded: false, reason: 'test fixture' } } });
      h.services.wake!.enqueue(workerId, { source: 'ticket_assigned', reason: 'curate' });
      const run = await runOnce(workerId);

      expect(run.status).toBe('succeeded');
      expect(runtime.inputs).toHaveLength(1);
      expect(runtime.inputs[0]!.worktree).toEqual({ path: clonePath, branch: '' });
      // The clone's checked-out files now reflect origin's current tip — the newer commit is real,
      // not something a stale checkout would have (mis)reported as missing.
      expect(existsSync(join(clonePath, 'docs', 'backup-and-restore.md'))).toBe(true);
      const project = h.db.get<{ syncState: string }>('SELECT sync_state AS syncState FROM projects WHERE id = ?', [h.projectId]);
      expect(project?.syncState).toBe('in_sync');
    });

    it('runs normally, with no surprise, when the clone is already current', async () => {
      const { clonePath } = await seedRemoteAndClone();
      const { workerId } = seedCuration({ number: 2, identifier: 'TST-2' });
      runtime.queue.push({ structured: { state: 'done', summary: 'curated', tickets: [], knowledge: { recorded: false, reason: 'test fixture' } } });
      h.services.wake!.enqueue(workerId, { source: 'ticket_assigned', reason: 'curate' });
      const run = await runOnce(workerId);
      expect(run.status).toBe('succeeded');
      expect(runtime.inputs[0]!.worktree).toEqual({ path: clonePath, branch: '' });
    });

    it('blocks the ticket and never runs the turn when the primary clone has diverged and cannot be fast-forwarded', async () => {
      const { remoteDir, clonePath } = await seedRemoteAndClone();
      // Real divergence needs commits on both sides that the other lacks — origin moves via a
      // second clone pushing to it, and the primary clone (which nothing should ever commit to
      // directly) gets an unrelated local commit of its own. A local-only commit alone would just
      // leave the clone strictly ahead, which `merge --ff-only` treats as already up to date.
      const otherClone = mkdtempSync(join(tmpdir(), 'ac-vs256-diverge-'));
      dirs.push(otherClone);
      await git(['clone', remoteDir, otherClone], h.root, 30_000);
      await git(['config', 'user.email', 'test@example.com'], otherClone, 10_000);
      await git(['config', 'user.name', 'Test'], otherClone, 10_000);
      await commit(otherClone, 'docs/backup-and-restore.md', '# Backup and restore\n', 'add backup runbook');
      const pushed = await git(['push'], otherClone, 30_000);
      expect(pushed.ok).toBe(true);
      await commit(clonePath, 'local-only.txt', 'oops\n', 'stray local commit');

      const { ticketId, workerId } = seedCuration();
      h.services.wake!.enqueue(workerId, { source: 'ticket_assigned', reason: 'curate' });
      const run = await runOnce(workerId);

      expect(run.status).toBe('failed');
      expect(run.errorCode).toBe('checkout_stale');
      expect(run.errorFamily).toBe('tooling');
      expect(runtime.inputs).toHaveLength(0);
      const ticket = h.services.tickets!.get(ticketId);
      expect(ticket.status).toBe('blocked');
      expect(ticket.unblock?.owner).toBe('weaver');
      expect(ticket.unblock?.action).toContain(h.projectSlug);
      expect(ticket.unblock?.action).toContain('diverged');
    });

    it('blocks the ticket and never runs the turn when fetching origin fails', async () => {
      const { clonePath } = await seedRemoteAndClone();
      await git(['remote', 'set-url', 'origin', join(h.root, 'nonexistent-remote')], clonePath, 10_000);

      const { ticketId, workerId } = seedCuration();
      h.services.wake!.enqueue(workerId, { source: 'ticket_assigned', reason: 'curate' });
      const run = await runOnce(workerId);

      expect(run.status).toBe('failed');
      expect(run.errorCode).toBe('checkout_stale');
      expect(runtime.inputs).toHaveLength(0);
      const ticket = h.services.tickets!.get(ticketId);
      expect(ticket.status).toBe('blocked');
      expect(ticket.unblock?.owner).toBe('weaver');
      expect(ticket.unblock?.action).toContain('could not fetch');
    });

    it('checks freshness again on a second turn, rather than trusting the first turn verified it', async () => {
      const { remoteDir, clonePath } = await seedRemoteAndClone();
      const { ticketId, workerId } = seedCuration();

      runtime.queue.push({ structured: { state: 'working', summary: 'first pass', tickets: [], knowledge: { recorded: false, reason: 'test fixture' } } });
      h.services.wake!.enqueue(workerId, { source: 'ticket_assigned', reason: 'curate' });
      const first = await runOnce(workerId);
      expect(first.status).toBe('succeeded');
      expect(runtime.inputs).toHaveLength(1);

      // Origin moves (via a second clone pushing to it) and the primary clone picks up an unrelated
      // local commit of its own — real two-sided divergence, not just the clone getting ahead.
      const otherClone = mkdtempSync(join(tmpdir(), 'ac-vs256-diverge2-'));
      dirs.push(otherClone);
      await git(['clone', remoteDir, otherClone], h.root, 30_000);
      await git(['config', 'user.email', 'test@example.com'], otherClone, 10_000);
      await git(['config', 'user.name', 'Test'], otherClone, 10_000);
      await commit(otherClone, 'docs/backup-and-restore.md', '# Backup and restore\n', 'add backup runbook');
      const pushed = await git(['push'], otherClone, 30_000);
      expect(pushed.ok).toBe(true);
      await commit(clonePath, 'local-only.txt', 'oops\n', 'stray local commit between turns');

      h.services.wake!.enqueue(workerId, { source: 'human_message', reason: 'one more pass' });
      const second = await runOnce(workerId);
      expect(second.status).toBe('failed');
      expect(second.errorCode).toBe('checkout_stale');
      expect(runtime.inputs).toHaveLength(1); // still just the one input from the first, fresh turn
      const ticket = h.services.tickets!.get(ticketId);
      expect(ticket.status).toBe('blocked');
    });

    it('never gates a non-curation, no-worktree ticket', async () => {
      const fetchSpy = vi.spyOn(h.services.projects!, 'fetch');
      const ticketId = seedTicket(h, { number: 3, identifier: 'TST-3' });
      const workerId = h.addWorker(ticketId, { runtimeId: 'fake', worktreePath: null });
      runtime.queue.push({ structured: { state: 'done', summary: 'ordinary task', tickets: [], knowledge: { recorded: false, reason: 'test fixture' } } });
      h.services.wake!.enqueue(workerId, { source: 'ticket_assigned', reason: 'go' });
      const run = await runOnce(workerId);
      expect(run.status).toBe('succeeded');
      expect(runtime.inputs).toHaveLength(1);
      expect(runtime.inputs[0]!.worktree).toBeNull();
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  // VS-338: a resolving wake starting a worker's turn must return a blocked ticket to the work it was
  // doing, before the turn does anything — but a timer or self-scheduled wake must not, or a worker
  // with a periodic self-check would churn the board and wake a weaver-owned block's owner every tick.
  describe('blocked-ticket restore on a resolving wake (VS-338)', () => {
    const SYSTEM: Actor = { kind: 'system', id: null };
    const HUMAN: Actor = { kind: 'human', id: 'victor' };

    beforeEach(() => {
      h.services.tickets = createTicketsService(h.ctx, h.deps);
      h.services.decisions = createDecisionsService(h.ctx, h.deps);
    });

    const statusOf = (ticketId: string): string =>
      h.db.get<{ status: string }>('SELECT status FROM tickets WHERE id = ?', [ticketId])!.status;

    async function blockTicket(ticketId: string, blockedBy?: string[]): Promise<void> {
      await h.services.tickets!.transition(SYSTEM, ticketId, {
        to: 'blocked', unblock: { owner: 'human', action: 'provide what is missing' },
        ...(blockedBy ? { blockedBy } : {}),
      });
    }

    it("reopens a blocked ticket before a resolving wake's turn does any work", async () => {
      const ticketId = seedTicket(h, { status: 'in_progress' });
      const workerId = h.addWorker(ticketId, { runtimeId: 'fake', worktreePath: null });
      await blockTicket(ticketId);
      expect(statusOf(ticketId)).toBe('blocked');

      runtime.queue.push(resultFor(workerId, { structured: { state: 'working', summary: 'back to it', tickets: [], knowledge: { recorded: false, reason: 'mid-task' } } }));
      h.services.wake!.enqueue(workerId, { source: 'conductor_request', reason: 'here is the answer' });
      const run = await runOnce(workerId);

      expect(run.status).toBe('succeeded');
      expect(statusOf(ticketId)).toBe('in_progress');
      expect(h.services.tickets!.comments(ticketId).some((c) => c.body.includes('resumed after the block was answered'))).toBe(true);
    });

    it('leaves a blocked ticket blocked when only non-resolving wakes start the turns', async () => {
      const ticketId = seedTicket(h, { status: 'in_progress' });
      const workerId = h.addWorker(ticketId, { runtimeId: 'fake', worktreePath: null });
      await blockTicket(ticketId);

      for (const source of ['self_scheduled', 'routine', 'system', 'retry'] as const) {
        h.services.wake!.enqueue(workerId, { source, reason: 'tick' });
        runtime.queue.push(resultFor(workerId, { structured: { state: 'idle', summary: 'still waiting', tickets: [], knowledge: { recorded: false, reason: 'blocked' } } }));
        await runOnce(workerId);
        expect(statusOf(ticketId), `${source} must not reopen the ticket`).toBe('blocked');
      }
      // No status churn (one transition, the block) and no fresh wake to the block's owner.
      expect(h.db.get<{ n: number }>("SELECT COUNT(*) n FROM wakeups WHERE source = 'ticket_blocked'")!.n).toBe(0);
      expect(h.db.get<{ n: number }>("SELECT COUNT(*) n FROM activity WHERE ticket_id = ? AND action = 'ticket.transition'", [ticketId])!.n).toBe(1);
    });

    it('does not reopen a blocked ticket when a pre-turn gate fails before the turn starts', async () => {
      // The curation freshness gate runs before the restore; a ticket it leaves blocked must not have
      // been reopened and re-blocked silently, which is why the restore sits after the gate.
      const ticketId = seedTicket(h, { status: 'in_progress', originKind: 'curation' });
      const workerId = h.addWorker(ticketId, { runtimeId: 'fake', worktreePath: null, branch: null });
      await blockTicket(ticketId);
      h.services.projects = { fetch: vi.fn(async () => { throw new Error('offline'); }) } as never;

      h.services.wake!.enqueue(workerId, { source: 'human_message', reason: 'resume' });
      const run = await runOnce(workerId);

      expect(run.status).toBe('failed');
      expect(run.errorCode).toBe('checkout_stale');
      expect(statusOf(ticketId)).toBe('blocked');
      // Only the block that set the ticket up: no restore transition happened before the gate, and the
      // gate's own block was refused (already blocked). A misplaced restore would add its own move out
      // and back, taking this count to 3.
      expect(h.db.get<{ n: number }>("SELECT COUNT(*) n FROM activity WHERE ticket_id = ? AND action = 'ticket.transition'", [ticketId])!.n).toBe(1);
    });

    it('leaves a blocked ticket blocked while a blockedBy ticket is unfinished', async () => {
      const blockerId = seedTicket(h, { number: 2, identifier: 'TST-2', title: 'the blocker' });
      const ticketId = seedTicket(h, { status: 'in_progress' });
      const workerId = h.addWorker(ticketId, { runtimeId: 'fake', worktreePath: null });
      await blockTicket(ticketId, [blockerId]);

      runtime.queue.push(resultFor(workerId, { structured: { state: 'idle', summary: 'blocked on TST-2', tickets: [], knowledge: { recorded: false, reason: 'blocked' } } }));
      h.services.wake!.enqueue(workerId, { source: 'conductor_request', reason: 'go' });
      await runOnce(workerId);

      expect(statusOf(ticketId)).toBe('blocked');
    });

    it('does not reopen again without another resolving wake when the worker re-blocks', async () => {
      const ticketId = seedTicket(h, { status: 'in_progress' });
      const workerId = h.addWorker(ticketId, { runtimeId: 'fake', worktreePath: null });
      await blockTicket(ticketId);

      runtime.queue.push(resultFor(workerId, async () => {
        await h.services.tickets!.transition(SYSTEM, ticketId, { to: 'blocked', unblock: { owner: 'human', action: 'still missing X' } });
        return { structured: { state: 'blocked', summary: 'still stuck', tickets: [], knowledge: { recorded: false, reason: 'blocked' } } };
      }));
      h.services.wake!.enqueue(workerId, { source: 'conductor_request', reason: 'answer' });
      await runOnce(workerId);

      expect(statusOf(ticketId)).toBe('blocked');
      expect(h.db.get<{ n: number }>("SELECT COUNT(*) n FROM wakeups WHERE agent_id = ? AND status = 'queued'", [workerId])!.n).toBe(0);
    });

    it('reopens a blocked ticket when a human leaves a comment', async () => {
      const ticketId = seedTicket(h, { status: 'in_progress' });
      const workerId = h.addWorker(ticketId, { runtimeId: 'fake', worktreePath: null });
      await blockTicket(ticketId);

      // The real path, not a hand-built wake: `tickets.comment` must carry the human as requester.
      h.services.tickets!.comment(HUMAN, ticketId, 'here is the answer, go');
      runtime.queue.push(resultFor(workerId, { structured: { state: 'working', summary: 'resumed', tickets: [], knowledge: { recorded: false, reason: 'mid-task' } } }));
      await runOnce(workerId);

      expect(statusOf(ticketId)).toBe('in_progress');
    });

    it("does not reopen a blocked ticket for an agent's comment", async () => {
      const ticketId = seedTicket(h, { status: 'in_progress' });
      const workerId = h.addWorker(ticketId, { runtimeId: 'fake', worktreePath: null });
      await blockTicket(ticketId);

      // A weaver/worker comment wakes the worker through no path at all — it must not even queue one.
      h.services.tickets!.comment({ kind: 'agent', id: h.conductorId }, ticketId, 'noted, carry on');
      expect(h.db.get<{ n: number }>("SELECT COUNT(*) n FROM wakeups WHERE agent_id = ? AND source = 'ticket_comment' AND status = 'queued'", [workerId])!.n).toBe(0);

      // And if an agent-tagged comment wake does reach the worker, the predicate refuses it.
      h.services.wake!.enqueue(workerId, { source: 'ticket_comment', reason: 'agent tag', requestedBy: { kind: 'agent', id: 'ag-1' } });
      runtime.queue.push(resultFor(workerId, { structured: { state: 'idle', summary: 'still waiting', tickets: [], knowledge: { recorded: false, reason: 'blocked' } } }));
      await runOnce(workerId);
      expect(statusOf(ticketId)).toBe('blocked');
    });

    it('restores quietly: no hand-off wake on approved, no merge-card churn on in_review', async () => {
      // `approved`: the restore must not enqueue the ticket_assigned wake first entering it sends.
      const approvedId = seedTicket(h, { kind: 'change', status: 'approved' });
      const approvedWorker = h.addWorker(approvedId, { runtimeId: 'fake', worktreePath: null });
      await blockTicket(approvedId);
      runtime.queue.push(resultFor(approvedWorker, { structured: { state: 'working', summary: 'resumed', tickets: [], knowledge: { recorded: false, reason: 'mid-task' } } }));
      h.services.wake!.enqueue(approvedWorker, { source: 'conductor_request', reason: 'go' });
      await runOnce(approvedWorker);
      expect(statusOf(approvedId)).toBe('approved');
      expect(h.db.get<{ n: number }>("SELECT COUNT(*) n FROM wakeups WHERE agent_id = ? AND source = 'ticket_assigned'", [approvedWorker])!.n).toBe(0);

      // `in_review`: the open, reviewed merge card must survive untouched.
      const reviewId = seedTicket(h, { number: 3, identifier: 'TST-3', kind: 'change', status: 'in_review' });
      const reviewWorker = h.addWorker(reviewId, { runtimeId: 'fake', worktreePath: null });
      h.services.tickets!.addWorkProduct(SYSTEM, reviewId, { type: 'pull_request', url: 'https://example.com/pr/2' });
      const cardId = newId();
      h.db.insert('decisions', {
        id: cardId, workspaceId: h.workspaceId, ticketId: reviewId, kind: 'merge_approval', owner: 'human',
        title: 'Approve the merge', context: '', optionsJson: [], allowFreeText: 1, status: 'open',
        weaverReviewStatus: 'looked', createdAt: nowIso(),
      });
      await blockTicket(reviewId);
      runtime.queue.push(resultFor(reviewWorker, { structured: { state: 'idle', summary: 'waiting on review', tickets: [], knowledge: { recorded: false, reason: 'waiting' } } }));
      h.services.wake!.enqueue(reviewWorker, { source: 'conductor_request', reason: 'go' });
      await runOnce(reviewWorker);
      expect(statusOf(reviewId)).toBe('in_review');
      expect(h.db.get<{ status: string; weaverReviewStatus: string | null }>(
        'SELECT status, weaver_review_status AS weaverReviewStatus FROM decisions WHERE id = ?', [cardId],
      )).toMatchObject({ status: 'open', weaverReviewStatus: 'looked' });
      expect(h.db.get<{ n: number }>(
        "SELECT COUNT(*) n FROM decisions WHERE ticket_id = ? AND kind = 'merge_approval'", [reviewId],
      )!.n).toBe(1);
    });
  });

  describe('checking a held merge review at turn end (VS-365)', () => {
    beforeEach(() => { h.services.tickets = createTicketsService(h.ctx, h.deps); });

    it('checks the held head after a worker turn on a ticket', async () => {
      const ticketId = seedTicket(h, { kind: 'change', status: 'in_review' });
      const workerId = h.addWorker(ticketId, { runtimeId: 'fake', worktreePath: null });
      const spy = vi.spyOn(h.services.tickets!, 'noteHeldReviewHead').mockResolvedValue({ woken: false });
      runtime.queue.push(resultFor(workerId, { structured: { state: 'idle', summary: 'waiting', tickets: [], knowledge: { recorded: false, reason: 'waiting' } } }));
      h.services.wake!.enqueue(workerId, { source: 'conductor_request', reason: 'go' });

      await runOnce(workerId);

      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalledWith({ kind: 'system', id: null }, ticketId);
    });

    it('does not check for a turn whose agent holds no ticket', async () => {
      const spy = vi.spyOn(h.services.tickets!, 'noteHeldReviewHead').mockResolvedValue({ woken: false });
      runtime.queue.push({ structured: { state: 'idle', summary: 'hi', tickets: [], knowledge: { recorded: false, reason: 'no-op' } } });
      h.services.wake!.enqueue(h.conductorId, { source: 'human_message', reason: 'hi' });

      await runOnce(h.conductorId);

      expect(spy).not.toHaveBeenCalled();
    });
  });

  describe('republishing a revised plan at turn end (VS-364)', () => {
    beforeEach(() => { h.services.tickets = createTicketsService(h.ctx, h.deps); });

    it('asks the tickets service to republish after a worker turn on a ticket', async () => {
      const ticketId = seedTicket(h, { status: 'proposed', kind: 'change' });
      const workerId = h.addWorker(ticketId, { runtimeId: 'fake', worktreePath: null });
      const spy = vi.spyOn(h.services.tickets!, 'republishRevisedPlan').mockResolvedValue({ republished: false, reason: 'unchanged' });
      runtime.queue.push({ structured: { state: 'idle', summary: 'nothing changed', tickets: [], knowledge: { recorded: false, reason: 'no-op' } } });
      h.services.wake!.enqueue(workerId, { source: 'ticket_comment', reason: 'go' });

      await runOnce(workerId);

      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalledWith({ kind: 'system', id: null }, ticketId);
    });

    it('does not republish for a turn whose agent holds no ticket', async () => {
      const spy = vi.spyOn(h.services.tickets!, 'republishRevisedPlan').mockResolvedValue({ republished: false, reason: 'not proposed' });
      runtime.queue.push({ structured: { state: 'idle', summary: 'hello', tickets: [], knowledge: { recorded: false, reason: 'no-op' } } });
      h.services.wake!.enqueue(h.conductorId, { source: 'human_message', reason: 'hi' });

      await runOnce(h.conductorId);

      expect(spy).not.toHaveBeenCalled();
    });
  });
});

describe('dispatcher', () => {
  let h: TestHarness;
  let runtime: FakeRuntime;
  let dispatcher: CoreDispatcher;

  beforeEach(() => {
    h = makeHarness({ config: { defaults: { maxConcurrentRuns: 1 } as never } });
    runtime = new FakeRuntime();
    runtime.delayMs = 30;
    h.ctx.registries.runtimes.set('fake', runtime);
    h.services.wake = createWakeService(h.ctx, h.deps);
    h.services.runs = createRunsService(h.ctx, h.deps);
    dispatcher = createDispatcher(h.ctx, h.deps);
  });
  afterEach(async () => { await dispatcher.stop(); h.cleanup(); });

  it('honours the host concurrency cap', async () => {
    const ticketId = seedTicket(h);
    const workerId = h.addWorker(ticketId, { runtimeId: 'fake', worktreePath: null });
    h.services.wake!.enqueue(h.conductorId, { source: 'human_message', reason: 'a' });
    h.services.wake!.enqueue(workerId, { source: 'ticket_assigned', reason: 'b' });

    await dispatcher.tick();
    expect(dispatcher.running()).toBe(1);
    await dispatcher.drain();
    expect(h.db.all('SELECT * FROM runs')).toHaveLength(1);

    await dispatcher.tick();
    await dispatcher.drain();
    expect(h.db.all('SELECT * FROM runs')).toHaveLength(2);
  });

  it('never starts a second run for an agent that is already running', async () => {
    h.services.wake!.enqueue(h.conductorId, { source: 'human_message', reason: 'a' });
    const first = dispatcher.tick();
    h.db.insert('wakeups', { id: newId(), workspaceId: h.workspaceId, agentId: h.conductorId, source: 'human_message', reason: 'b', payloadJson: {}, status: 'queued', createdAt: nowIso() });
    await dispatcher.tick();
    await first;
    await dispatcher.drain();
    expect(h.db.all('SELECT * FROM runs')).toHaveLength(1);
  });

  it('respects the project worker cap', async () => {
    h.ctx.config.defaults.maxConcurrentRuns = 6;
    h.db.update('projects', h.projectId, { maxWorkers: 1 });
    const t1 = seedTicket(h);
    const t2 = seedTicket(h, { number: 2, identifier: 'TST-2' });
    const w1 = h.addWorker(t1, { runtimeId: 'fake', worktreePath: null });
    const w2 = h.addWorker(t2, { runtimeId: 'fake', worktreePath: null });
    h.services.wake!.enqueue(w1, { source: 'ticket_assigned', reason: 'one' });
    h.services.wake!.enqueue(w2, { source: 'ticket_assigned', reason: 'two' });
    await dispatcher.tick();
    expect(dispatcher.running()).toBe(1);
    await dispatcher.drain();
  });

  it('does not dispatch a wake that is not due yet', async () => {
    h.services.wake!.enqueue(h.conductorId, { source: 'retry', reason: 'later', notBefore: new Date(Date.now() + 60_000).toISOString() });
    await dispatcher.tick();
    await dispatcher.drain();
    expect(h.db.all('SELECT * FROM runs')).toHaveLength(0);
  });

  it('starts a worker turn for its own scheduled wake only once the time passes (VS-317)', async () => {
    const ticketId = seedTicket(h);
    const workerId = h.addWorker(ticketId, { runtimeId: 'fake', worktreePath: null });
    const scheduled = h.services.wake!.scheduleSelfWake(workerId, { reason: 'check the sweep', delayMs: 20 * 60_000 });

    // The worker's turn has ended and twenty minutes have not passed.
    await dispatcher.tick();
    await dispatcher.drain();
    expect(h.db.all('SELECT * FROM runs')).toHaveLength(0);

    // Time passes: the scheduled wake is now due.
    h.db.update('wakeups', scheduled.id, { notBefore: new Date(Date.now() - 1_000).toISOString() });
    await dispatcher.tick();
    await dispatcher.drain();
    const runs = h.db.all<{ id: string; wakeupIds: string[] }>('SELECT * FROM runs');
    expect(runs).toHaveLength(1);
    expect(runs[0]!.wakeupIds).toContain(scheduled.id);
    // The wake was claimed by this run and its reason travelled with it.
    const claimed = h.db.get<{ status: string; reason: string; runId: string | null }>('SELECT status, reason, run_id FROM wakeups WHERE id = ?', [scheduled.id])!;
    expect(claimed.status).not.toBe('queued');
    expect(claimed.runId).toBe(runs[0]!.id);
    expect(claimed.reason).toBe('check the sweep');
  });

});

describe('redaction', () => {
  it('scrubs secret values and Authorization headers anywhere in the payload', () => {
    const redact = makeRedactor(['supersecretvalue']);
    const out = redact({ a: 'x supersecretvalue y', nested: [{ h: 'Authorization: Bearer abcdefghijklmno' }] }) as { a: string; nested: Array<{ h: string }> };
    expect(out.a).toBe('x [redacted] y');
    expect(out.nested[0]!.h).toContain('[redacted]');
  });

  it('leaves short values alone so ordinary text is not mangled', () => {
    const redact = makeRedactor(['abc']);
    expect(redact({ t: 'abc def' })).toEqual({ t: 'abc def' });
  });
});
