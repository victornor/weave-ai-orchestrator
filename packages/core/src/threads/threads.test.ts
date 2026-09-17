import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeHarness, fakeWake, type TestHarness } from '../testing/context.js';
import { createProjectsService } from '../projects/index.js';
import { createRoadmapService } from '../roadmap/index.js';
import { createTicketsService } from '../tickets/service.js';
import { createThreadsService, REPLY_EXCERPT_CHARS } from './service.js';
import type { Actor, RoadmapService, ThreadsService, TicketsService } from '../api.js';

const HUMAN: Actor = { kind: 'human', id: 'victor' };
const CONDUCTOR: Actor = { kind: 'agent', id: 'conductor', runId: 'run-1' };
const tick = () => new Promise((r) => setImmediate(r));

describe('threads', () => {
  let h: TestHarness;
  let threads: ThreadsService;
  let tickets: TicketsService;
  let roadmap: RoadmapService;
  let wake: ReturnType<typeof fakeWake>;

  beforeEach(() => {
    h = makeHarness();
    wake = fakeWake();
    h.services.wake = wake as never;
    h.services.decisions = { create: vi.fn(() => ({ id: 'd' })), supersedeForTarget: vi.fn(() => 0) } as never;
    h.services.projects = createProjectsService(h.ctx, h.deps);
    tickets = createTicketsService(h.ctx, h.deps);
    h.services.tickets = tickets;
    roadmap = createRoadmapService(h.ctx, h.deps);
    h.services.roadmap = roadmap;
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

  it('createOwned makes a fresh, non-primary thread for a non-weaver agent, never matching an existing one (VS-398)', () => {
    const a = threads.createOwned('ag_planner', { humanLabel: 'Redesign the settings page' });
    expect(a.agentId).toBe('ag_planner');
    expect(a.humanLabel).toBe('Redesign the settings page');
    expect(a.ticketId).toBeNull();

    const b = threads.createOwned('ag_planner');
    expect(b.id).not.toBe(a.id);

    // Posting and reading work exactly like any other thread — createOwned only changes creation.
    expect(threads.messages(a.id)).toEqual([]);
    expect(h.db.get('SELECT id FROM channels WHERE workspace_id = ? AND kind = ?', [h.workspaceId, 'web'])).toBeTruthy();
  });

  it('list() excludes a planner-owned thread even when it is the most recently active one, and keeps it primary-first otherwise (VS-398 merge review)', async () => {
    h.db.insert('agents', {
      id: 'agent-planner-1', workspaceId: h.workspaceId, kind: 'planner', name: 'Planner', runtimeId: 'claude',
      homePath: '/tmp/planner-1', createdAt: 't0', updatedAt: 't0',
    });
    const primary = threads.bindOrGet('web', 'web-1', null, 'Victor');
    const plan = threads.createOwned('agent-planner-1', { humanLabel: 'Redesign the settings page' });
    // The plan thread gets the newer activity — on unpatched `list()` (ordered only by recency,
    // no ownership filter) this is exactly what put it ahead of the weaver's own primary thread.
    await threads.inbound(HUMAN, plan.id, 'Let’s plan the redesign');

    const ids = threads.list().map((t) => t.id);
    expect(ids).not.toContain(plan.id);
    expect(ids[0]).toBe(primary.id);
  });

  it('a thread owned by a non-weaver agent posts and reads messages like any other', async () => {
    const t = threads.createOwned('ag_planner');
    const inbound = await threads.inbound(HUMAN, t.id, 'Let’s plan the redesign');
    const outbound = await threads.outbound({ kind: 'agent', id: 'ag_planner' }, t.id, 'Sure, where should we start?');
    expect(threads.messages(t.id).map((m) => ({ direction: m.direction, body: m.body }))).toEqual([
      { direction: 'inbound', body: 'Let’s plan the redesign' },
      { direction: 'outbound', body: 'Sure, where should we start?' },
    ]);
    expect(inbound.authorKind).toBe('human');
    expect(outbound.authorKind).toBe('agent');
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

  it('indexes an inbound and an outbound message into thread_message_search as they are written (VS-320)', async () => {
    const t = threads.bindOrGet('web', 'web-index-1', null, 'Victor');
    const inMsg = await threads.inbound(HUMAN, t.id, 'the deploy runs at midnight');
    const outMsg = await threads.outbound(CONDUCTOR, t.id, 'noted, midnight it is');

    const rows = h.db.all<{ messageId: string; threadId: string; workspaceId: string; body: string }>(
      'SELECT message_id, thread_id, workspace_id, body FROM thread_message_search WHERE thread_id = ? ORDER BY rowid',
      [t.id],
    );
    expect(rows).toEqual([
      { messageId: inMsg.id, threadId: t.id, workspaceId: h.workspaceId, body: 'the deploy runs at midnight' },
      { messageId: outMsg.id, threadId: t.id, workspaceId: h.workspaceId, body: 'noted, midnight it is' },
    ]);
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

  it('carries a human message whole, however long, with no truncation fields', async () => {
    const t = threads.bindOrGet('web', 'web-whole', null);
    const body = 'Delegated to the CLI; daemon never compacts and only Claude declares a compaction. '.repeat(200).slice(0, 20_000);
    const msg = await threads.inbound(HUMAN, t.id, body);

    expect(msg.body).toBe(body);
    expect(threads.message(t.id, msg.id).body).toBe(body);
    const payload = wake.calls[0]?.input.payload as { body: string; truncated?: boolean; bodyLength?: number };
    expect(payload.body).toBe(body);
    expect(payload).not.toHaveProperty('truncated');
    expect(payload).not.toHaveProperty('bodyLength');
  });

  it('reads the full stored body of a message by id, scoped to its thread', async () => {
    const t = threads.bindOrGet('web', 'web-msg-1', null);
    const body = 'z'.repeat(8_500);
    const msg = await threads.inbound(HUMAN, t.id, body);

    const full = threads.message(t.id, msg.id);
    expect(full.body).toBe(body);
    expect(full.id).toBe(msg.id);
  });

  it('rejects reading a message with the wrong threadId, the same as an unknown messageId', async () => {
    const other = threads.bindOrGet('web', 'web-msg-2a', null);
    const elsewhere = await threads.inbound(HUMAN, other.id, 'over here');
    const t = threads.bindOrGet('web', 'web-msg-2b', null);

    expect(() => threads.message(t.id, elsewhere.id)).toThrowError(expect.objectContaining({ code: 'not_found' }));
    expect(() => threads.message(t.id, 'nope')).toThrowError(expect.objectContaining({ code: 'not_found' }));
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
          // The reason names the project by its display label (VS-330); the payload keeps the slug.
          reason: expect.stringContaining('API'),
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

  it('carries a roadmap block of the message project onto the message and into the wake payload (VS-491)', async () => {
    const t = threads.bindOrGet('web', 'web-b1', null, 'Victor');
    const block = roadmap.createBlock(HUMAN, h.projectId, { title: 'UI polish' });
    const msg = await threads.inbound(HUMAN, t.id, 'add the block picker', { projectId: h.projectId, blockId: block.id });

    expect(msg.blockId).toBe(block.id);
    expect(threads.messages(t.id).map((m) => m.blockId)).toEqual([block.id]);
    expect(wake.calls[0]?.input.payload).toEqual(
      expect.objectContaining({
        messageId: msg.id, projectId: h.projectId, projectSlug: h.projectSlug,
        blockId: block.id, blockTitle: 'UI polish',
      }),
    );
  });

  it('reports no block explicitly when a message carries none', async () => {
    const t = threads.bindOrGet('web', 'web-b2', null);
    const msg = await threads.inbound(HUMAN, t.id, 'no block here', { projectId: h.projectId });
    expect(msg.blockId).toBeNull();
    expect(wake.calls[0]?.input.payload).toEqual(expect.objectContaining({ projectId: h.projectId, blockId: null, blockTitle: null }));
  });

  it('rejects a block of another project, storing no message and waking nobody', async () => {
    h.db.insert('projects', {
      id: 'p-other', workspaceId: h.workspaceId, slug: 'other', name: 'Other', gitUrl: 'git@e:o/o.git',
      defaultBranch: 'main', clonePath: '/tmp/o', maxWorkers: 4, worktreeProvider: 'git', openspecEnabled: true,
      policiesJson: {}, status: 'ready', createdAt: 't0', updatedAt: 't0',
    });
    const foreign = roadmap.createBlock(HUMAN, 'p-other', { title: 'Other block' });
    const t = threads.bindOrGet('web', 'web-b3', null);
    await expect(threads.inbound(HUMAN, t.id, 'wrong block', { projectId: h.projectId, blockId: foreign.id })).rejects.toThrowError(
      expect.objectContaining({ code: 'not_found' }),
    );
    expect(threads.messages(t.id)).toHaveLength(0);
    expect(wake.calls).toHaveLength(0);
  });

  it('rejects a block with no project, and an unknown block, as validation and not_found', async () => {
    const t = threads.bindOrGet('web', 'web-b4', null);
    const block = roadmap.createBlock(HUMAN, h.projectId, { title: 'UI polish' });
    await expect(threads.inbound(HUMAN, t.id, 'no project', { blockId: block.id })).rejects.toThrowError(
      expect.objectContaining({ code: 'validation' }),
    );
    await expect(threads.inbound(HUMAN, t.id, 'unknown block', { projectId: h.projectId, blockId: 'nope' })).rejects.toThrowError(
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

  describe('batched reply targets (VS-449)', () => {
    it('links a reply to every waking message and quotes the newest', async () => {
      const t = threads.bindOrGet('web', 'web-batch-1', null);
      const first = await threads.inbound(HUMAN, t.id, 'first question');
      const second = await threads.inbound(HUMAN, t.id, 'second question');
      const out = await threads.outbound(CONDUCTOR, t.id, 'answering both', {
        runId: 'run-batch', defaultReplyToMessageIds: [first.id, second.id],
      });

      expect(out.replyToMessageIds).toEqual([first.id, second.id]);
      expect(out.replyToMessageId).toBe(second.id); // the newest is the single quote target
      expect(out.replyToExcerpt).toBe('second question');
      expect(threads.messages(t.id).find((m) => m.id === out.id)?.replyToMessageIds).toEqual([first.id, second.id]);
    });

    it('links a single waking message exactly as the old single-target default did', async () => {
      const t = threads.bindOrGet('web', 'web-batch-2', null);
      const only = await threads.inbound(HUMAN, t.id, 'are you there?');
      const out = await threads.outbound(CONDUCTOR, t.id, 'yes', { runId: 'run-batch', defaultReplyToMessageIds: [only.id] });
      expect(out.replyToMessageIds).toEqual([only.id]);
      expect(out.replyToMessageId).toBe(only.id);
      expect(out.replyToExcerpt).toBe('are you there?');
    });

    it('does not relink a message an earlier reply in the same turn already answered', async () => {
      const t = threads.bindOrGet('web', 'web-batch-3', null);
      const first = await threads.inbound(HUMAN, t.id, 'one');
      const second = await threads.inbound(HUMAN, t.id, 'two');
      const opening = await threads.outbound(CONDUCTOR, t.id, 'both answered', { runId: 'run-turn', defaultReplyToMessageIds: [first.id, second.id] });
      const followUp = await threads.outbound(CONDUCTOR, t.id, 'one more thing', { runId: 'run-turn', defaultReplyToMessageIds: [first.id, second.id] });

      expect(opening.replyToMessageIds).toEqual([first.id, second.id]);
      expect(followUp.replyToMessageIds).toEqual([]);
      expect(followUp.replyToMessageId).toBeNull();
    });

    it('links a message again when a different turn answers it', async () => {
      const t = threads.bindOrGet('web', 'web-batch-4', null);
      const only = await threads.inbound(HUMAN, t.id, 'still there?');
      await threads.outbound(CONDUCTOR, t.id, 'yes', { runId: 'run-a', defaultReplyToMessageIds: [only.id] });
      const again = await threads.outbound(CONDUCTOR, t.id, 'and again', { runId: 'run-b', defaultReplyToMessageIds: [only.id] });
      expect(again.replyToMessageIds).toEqual([only.id]);
    });

    it('leaves an explicit null unlinked and links an explicit id exactly as given', async () => {
      const t = threads.bindOrGet('web', 'web-batch-5', null);
      const asked = await threads.inbound(HUMAN, t.id, 'which one?');
      const relay = await threads.outbound(CONDUCTOR, t.id, 'unrelated update', { runId: 'run-x', replyToMessageId: null, defaultReplyToMessageIds: [asked.id] });
      expect(relay.replyToMessageIds).toEqual([]);
      expect(relay.replyToMessageId).toBeNull();

      const explicit = await threads.outbound(CONDUCTOR, t.id, 'that one', { runId: 'run-x', replyToMessageId: asked.id, defaultReplyToMessageIds: [asked.id] });
      expect(explicit.replyToMessageIds).toEqual([asked.id]);

      // An explicit id is linked even when an earlier reply in the turn already answered it.
      const second = await threads.outbound(CONDUCTOR, t.id, 'and again', { runId: 'run-x', replyToMessageId: asked.id });
      expect(second.replyToMessageIds).toEqual([asked.id]);
    });

    it('ignores a default candidate from another thread', async () => {
      const other = threads.bindOrGet('web', 'web-batch-6a', null);
      const elsewhere = await threads.inbound(HUMAN, other.id, 'over there');
      const t = threads.bindOrGet('web', 'web-batch-6b', null);
      const out = await threads.outbound(CONDUCTOR, t.id, 'nothing to answer', { runId: 'run-y', defaultReplyToMessageIds: [elsewhere.id] });
      expect(out.replyToMessageIds).toEqual([]);
    });

    it('exposes replyToMessageIds on message() and around(), not only on the write result', async () => {
      const t = threads.bindOrGet('web', 'web-batch-7', null);
      const first = await threads.inbound(HUMAN, t.id, 'a');
      const second = await threads.inbound(HUMAN, t.id, 'b');
      const out = await threads.outbound(CONDUCTOR, t.id, 'both', { runId: 'run-z', defaultReplyToMessageIds: [first.id, second.id] });

      expect(threads.message(t.id, out.id).replyToMessageIds).toEqual([first.id, second.id]);
      expect(threads.around(t.id, out.id).find((m) => m.id === out.id)?.replyToMessageIds).toEqual([first.id, second.id]);
    });

    it('writes the link table for an ordinary single-target reply too', async () => {
      const t = threads.bindOrGet('web', 'web-batch-8', null);
      const asked = await threads.outbound(CONDUCTOR, t.id, 'a question');
      const answer = await threads.inbound(HUMAN, t.id, 'an answer', { replyToMessageId: asked.id });

      expect(threads.message(t.id, answer.id).replyToMessageIds).toEqual([asked.id]);
      const rows = h.db.all<{ repliedToMessageId: string }>(
        'SELECT replied_to_message_id FROM thread_message_replies WHERE message_id = ?', [answer.id]);
      expect(rows.map((r) => r.repliedToMessageId)).toEqual([asked.id]);
    });
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

    it('stores an outbound attachment the same way, readable through the existing attachment() path (VS-273)', async () => {
      const t = threads.bindOrGet('web', 'web-att4', null, 'Victor');
      const bytes = Buffer.from('the design contract, allegedly');
      const msg = await threads.outbound(CONDUCTOR, t.id, 'here is the file', {
        attachments: [{ filename: 'design-contract.md', mediaType: 'text/markdown', bytes }],
      });

      expect(msg.parts).toEqual([
        expect.objectContaining({ type: 'attachment', filename: 'design-contract.md', mediaType: 'text/markdown', byteSize: bytes.byteLength }),
      ]);
      const stored = threads.messages(t.id)[0];
      expect(stored?.parts).toEqual(msg.parts);
      const attachmentId = (msg.parts[0] as { id: string }).id;
      const read = threads.attachment(t.id, attachmentId);
      expect(read.bytes).toEqual(bytes);
      expect(read.attachment.mediaType).toBe('text/markdown');
    });

    it('stores an outbound zip attachment, whose media type is never one of the inbound-accepted types', async () => {
      const t = threads.bindOrGet('web', 'web-att5', null, 'Victor');
      const bytes = Buffer.from('PK\x03\x04fake-zip-bytes-for-this-test');
      const msg = await threads.outbound(CONDUCTOR, t.id, 'here is the bundle', {
        attachments: [{ filename: 'weaver-attachments-20260101T000000Z.zip', mediaType: 'application/zip', bytes }],
      });
      expect(msg.parts).toEqual([
        expect.objectContaining({ type: 'attachment', mediaType: 'application/zip' }),
      ]);
    });

    it('an outbound message sent with no attachments behaves exactly as before this capability existed', async () => {
      const t = threads.bindOrGet('web', 'web-att6', null);
      const msg = await threads.outbound(CONDUCTOR, t.id, 'plain reply');
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

  describe('search (VS-320)', () => {
    it('finds a match older than everything a client would have loaded', async () => {
      const t = threads.bindOrGet('web', 'web-search-1', null);
      const first = await threads.inbound(HUMAN, t.id, 'the deploy runs at midnight');
      for (let i = 0; i < 60; i++) await threads.outbound(CONDUCTOR, t.id, `filler ${i}`);
      const results = threads.search(t.id, 'midnight');
      expect(results.map((r) => r.messageId)).toEqual([first.id]);
      expect(results[0]?.snippet).toContain('\u0002midnight\u0003');
    });

    it('never highlights literal brackets in the body as if they matched (VS-320 review)', async () => {
      // Markdown links, checkboxes and `[Risk]`-style labels are common in this chat; `[`/`]` cannot
      // be the highlight delimiter or any of them would misread as a match.
      const t = threads.bindOrGet('web', 'web-search-brackets', null);
      const msg = await threads.inbound(HUMAN, t.id, 'see [PR #1](https://x) and [x] — the deploy runs at midnight');
      const results = threads.search(t.id, 'midnight');
      expect(results.map((r) => r.messageId)).toEqual([msg.id]);
      expect(results[0]?.snippet).toContain('[PR #1](https://x)');
      expect(results[0]?.snippet).toContain('[x]');
      expect(results[0]?.snippet).toContain('\u0002midnight\u0003');
    });

    it('orders results newest first', async () => {
      const t = threads.bindOrGet('web', 'web-search-2', null);
      const older = await threads.inbound(HUMAN, t.id, 'first mention of gremlin');
      await threads.outbound(CONDUCTOR, t.id, 'unrelated');
      const newer = await threads.inbound(HUMAN, t.id, 'second mention of gremlin');
      expect(threads.search(t.id, 'gremlin').map((r) => r.messageId)).toEqual([newer.id, older.id]);
    });

    it.each(['"', '*', '-', ':', '(', ')'])('treats the operator character %s as plain text, never FTS5 syntax', async (ch) => {
      const t = threads.bindOrGet('web', `web-search-op-${ch.codePointAt(0)}`, null);
      await threads.inbound(HUMAN, t.id, 'ordinary text');
      expect(() => threads.search(t.id, `weird${ch}query`)).not.toThrow();
    });

    it('a match in another thread is not returned', async () => {
      const other = threads.bindOrGet('web', 'web-search-3a', null);
      await threads.outbound(CONDUCTOR, other.id, 'the unicorn code name');
      const t = threads.bindOrGet('web', 'web-search-3b', null);
      await threads.inbound(HUMAN, t.id, 'nothing special here');
      expect(threads.search(t.id, 'unicorn')).toEqual([]);
    });

    it('a thread id belonging to another workspace resolves not_found, same as messages()', async () => {
      const t = threads.bindOrGet('web', 'web-search-4', null);
      await threads.inbound(HUMAN, t.id, 'workspace one secret');
      const h2 = makeHarness();
      const threads2 = createThreadsService(h2.ctx, h2.deps);
      expect(() => threads2.search(t.id, 'secret')).toThrowError(expect.objectContaining({ code: 'not_found' }));
      h2.cleanup();
    });

    it('a message indexed without going through insertMessage (a migration backfill) is searchable', async () => {
      const t = threads.bindOrGet('web', 'web-search-5', null);
      // Mirrors what `0033_thread_message_search.sql`'s `INSERT ... SELECT` does for a pre-existing
      // row: writing straight into the search table, bypassing `insertMessage`'s index-on-write.
      h.db.run(
        `INSERT INTO thread_messages (id, thread_id, direction, author_kind, body, created_at) VALUES ('m-legacy', ?, 'inbound', 'human', 'a pre-existing legacy message', 't0')`,
        [t.id],
      );
      h.db.insert('thread_message_search', { messageId: 'm-legacy', threadId: t.id, workspaceId: h.workspaceId, body: 'a pre-existing legacy message' });
      expect(threads.search(t.id, 'legacy').map((r) => r.messageId)).toEqual(['m-legacy']);
    });

    it('an empty or no-match query returns an empty list, not an error', async () => {
      const t = threads.bindOrGet('web', 'web-search-6', null);
      await threads.inbound(HUMAN, t.id, 'something ordinary');
      expect(threads.search(t.id, '   ')).toEqual([]);
      expect(threads.search(t.id, 'nonexistenttoken')).toEqual([]);
    });
  });

  describe('around (VS-320)', () => {
    it('includes the target message itself, oldest-first', async () => {
      const t = threads.bindOrGet('web', 'web-around-1', null);
      const msgs = [];
      for (let i = 0; i < 5; i++) msgs.push(await threads.inbound(HUMAN, t.id, `m${i}`));
      const window = threads.around(t.id, msgs[2]!.id, { before: 1, after: 1 });
      expect(window.map((m) => m.id)).toEqual([msgs[1]!.id, msgs[2]!.id, msgs[3]!.id]);
    });

    it('returns a shorter window near the start of a thread rather than erroring', async () => {
      const t = threads.bindOrGet('web', 'web-around-2', null);
      const first = await threads.inbound(HUMAN, t.id, 'first');
      const second = await threads.inbound(HUMAN, t.id, 'second');
      const window = threads.around(t.id, first.id, { before: 5, after: 5 });
      expect(window.map((m) => m.id)).toEqual([first.id, second.id]);
    });

    it('a target id from another thread is not found', async () => {
      const other = threads.bindOrGet('web', 'web-around-3a', null);
      const elsewhere = await threads.outbound(CONDUCTOR, other.id, 'over here');
      const t = threads.bindOrGet('web', 'web-around-3b', null);
      await threads.inbound(HUMAN, t.id, 'over there');
      expect(() => threads.around(t.id, elsewhere.id)).toThrowError(expect.objectContaining({ code: 'not_found' }));
    });

    it('breaks a created_at tie on rowid, the same way messages() does, without dropping or duplicating the target', () => {
      const t = threads.bindOrGet('web', 'web-around-4', null);
      // Two messages sharing one created_at, the way a relayed answer and its echo are written together.
      h.db.run(`INSERT INTO thread_messages (id, thread_id, direction, author_kind, body, created_at) VALUES ('a', ?, 'inbound', 'human', 'first of the pair', 'same-ts')`, [t.id]);
      h.db.run(`INSERT INTO thread_messages (id, thread_id, direction, author_kind, body, created_at) VALUES ('b', ?, 'inbound', 'human', 'second of the pair', 'same-ts')`, [t.id]);
      expect(threads.around(t.id, 'a', { before: 5, after: 5 }).map((m) => m.id)).toEqual(['a', 'b']);
    });
  });
});
