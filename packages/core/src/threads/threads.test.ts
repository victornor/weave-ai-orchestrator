import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeHarness, fakeWake, type TestHarness } from '../testing/context.js';
import { createProjectsService } from '../projects/index.js';
import { createTicketsService } from '../tickets/service.js';
import { createThreadsService } from './service.js';
import type { Actor, ThreadsService, TicketsService } from '../api.js';

const HUMAN: Actor = { kind: 'human', id: 'victor' };
const CONDUCTOR: Actor = { kind: 'agent', id: 'conductor', runId: 'run-1' };
const tick = () => new Promise((r) => setImmediate(r));

describe('threads', () => {
  let h: TestHarness;
  let threads: ThreadsService;
  let tickets: TicketsService;
  let wake: ReturnType<typeof fakeWake>;

  beforeEach(() => {
    h = makeHarness();
    wake = fakeWake();
    h.services.wake = wake as never;
    h.services.decisions = { create: vi.fn(() => ({ id: 'd' })), supersedeForTarget: vi.fn(() => 0) } as never;
    h.services.projects = createProjectsService(h.ctx, h.deps);
    tickets = createTicketsService(h.ctx, h.deps);
    h.services.tickets = tickets;
    threads = createThreadsService(h.ctx, h.deps);
    h.services.threads = threads;
  });
  afterEach(() => h.cleanup());

  it('creates the channel row on demand and returns the same thread on rebind', () => {
    const a = threads.bindOrGet('telegram', 'chat-42', '12345678', 'Victor');
    const b = threads.bindOrGet('telegram', 'chat-42', '12345678');
    expect(b.id).toBe(a.id);
    expect(a.agentId).toBe(h.conductorId);
    expect(h.db.get('SELECT id FROM channels WHERE workspace_id = ? AND kind = ?', [h.workspaceId, 'telegram'])).toBeTruthy();
  });

  it('stores an inbound message and wakes the thread agent', async () => {
    const t = threads.bindOrGet('web', 'web-1', null, 'Victor');
    const msg = await threads.inbound(HUMAN, t.id, 'Add dark mode to the dashboard');
    expect(msg.direction).toBe('inbound');
    expect(threads.messages(t.id).map((m) => m.body)).toEqual(['Add dark mode to the dashboard']);
    expect(wake.calls).toEqual([
      expect.objectContaining({ agentId: h.conductorId, input: expect.objectContaining({ source: 'human_message' }) }),
    ]);
    await tick();
    expect(h.events.some((e) => e.type === 'thread.message')).toBe(true);
  });

  it('routes an inbound message on a ticket-bound thread into a ticket comment that wakes the worker', async () => {
    const ticket = tickets.create(HUMAN, { kind: 'change', title: 'Dark mode', projectId: h.projectId, assigneeRoleId: h.roleId });
    const workerId = h.addWorker(ticket.id);
    const t = threads.bindOrGet('web', 'web-2', null, 'Victor');
    threads.bindTicket(HUMAN, t.id, ticket.id);
    await threads.inbound(HUMAN, t.id, 'please also cover the settings page');

    expect(tickets.comments(ticket.id).map((c) => c.body)).toContain('please also cover the settings page');
    expect(threads.messages(t.id)).toHaveLength(1); // mirrored on the thread as well
    expect(wake.calls).toEqual([
      expect.objectContaining({ agentId: workerId, input: expect.objectContaining({ source: 'ticket_comment' }) }),
    ]);
  });

  it('carries the project a message was sent with onto the message and into the wake payload', async () => {
    const t = threads.bindOrGet('web', 'web-p1', null, 'Victor');
    const msg = await threads.inbound(HUMAN, t.id, 'ship the selector', { projectId: h.projectId });

    expect(msg.projectId).toBe(h.projectId);
    expect(threads.messages(t.id).map((m) => m.projectId)).toEqual([h.projectId]);
    expect(wake.calls[0]).toEqual(
      expect.objectContaining({
        input: expect.objectContaining({
          reason: expect.stringContaining(h.projectSlug),
          payload: expect.objectContaining({ messageId: msg.id, projectId: h.projectId, projectSlug: h.projectSlug }),
        }),
      }),
    );
  });

  it('normalises a project slug to the project id', async () => {
    const t = threads.bindOrGet('web', 'web-p2', null);
    const msg = await threads.inbound(HUMAN, t.id, 'by slug', { projectId: h.projectSlug });
    expect(msg.projectId).toBe(h.projectId);
  });

  it('reports no project explicitly when a message carries none', async () => {
    const t = threads.bindOrGet('web', 'web-p3', null);
    const msg = await threads.inbound(HUMAN, t.id, 'no project here');

    expect(msg.projectId).toBeNull();
    expect(threads.messages(t.id)[0]?.projectId).toBeNull();
    expect(wake.calls[0]?.input.payload).toEqual(
      expect.objectContaining({ threadId: t.id, messageId: msg.id, body: 'no project here', projectId: null, projectSlug: null }),
    );
  });

  it('rejects an unknown project, storing no message and waking nobody', async () => {
    const t = threads.bindOrGet('web', 'web-p4', null);
    await expect(threads.inbound(HUMAN, t.id, 'wrong project', { projectId: 'nope' })).rejects.toThrowError(
      expect.objectContaining({ code: 'not_found' }),
    );
    expect(threads.messages(t.id)).toHaveLength(0);
    expect(wake.calls).toHaveLength(0);
  });

  it('marks outbound web messages delivered and other channels pending', async () => {
    const web = threads.bindOrGet('web', 'web-3', null);
    const tg = threads.bindOrGet('telegram', 'chat-9', null);
    expect((await threads.outbound(CONDUCTOR, web.id, 'on it')).deliveryStatus).toBe('delivered');
    expect((await threads.outbound(CONDUCTOR, tg.id, 'on it')).deliveryStatus).toBe('pending');
    await tick();
    expect(h.events.filter((e) => e.type === 'thread.message')).toHaveLength(2);
  });

  it('picks the primary thread, preferring the flagged one then the most recent', async () => {
    const first = threads.bindOrGet('web', 'web-a', null);
    const second = threads.bindOrGet('telegram', 'chat-b', null);
    expect(threads.primaryThread()?.id).toBe(first.id);
    h.db.run('UPDATE channel_threads SET is_primary = 0 WHERE id = ?', [first.id]);
    await threads.outbound(CONDUCTOR, second.id, 'hello');
    expect(threads.primaryThread()?.id).toBe(second.id);
  });

  it('notifyHuman creates a web thread when there is none', async () => {
    expect(threads.primaryThread()).toBeNull();
    await threads.notifyHuman(CONDUCTOR, { text: 'ACME-1 landed' });
    const primary = threads.primaryThread();
    expect(primary).not.toBeNull();
    expect(threads.messages(primary!.id).map((m) => m.body)).toEqual(['ACME-1 landed']);
  });

  it('paginates messages oldest-first within the page', async () => {
    const t = threads.bindOrGet('web', 'web-page', null);
    for (const body of ['one', 'two', 'three']) await threads.outbound(CONDUCTOR, t.id, body);
    expect(threads.messages(t.id, { limit: 2 }).map((m) => m.body)).toEqual(['two', 'three']);
  });

  it('rejects unknown threads', () => {
    expect(() => threads.get('nope')).toThrowError(expect.objectContaining({ code: 'not_found' }));
  });
});
