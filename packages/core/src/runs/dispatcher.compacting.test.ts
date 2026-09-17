/**
 * A session mid-compaction is busy: a turn started now would race the CLI rewriting the same
 * session. The dispatcher must leave the agent's wake queued until compaction clears the flag, so
 * a message sent during compaction is delivered the moment it finishes.
 */
import { newId, nowIso } from '@weave-ai/db';
import { FakeRuntime } from '@weave-ai/runtime-sdk';
import type { Run, Wakeup } from '@weave-ai/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { makeHarness, type TestHarness } from '../testing/context.js';
import { createWakeService } from '../wake/index.js';
import { createRunsService } from './index.js';
import { createDispatcher, type CoreDispatcher } from './dispatcher.js';

const idle = { structured: { state: 'idle', summary: 'nothing to do', tickets: [], knowledge: { recorded: false, reason: 'test fixture' } } };

let h: TestHarness;
let runtime: FakeRuntime;
let dispatcher: CoreDispatcher;

function setup(): void {
  h = makeHarness();
  runtime = new FakeRuntime();
  h.ctx.registries.runtimes.set('fake', runtime);
  h.ctx.config.models = { weaver: { runtime: 'fake', model: null }, workers: { runtime: 'fake', model: null }, workerOptions: [] };
  h.services.wake = createWakeService(h.ctx, h.deps);
  h.services.runs = createRunsService(h.ctx, h.deps);
  dispatcher = createDispatcher(h.ctx, h.deps);
  h.services.dispatcher = dispatcher;
  runtime.queue.push(idle);
}

afterEach(async () => { await dispatcher.stop(); h.cleanup(); });

function seedTicket(): string {
  const id = newId();
  const now = nowIso();
  h.db.insert('tickets', {
    id, workspaceId: h.workspaceId, projectId: h.projectId, number: 1, identifier: 'TST-1', kind: 'change',
    title: 'Do the thing', description: 'Do it.', status: 'todo', priority: 'medium',
    assigneeRoleId: h.roleId, createdByKind: 'human', createdAt: now, updatedAt: now,
  });
  return id;
}

const wakeStatus = (id: string): string => h.db.get<Wakeup>('SELECT * FROM wakeups WHERE id = ?', [id])!.status;
const runCountFor = (agentId: string): number => h.db.all<Run>('SELECT id FROM runs WHERE agent_id = ?', [agentId]).length;

describe('dispatcher holds an agent whose session is compacting', () => {
  it('leaves the wake queued until compaction clears, then claims it', async () => {
    setup();
    const workerId = h.addWorker(seedTicket(), { runtimeId: 'fake', worktreePath: null });
    const now = nowIso();
    h.db.insert('agent_sessions', {
      id: newId(), agentId: workerId, runtimeId: 'fake', status: 'active', turnCount: 0,
      cumulativeUsageJson: {}, compactingAt: now, createdAt: now, updatedAt: now,
    });
    const w = h.services.wake!.enqueue(workerId, { source: 'ticket_comment', reason: 'human asked a follow-up', payload: {} });

    await dispatcher.tick();
    await dispatcher.drain();

    expect(runCountFor(workerId)).toBe(0);
    expect(wakeStatus(w.id)).toBe('queued');

    h.db.run('UPDATE agent_sessions SET compacting_at = NULL WHERE agent_id = ?', [workerId]);
    await dispatcher.tick();
    await dispatcher.drain();

    expect(runCountFor(workerId)).toBe(1);
    expect(wakeStatus(w.id)).not.toBe('queued');
  });
});
