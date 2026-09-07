import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { newId, nowIso } from '@agent-conductor/db';
import { FakeRuntime, type TurnInput, type TurnSink, type TurnResult } from '@agent-conductor/runtime-sdk';
import { RECORDED_RUN_PHASES, RUN_PHASES, type Decision, type Run, type Wakeup } from '@agent-conductor/shared';
import { makeHarness, type TestHarness } from '../testing/context.js';
import { createDecisionsService } from '../decisions/service.js';
import { createTicketsService } from '../tickets/service.js';
import { createWakeService } from '../wake/index.js';
import { createAccountsService } from '../usage/accounts.js';
import { LOGIN_PAUSE_CODE, loginCorrelationKey } from './authgate.js';
import { createRunsService } from './index.js';
import { createDispatcher, type CoreDispatcher } from './dispatcher.js';
import { countRetries, executeRun } from './engine.js';
import { makeRedactor } from './engine.js';
import { runTokenSecret, verifyRunToken } from './runtoken.js';

const tick = () => new Promise((r) => setImmediate(r));

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
    h.ctx.config.models = { conductor: { runtime: 'fake', model: null }, workers: { runtime: 'fake', model: null } };
    h.services.wake = createWakeService(h.ctx, h.deps);
    h.services.runs = createRunsService(h.ctx, h.deps);
    dispatcher = createDispatcher(h.ctx, h.deps);
    h.services.dispatcher = dispatcher;
  });
  afterEach(async () => { await dispatcher.stop(); h.cleanup(); });

  async function runOnce(): Promise<Run> {
    await dispatcher.tick();
    await dispatcher.drain();
    return h.db.get<Run>('SELECT * FROM runs ORDER BY created_at DESC LIMIT 1')!;
  }

  it('runs a turn end to end: prompt file, events, usage, session, wake completion', async () => {
    runtime.queue.push({ structured: { state: 'done', summary: 'created the ticket', tickets: [] } });
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
    runtime.queue.push({ structured: { state: 'done', summary: 'done', tickets: [] } });
    h.services.wake!.enqueue(h.conductorId, { source: 'human_message', reason: 'anything' });
    const run = await runOnce();

    const timed = h.services.runs!.phaseTimings(run.id).map((e) => (e.payload as { phase: string }).phase);

    // The conductor has no worktree, so it skips `prepare_worktree` — the one phase that is conditional.
    expect(timed).toEqual(RECORDED_RUN_PHASES.filter((p) => p !== 'prepare_worktree'));
    expect(RECORDED_RUN_PHASES.every((p) => RUN_PHASES.includes(p))).toBe(true);
  });

  it('injects the system prompt on the first turn only and resumes the session afterwards', async () => {
    h.services.wake!.enqueue(h.conductorId, { source: 'human_message', reason: 'one' });
    await runOnce();
    h.services.wake!.enqueue(h.conductorId, { source: 'human_message', reason: 'two' });
    await runOnce();

    expect(runtime.inputs).toHaveLength(2);
    expect(runtime.inputs[0]!.session.isFirstTurn).toBe(true);
    expect(runtime.inputs[0]!.systemPrompt.mode).toBe('inject');
    expect(runtime.inputs[0]!.systemPrompt.text).toContain('conductor');
    expect(runtime.inputs[1]!.session.isFirstTurn).toBe(false);
    expect(runtime.inputs[1]!.systemPrompt.mode).toBe('skip');
    expect(runtime.inputs[1]!.session.ref).toEqual(runtime.inputs[0]!.session.ref ?? expect.anything());
    expect(runtime.inputs[1]!.turnEpoch).toBe(2);
  });

  it('passes the MCP endpoint, the run token and the AC_* environment to the runtime', async () => {
    h.services.wake!.enqueue(h.conductorId, { source: 'system', reason: 'digest' });
    const run = await runOnce();
    const input = runtime.inputs[0]!;
    expect(input.mcpServers.agentconductor).toMatchObject({ type: 'http', url: `${h.ctx.loopbackUrl}/mcp/runs/${run.id}` });
    const authHeader = input.mcpServers.agentconductor!.headers!.Authorization!;
    expect(authHeader.startsWith('Bearer rt_')).toBe(true);
    expect(input.env.AC_RUN_TOKEN).toBe(authHeader.slice('Bearer '.length));
    expect(input.env.AC_RUN_ID).toBe(run.id);
    expect(input.env.AC_AGENT_KIND).toBe('conductor');
    expect(input.env.AC_WORKSPACE_ID).toBe(h.workspaceId);
    expect(input.outputSchema).toBeTruthy();
    const claims = await verifyRunToken(runTokenSecret(h.db), input.env.AC_RUN_TOKEN!);
    expect(claims).toMatchObject({ workspaceId: h.workspaceId, runId: run.id, agentId: h.conductorId, agentKind: 'conductor' });
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

  it('marks needs_decision liveness from the structured report', async () => {
    runtime.queue.push({ structured: { state: 'needs_decision', summary: 'asked the human', tickets: [] } });
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
    h.ctx.config.models = { ...h.ctx.config.models, conductor: { runtime: 'nope', model: null } };
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

  it('can execute a run directly for a bare agent', async () => {
    const runId = newId();
    h.db.insert('runs', {
      id: runId, workspaceId: h.workspaceId, agentId: h.conductorId, wakeupIdsJson: [], runtimeId: 'fake',
      status: 'queued', turnEpoch: 7, cwd: h.ctx.paths.conductor, createdAt: nowIso(),
    });
    const run = await executeRun(h.ctx, h.deps, runId);
    expect(run.status).toBe('succeeded');
    expect(run.turnEpoch).toBe(7);
  });

  // VS-77: a turn's runtime, model and effort come from the workspace's two model settings, and
  // from nothing else. These are the tests that keep the old fallback chain from growing back.
  describe('resolving what a turn runs on', () => {
    /** A second adapter, so "the other runtime" is a real registration rather than a missing one. */
    let other: FakeRuntime;
    beforeEach(() => { other = new FakeRuntime(); h.ctx.registries.runtimes.set('other', other); });

    it('launches the conductor on the conductor setting', async () => {
      h.ctx.config.models.conductor = { runtime: 'fake', model: 'claude-fable-5-1', effort: 'low' };
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

    it('sends the two kinds to their own settings in the same workspace', async () => {
      h.ctx.config.models = {
        conductor: { runtime: 'fake', model: 'the-conductor-model' },
        workers: { runtime: 'other', model: 'the-worker-model' },
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

      h.ctx.config.models.conductor = { runtime: 'other', model: 'the-new-model' };
      h.services.wake!.enqueue(h.conductorId, { source: 'human_message', reason: 'second' });
      const second = await runOnce();

      expect(other.inputs.at(-1)!.model).toBe('the-new-model');
      expect(second.runtimeId).toBe('other');
    });

    it('records on the run what it really ran on, and leaves it there when the setting moves on', async () => {
      h.ctx.config.models.conductor = { runtime: 'fake', model: 'the-model-it-ran-on' };
      h.services.wake!.enqueue(h.conductorId, { source: 'human_message', reason: 'go' });
      const run = await runOnce();
      expect(run.runtimeId).toBe('fake');

      h.ctx.config.models.conductor = { runtime: 'other', model: 'something-else' };
      const stored = h.db.get<Run>('SELECT * FROM runs WHERE id = ?', [run.id])!;
      expect(stored.runtimeId).toBe('fake');
      // The adapter reported `fake-1`, and what the runtime says beats what the setting asked for.
      expect(stored.model).toBe('fake-1');
    });

    it('fails the turn naming the runtime the setting points at, rather than using another', async () => {
      h.ctx.config.models.conductor = { runtime: 'nope', model: null };
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

      h.ctx.config.models.conductor = { runtime: 'other', model: null };
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

      h.ctx.config.models.conductor = { runtime: 'fake', model: 'a-different-model' };
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
      runtime.queue.push({ structured: { state: 'working', summary: 'first', tickets: [] } });
      h.services.wake!.enqueue(h.conductorId, { source: 'human_message', reason: 'go' });
      const first = await runOnce();
      expect(first.retryOfRunId).toBeNull();

      runtime.queue.push({ structured: { state: 'working', summary: 'second', tickets: [] } });
      h.services.wake!.enqueue(h.conductorId, { source: 'retry', reason: 'retry after overloaded', payload: { retryOfRunId: first.id } });
      expect((await runOnce()).retryOfRunId).toBe(first.id);
    });

    // A retry enqueued while an ordinary wake is already queued is coalesced into it and its payload
    // ends up in that wake's `bundle`; the link has to survive that.
    it('records the link when the retry wake is coalesced into an ordinary one', async () => {
      runtime.queue.push({ structured: { state: 'working', summary: 'first', tickets: [] } });
      h.services.wake!.enqueue(h.conductorId, { source: 'human_message', reason: 'go' });
      const first = await runOnce();

      runtime.queue.push({ structured: { state: 'working', summary: 'second', tickets: [] } });
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
    async function failOnce(result: Record<string, unknown> | ((input: TurnInput) => Record<string, unknown>), n = 1): Promise<{ ticketId: string; workerId: string }> {
      const ticketId = seedTicket(h, { status: 'in_progress', number: n, identifier: `TST-${n}` });
      const workerId = h.addWorker(ticketId, { runtimeId: 'fake', worktreePath: null });
      runtime.queue.push(result as never);
      h.services.wake!.enqueue(workerId, { source: 'ticket_assigned', reason: 'TST-1: Add a README badge' });
      await runOnce();
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
        await failAuth(2);
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
        runtime.queue.push({ structured: { state: 'working', summary: 'back', tickets: [] } } as never);
        await executeRun(h.ctx, h.deps, runId);
        await tick();

        expect(h.db.get<Run>('SELECT * FROM runs WHERE id = ?', [runId])!.status).toBe('succeeded');
        expect(h.services.accounts!.gatedRuntimes()).toEqual([]);
      });
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
      runtime.queue.push({ structured: { state: 'working', summary: 'back on it', tickets: [] } });
      h.services.wake!.enqueue(workerId, { source: 'retry', reason: 'retry after boom' });
      await runOnce();
      await tick();

      expect(openFor(ticketId)).toHaveLength(0);
      expect(h.db.get<{ status: string }>('SELECT status FROM decisions WHERE id = ?', [card.id])!.status).toBe('withdrawn');
      // A turn taken is a pause spent: the free-text reason and its structured twin go together.
      expect(h.db.get<{ pauseReason: string | null; pauseDetail: unknown }>('SELECT pause_reason, pause_detail_json FROM agents WHERE id = ?', [workerId]))
        .toMatchObject({ pauseReason: null, pauseDetail: null });
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
