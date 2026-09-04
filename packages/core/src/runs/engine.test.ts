import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { newId, nowIso } from '@openconductor/db';
import { FakeRuntime, type TurnInput, type TurnSink, type TurnResult } from '@openconductor/runtime-sdk';
import type { Run, Wakeup } from '@openconductor/shared';
import { makeHarness, type TestHarness } from '../testing/context.js';
import { createWakeService } from '../wake/index.js';
import { createRunsService } from './index.js';
import { createDispatcher, type CoreDispatcher } from './dispatcher.js';
import { executeRun } from './engine.js';
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
    h.db.update('agents', h.conductorId, { runtimeId: 'fake' });
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

  it('passes the MCP endpoint, the run token and the OC_* environment to the runtime', async () => {
    h.services.wake!.enqueue(h.conductorId, { source: 'system', reason: 'digest' });
    const run = await runOnce();
    const input = runtime.inputs[0]!;
    expect(input.mcpServers.openconductor).toMatchObject({ type: 'http', url: `${h.ctx.loopbackUrl}/mcp/runs/${run.id}` });
    const authHeader = input.mcpServers.openconductor!.headers!.Authorization!;
    expect(authHeader.startsWith('Bearer rt_')).toBe(true);
    expect(input.env.OC_RUN_TOKEN).toBe(authHeader.slice('Bearer '.length));
    expect(input.env.OC_RUN_ID).toBe(run.id);
    expect(input.env.OC_AGENT_KIND).toBe('conductor');
    expect(input.env.OC_WORKSPACE_ID).toBe(h.workspaceId);
    expect(input.outputSchema).toBeTruthy();
    const claims = await verifyRunToken(runTokenSecret(h.db), input.env.OC_RUN_TOKEN!);
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
    h.db.update('agents', h.conductorId, { runtimeId: 'nope' });
    h.services.wake!.enqueue(h.conductorId, { source: 'human_message', reason: 'go' });
    const run = await runOnce();
    expect(run.status).toBe('failed');
    expect(run.errorFamily).toBe('tooling');
    expect(run.errorCode).toBe('runtime_unreachable');
  });

  it('redacts the run token from persisted events', async () => {
    class LeakyRuntime extends FakeRuntime {
      override async runTurn(input: TurnInput, sink: TurnSink): Promise<TurnResult> {
        sink.onEvent({ ts: nowIso(), type: 'assistant.text', payload: { text: `curl -H "Authorization: Bearer ${input.env.OC_RUN_TOKEN}"` } });
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

  it('describes the worker ticket and worktree state in the turn prompt', async () => {
    const ticketId = seedTicket(h, { status: 'in_progress' });
    const workerId = h.addWorker(ticketId, { runtimeId: 'fake', worktreePath: null, branch: 'oc/tst-1-add-a-readme-badge' });
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
    h.db.update('agents', h.conductorId, { runtimeId: 'fake' });
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
