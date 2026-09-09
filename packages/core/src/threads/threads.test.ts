import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeHarness, fakeWake, type TestHarness } from '../testing/context.js';
import { createProjectsService } from '../projects/index.js';
import { createTicketsService } from '../tickets/service.js';
import { createThreadsService, REPLY_EXCERPT_CHARS } from './service.js';
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

  it('stores a multi-line body verbatim, on the thread and on the ticket it lands as a comment on', async () => {
    // The chat renders the line breaks a human typed, so the daemon must keep them: no trimming,
    // no rewrapping, no normalising of the blank lines between paragraphs.
    const body = 'first line\nsecond line\n\n\nlast paragraph\n\n```\npnpm test\n```\n';
    const ticket = tickets.create(HUMAN, { kind: 'change', title: 'Formatting', projectId: h.projectId, assigneeRoleId: h.roleId });
    h.addWorker(ticket.id);
    const t = threads.bindOrGet('web', 'web-nl', null, 'Victor');
    threads.bindTicket(HUMAN, t.id, ticket.id);
    const msg = await threads.inbound(HUMAN, t.id, body);

    expect(msg.body).toBe(body);
    expect(threads.messages(t.id).map((m) => m.body)).toEqual([body]);
    expect(tickets.comments(ticket.id).map((c) => c.body)).toContain(body);
    expect((wake.calls[0]?.input.payload as { body: string }).body).toBe(body);
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

  it('carries the message a reply names onto the message and into the wake payload', async () => {
    const t = threads.bindOrGet('web', 'web-r1', null, 'Victor');
    const asked = await threads.outbound(CONDUCTOR, t.id, 'Should I ship the selector behind a flag?');
    const msg = await threads.inbound(HUMAN, t.id, 'yes, do it', { replyToMessageId: asked.id });

    expect(msg.replyToMessageId).toBe(asked.id);
    expect(msg.replyToExcerpt).toBe('Should I ship the selector behind a flag?');
    const stored = threads.messages(t.id).find((m) => m.id === msg.id);
    expect(stored?.replyToMessageId).toBe(asked.id);
    expect(stored?.replyToExcerpt).toBe('Should I ship the selector behind a flag?');
    expect(wake.calls[0]?.input.payload).toEqual(
      expect.objectContaining({ messageId: msg.id, replyToMessageId: asked.id, replyToExcerpt: 'Should I ship the selector behind a flag?' }),
    );
  });

  it('reports no replied-to message explicitly when a message answers nothing', async () => {
    const t = threads.bindOrGet('web', 'web-r2', null);
    const msg = await threads.inbound(HUMAN, t.id, 'just a thought');

    expect(msg.replyToMessageId).toBeNull();
    expect(msg.replyToExcerpt).toBeNull();
    const stored = threads.messages(t.id)[0];
    expect(stored?.replyToMessageId).toBeNull();
    expect(stored?.replyToExcerpt).toBeNull();
    expect(wake.calls[0]?.input.payload).toEqual(
      expect.objectContaining({ threadId: t.id, messageId: msg.id, body: 'just a thought', replyToMessageId: null, replyToExcerpt: null }),
    );
  });

  it('bounds the excerpt of a long replied-to message on both the read and the payload', async () => {
    const t = threads.bindOrGet('web', 'web-r3', null);
    const long = 'x'.repeat(REPLY_EXCERPT_CHARS + 250);
    const asked = await threads.outbound(CONDUCTOR, t.id, long);
    const msg = await threads.inbound(HUMAN, t.id, 'ok', { replyToMessageId: asked.id });

    expect(msg.replyToExcerpt).toHaveLength(REPLY_EXCERPT_CHARS);
    expect(threads.messages(t.id).find((m) => m.id === msg.id)?.replyToExcerpt).toHaveLength(REPLY_EXCERPT_CHARS);
    expect((wake.calls[0]?.input.payload as { replyToExcerpt: string }).replyToExcerpt).toHaveLength(REPLY_EXCERPT_CHARS);
  });

  it('still returns the quote when the replied-to message falls outside the read window', async () => {
    const t = threads.bindOrGet('web', 'web-r4', null);
    const asked = await threads.outbound(CONDUCTOR, t.id, 'which one did you mean?');
    for (let i = 0; i < 3; i++) await threads.outbound(CONDUCTOR, t.id, `filler ${i}`);
    const msg = await threads.inbound(HUMAN, t.id, 'the second', { replyToMessageId: asked.id });

    // A page that cannot contain the referenced message: the excerpt is joined in, not resolved by the caller.
    const page = threads.messages(t.id, { limit: 1 });
    expect(page.map((m) => m.id)).toEqual([msg.id]);
    expect(page[0]?.replyToExcerpt).toBe('which one did you mean?');
  });

  it('rejects a reply to an unknown message, storing no message and waking nobody', async () => {
    const t = threads.bindOrGet('web', 'web-r5', null);
    await expect(threads.inbound(HUMAN, t.id, 'answering the void', { replyToMessageId: 'nope' })).rejects.toThrowError(
      expect.objectContaining({ code: 'not_found' }),
    );
    expect(threads.messages(t.id)).toHaveLength(0);
    expect(wake.calls).toHaveLength(0);
  });

  it('rejects a reply naming a message of another thread', async () => {
    const other = threads.bindOrGet('web', 'web-r6a', null);
    const elsewhere = await threads.outbound(CONDUCTOR, other.id, 'a question over here');
    const t = threads.bindOrGet('web', 'web-r6b', null);

    await expect(threads.inbound(HUMAN, t.id, 'crossing over', { replyToMessageId: elsewhere.id })).rejects.toThrowError(
      expect.objectContaining({ code: 'not_found' }),
    );
    expect(threads.messages(t.id)).toHaveLength(0);
    expect(wake.calls).toHaveLength(0);
  });

  it('references only the message named, following no chain of replies', async () => {
    const t = threads.bindOrGet('web', 'web-r7', null);
    const first = await threads.outbound(CONDUCTOR, t.id, 'the original question');
    const second = await threads.inbound(HUMAN, t.id, 'a first answer', { replyToMessageId: first.id });
    const third = await threads.inbound(HUMAN, t.id, 'actually, about that answer', { replyToMessageId: second.id });

    expect(third.replyToMessageId).toBe(second.id);
    expect(third.replyToExcerpt).toBe('a first answer');
  });

  it('stores the reply reference on a ticket-bound thread without raising a human_message wake', async () => {
    const ticket = tickets.create(HUMAN, { kind: 'change', title: 'Dark mode', projectId: h.projectId, assigneeRoleId: h.roleId });
    const workerId = h.addWorker(ticket.id);
    const t = threads.bindOrGet('web', 'web-r8', null, 'Victor');
    const asked = await threads.outbound(CONDUCTOR, t.id, 'which page did you mean?');
    threads.bindTicket(HUMAN, t.id, ticket.id);
    const msg = await threads.inbound(HUMAN, t.id, 'the settings page', { replyToMessageId: asked.id });

    expect(msg.replyToMessageId).toBe(asked.id);
    expect(tickets.comments(ticket.id).map((c) => c.body)).toContain('the settings page');
    expect(wake.calls).toEqual([
      expect.objectContaining({ agentId: workerId, input: expect.objectContaining({ source: 'ticket_comment' }) }),
    ]);
  });

  it('gives the conductor own outbound messages no reply reference', async () => {
    const t = threads.bindOrGet('web', 'web-r9', null);
    const out = await threads.outbound(CONDUCTOR, t.id, 'on it');
    expect(out.replyToMessageId).toBeNull();
    expect(out.replyToExcerpt).toBeNull();
  });

  it('carries a reply reference on an outbound message the same way an inbound one does', async () => {
    const t = threads.bindOrGet('web', 'web-r10', null);
    const asked = await threads.inbound(HUMAN, t.id, 'which page did you mean by "settings"?');
    const out = await threads.outbound(CONDUCTOR, t.id, 'the account settings page', { replyToMessageId: asked.id });

    expect(out.replyToMessageId).toBe(asked.id);
    expect(out.replyToExcerpt).toBe('which page did you mean by "settings"?');
    const stored = threads.messages(t.id).find((m) => m.id === out.id);
    expect(stored?.replyToMessageId).toBe(asked.id);
    expect(stored?.replyToExcerpt).toBe('which page did you mean by "settings"?');
  });

  it('rejects an outbound reply to an unknown message, storing no message', async () => {
    const t = threads.bindOrGet('web', 'web-r11', null);
    await expect(threads.outbound(CONDUCTOR, t.id, 'answering the void', { replyToMessageId: 'nope' })).rejects.toThrowError(
      expect.objectContaining({ code: 'not_found' }),
    );
    expect(threads.messages(t.id)).toHaveLength(0);
  });

  it('rejects an outbound reply naming a message of another thread', async () => {
    const other = threads.bindOrGet('web', 'web-r12a', null);
    const elsewhere = await threads.inbound(HUMAN, other.id, 'a question over here');
    const t = threads.bindOrGet('web', 'web-r12b', null);

    await expect(threads.outbound(CONDUCTOR, t.id, 'crossing over', { replyToMessageId: elsewhere.id })).rejects.toThrowError(
      expect.objectContaining({ code: 'not_found' }),
    );
    expect(threads.messages(t.id)).toHaveLength(0);
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

  describe('attachments', () => {
    it('stores an attachment on disk and links it to the message, its parts, and the wake payload', async () => {
      const t = threads.bindOrGet('web', 'web-att1', null, 'Victor');
      const bytes = Buffer.from('a screenshot, allegedly');
      const msg = await threads.inbound(HUMAN, t.id, 'look at this', {
        attachments: [{ filename: 'shot.png', mediaType: 'image/png', bytes }],
      });

      expect(msg.parts).toEqual([
        expect.objectContaining({ type: 'attachment', filename: 'shot.png', mediaType: 'image/png', byteSize: bytes.byteLength }),
      ]);
      const stored = threads.messages(t.id)[0];
      expect(stored?.parts).toEqual(msg.parts); // survives a re-read exactly as sent
      const row = h.db.get<{ id: string; storageKey: string }>('SELECT id, storage_key as storageKey FROM attachments WHERE message_id = ?', [msg.id]);
      expect(row).toBeTruthy();
      expect(wake.calls[0]?.input.payload).toEqual(expect.objectContaining({ attachmentIds: [row!.id] }));
    });

    it('rejects an attachment on a ticket-bound thread before storing anything', async () => {
      const ticket = tickets.create(HUMAN, { kind: 'change', title: 'No attachments here', projectId: h.projectId, assigneeRoleId: h.roleId });
      h.addWorker(ticket.id);
      const t = threads.bindOrGet('web', 'web-att2', null, 'Victor');
      threads.bindTicket(HUMAN, t.id, ticket.id);

      await expect(
        threads.inbound(HUMAN, t.id, 'see attached', { attachments: [{ filename: 'x.txt', mediaType: 'text/plain', bytes: Buffer.from('x') }] }),
      ).rejects.toThrowError(expect.objectContaining({ code: 'validation' }));
      expect(threads.messages(t.id)).toHaveLength(0);
      expect(h.db.all('SELECT * FROM attachments')).toHaveLength(0);
    });

    it('a message sent with no attachments carries an empty parts array, exactly as before this capability existed', async () => {
      const t = threads.bindOrGet('web', 'web-att3', null);
      const msg = await threads.inbound(HUMAN, t.id, 'plain text');
      expect(msg.parts).toEqual([]);
    });
  });

  describe('idempotency', () => {
    it('a repeated inbound with the same key returns the stored message and does not wake again', async () => {
      const t = threads.bindOrGet('web', 'web-idem', null, 'Victor');
      const first = await threads.inbound(HUMAN, t.id, 'ship it', { idempotencyKey: 'k1' });
      const again = await threads.inbound(HUMAN, t.id, 'ship it', { idempotencyKey: 'k1' });

      expect(again.id).toBe(first.id);
      expect(threads.messages(t.id)).toHaveLength(1);
      expect(h.db.all('SELECT id FROM thread_messages WHERE thread_id = ?', [t.id])).toHaveLength(1);
      expect(wake.calls).toHaveLength(1);
    });

    it('a call with no key, or a different key, is a new message and a new wake', async () => {
      const t = threads.bindOrGet('web', 'web-idem-2', null, 'Victor');
      const a = await threads.inbound(HUMAN, t.id, 'one');
      const b = await threads.inbound(HUMAN, t.id, 'one');
      const c = await threads.inbound(HUMAN, t.id, 'edited', { idempotencyKey: 'k-a' });
      const d = await threads.inbound(HUMAN, t.id, 'edited again', { idempotencyKey: 'k-b' });

      expect(new Set([a.id, b.id, c.id, d.id]).size).toBe(4);
      expect(threads.messages(t.id)).toHaveLength(4);
      expect(wake.calls).toHaveLength(4);
    });
  });
});
