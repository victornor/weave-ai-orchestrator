import { newId, nowIso, threadRow, type Db } from '@agent-conductor/db';
import { OcError, type Attachment, type AttachmentPart, type ChannelThread, type ThreadMessage } from '@agent-conductor/shared';
import type { Actor, CoreServices, ThreadsService } from '../api.js';
import type { WorkspaceContext } from '../context.js';
import { recordActivity } from '../events.js';
import { tx } from '../tickets/tx.js';
import { readAttachmentBytes, sanitizeAttachmentFilename, writeAttachment } from './attachmentStorage.js';

interface ThreadRow extends ChannelThread { isPrimary: boolean; channelKind?: string }

/** Channels that reach a human directly; anything else is delivered by the server's channel manager. */
const HUMAN_CHANNELS = ['web', 'telegram'];

/**
 * How much of a replied-to message travels with the reply, both on a read and in the wake payload.
 * The excerpt is a locator, not a transcript: the conductor also gets the referenced message's id, and
 * it holds the full text in its own session. Bounding it keeps a page of 50 messages from growing
 * without bound when many of them are replies.
 */
export const REPLY_EXCERPT_CHARS = 500;

export function createThreadsService(ctx: WorkspaceContext, deps: () => CoreServices): ThreadsService {
  const db: Db = ctx.db;
  const log = ctx.log('channel');
  const ws = ctx.workspaceId;

  function conductor(): { id: string } {
    const c = db.get<{ id: string }>("SELECT id FROM agents WHERE workspace_id = ? AND kind = 'conductor'", [ws]);
    if (!c) throw new OcError('not_found', 'this workspace has no conductor yet');
    return c;
  }

  function channelId(kind: string): string {
    const existing = db.get<{ id: string }>('SELECT id FROM channels WHERE workspace_id = ? AND kind = ?', [ws, kind]);
    if (existing) return existing.id;
    const id = newId();
    db.insert('channels', { id, workspaceId: ws, kind, configJson: {}, status: 'active' });
    ctx.events.emit('workspace.updated', 'channel', id, { kind, status: 'active' });
    return id;
  }

  function kindOf(threadId: string): string {
    return db.get<{ kind: string }>('SELECT c.kind FROM channel_threads t JOIN channels c ON c.id = t.channel_id WHERE t.id = ?', [threadId])?.kind ?? 'web';
  }

  function row(r: Record<string, unknown>): ThreadRow {
    return threadRow(r) as unknown as ThreadRow;
  }

  function excerpt(body: string): string {
    return body.slice(0, REPLY_EXCERPT_CHARS);
  }

  /** The message a reply names, or a `not_found` throw. Scoped to the thread, so it cannot cross one. */
  function repliedToMessage(threadId: string, messageId: string): { id: string; body: string } {
    const r = db.get<{ id: string; body: string }>('SELECT id, body FROM thread_messages WHERE id = ? AND thread_id = ?', [messageId, threadId]);
    if (!r) throw new OcError('not_found', `message ${messageId} not found in thread ${threadId}`);
    return r;
  }

  function get(id: string): ThreadRow {
    const r = db.get<Record<string, unknown>>(
      'SELECT t.* FROM channel_threads t JOIN channels c ON c.id = t.channel_id WHERE t.id = ? AND c.workspace_id = ?',
      [id, ws],
    );
    if (!r) throw new OcError('not_found', `thread ${id} not found`);
    return row(r);
  }

  function insertMessage(
    threadId: string,
    direction: 'inbound' | 'outbound',
    actor: Actor,
    body: string,
    opts: { parts?: unknown[]; runId?: string | null; externalMessageId?: string; deliveryStatus?: string; projectId?: string | null; replyToMessageId?: string | null; replyToExcerpt?: string | null } = {},
  ): ThreadMessage {
    const msg: ThreadMessage = {
      id: newId(), threadId, direction, authorKind: actor.kind, authorId: actor.id, runId: opts.runId ?? actor.runId ?? null,
      projectId: opts.projectId ?? null, replyToMessageId: opts.replyToMessageId ?? null, replyToExcerpt: opts.replyToExcerpt ?? null,
      body, parts: opts.parts ?? [], externalMessageId: opts.externalMessageId ?? null,
      deliveryStatus: opts.deliveryStatus ?? 'received', createdAt: nowIso(),
    };
    db.insert('thread_messages', {
      id: msg.id, threadId, direction, authorKind: msg.authorKind, authorId: msg.authorId, runId: msg.runId, projectId: msg.projectId,
      replyToMessageId: msg.replyToMessageId, body,
      partsJson: msg.parts, externalMessageId: msg.externalMessageId, deliveryStatus: msg.deliveryStatus, createdAt: msg.createdAt,
    });
    db.run('UPDATE channel_threads SET last_message_at = ? WHERE id = ?', [msg.createdAt, threadId]);
    return msg;
  }

  const service: ThreadsService = {
    bindOrGet(channelKind, externalThreadId, externalUserId, humanLabel) {
      return tx(db, () => {
        const cid = channelId(channelKind);
        const existing = db.get<Record<string, unknown>>('SELECT * FROM channel_threads WHERE channel_id = ? AND external_thread_id = ?', [cid, externalThreadId]);
        if (existing) return row(existing) as ChannelThread;
        const id = newId();
        const others = db.get<{ n: number }>('SELECT COUNT(*) n FROM channel_threads t JOIN channels c ON c.id = t.channel_id WHERE c.workspace_id = ?', [ws])?.n ?? 0;
        db.insert('channel_threads', {
          id, channelId: cid, agentId: conductor().id, ticketId: null, externalThreadId, externalUserId: externalUserId ?? null,
          humanLabel: humanLabel ?? null, isPrimary: others === 0 && HUMAN_CHANNELS.includes(channelKind), createdAt: nowIso(), lastMessageAt: null,
        });
        const t = get(id);
        recordActivity(db, ws, { kind: 'system', id: null }, 'thread.created', 'channel_thread', id, { channelKind, externalThreadId });
        return t as ChannelThread;
      });
    },

    get,

    list(filter = {}) {
      const where: string[] = ['c.workspace_id = ?'];
      const params: Array<string> = [ws];
      if (filter.channelKind) { where.push('c.kind = ?'); params.push(filter.channelKind); }
      if (filter.agentId) { where.push('t.agent_id = ?'); params.push(filter.agentId); }
      if (filter.ticketId) { where.push('t.ticket_id = ?'); params.push(filter.ticketId); }
      return db
        .all<Record<string, unknown>>(
          `SELECT t.* FROM channel_threads t JOIN channels c ON c.id = t.channel_id WHERE ${where.join(' AND ')} ORDER BY COALESCE(t.last_message_at, t.created_at) DESC`,
          params,
        )
        .map(row) as ChannelThread[];
    },

    bindTicket(actor, threadId, ticketId) {
      const t = get(threadId);
      if (ticketId) deps().tickets.get(ticketId);
      return tx(db, () => {
        db.run('UPDATE channel_threads SET ticket_id = ? WHERE id = ?', [ticketId, t.id]);
        recordActivity(db, ws, actor, 'thread.bind', 'channel_thread', t.id, { ticketId }, ticketId);
        ctx.events.emit('thread.message', 'channel_thread', t.id, { threadId: t.id, ticketId, bound: !!ticketId });
        return get(t.id) as ChannelThread;
      });
    },

    async inbound(actor, threadId, body, opts = {}) {
      const t = get(threadId);
      const human: Actor = { kind: 'human', id: actor.id ?? t.externalUserId ?? null };
      // Attachments are out of scope on a ticket-bound thread (its message becomes a ticket comment,
      // with no wake payload to carry metadata through) — rejected before the transaction opens
      // rather than stored with no way to ever reach the conductor.
      if (t.ticketId && opts.attachments?.length) {
        throw new OcError('validation', 'attachments are not supported on a ticket-bound thread');
      }
      // Resolved before anything is written, so a reference to a project this workspace does not
      // have stores no message and wakes nobody. `get` takes an id or a slug and is workspace-scoped.
      const project = opts.projectId ? deps().projects.get(opts.projectId) : null;
      // Same posture for the replied-to message, and scoped to this thread rather than checked against
      // it: the query cannot return a row from another thread, so a reference can never cross a thread
      // — and therefore a workspace — boundary. It is also the read that produces the excerpt.
      const repliedTo = opts.replyToMessageId ? repliedToMessage(t.id, opts.replyToMessageId) : null;
      return tx(db, () => {
        const msg = insertMessage(t.id, 'inbound', human, body, {
          ...opts,
          projectId: project?.id ?? null,
          replyToMessageId: repliedTo?.id ?? null,
          replyToExcerpt: repliedTo ? excerpt(repliedTo.body) : null,
          deliveryStatus: 'received',
        });
        // Written in the same transaction as the message: an attachment row never exists without the
        // message that owns it, so there is no orphan state to sweep (openspec design.md Decision 1).
        const attachmentParts: AttachmentPart[] = (opts.attachments ?? []).map((a) => {
          const stored = writeAttachment(ctx, a.mediaType, a.bytes);
          const filename = sanitizeAttachmentFilename(a.filename);
          db.insert('attachments', {
            id: stored.id, threadId: t.id, messageId: msg.id, filename, mediaType: a.mediaType,
            byteSize: stored.byteSize, storageKey: stored.storageKey, createdAt: msg.createdAt,
          });
          return { type: 'attachment', id: stored.id, filename, mediaType: a.mediaType, byteSize: stored.byteSize };
        });
        if (attachmentParts.length) {
          db.update('thread_messages', msg.id, { partsJson: attachmentParts });
          msg.parts = attachmentParts;
        }
        recordActivity(db, ws, human, 'thread.inbound', 'thread_message', msg.id, { threadId: t.id }, t.ticketId);
        ctx.events.emit('thread.message', 'thread_message', msg.id, { ...msg, ticketId: t.ticketId });
        if (t.ticketId) {
          // A thread bound to a ticket lands as a human ticket comment; that wakes the ticket's worker (PLAN §11.7).
          deps().tickets.comment(human, t.ticketId, body, 'comment', 'trusted');
        } else {
          try {
            deps().wake.enqueue(t.agentId, {
              source: 'human_message',
              reason: `message from ${t.humanLabel ?? 'the human'}${project ? ` about ${project.slug}` : ''}`,
              payload: {
                threadId: t.id, messageId: msg.id, body: body.slice(0, 2000),
                projectId: project?.id ?? null, projectSlug: project?.slug ?? null,
                replyToMessageId: msg.replyToMessageId, replyToExcerpt: msg.replyToExcerpt,
                ...(attachmentParts.length ? { attachmentIds: attachmentParts.map((p) => p.id) } : {}),
              },
              requestedBy: human,
            });
          } catch (e) {
            log.warn({ err: e, threadId: t.id }, 'wake enqueue for inbound message failed');
          }
        }
        return msg;
      });
    },

    async outbound(actor, threadId, body, opts = {}) {
      const t = get(threadId);
      const kind = kindOf(t.id);
      // Resolved before anything is written, same posture as inbound: an invalid or cross-thread
      // target is rejected rather than stored, and `repliedToMessage` cannot return a row from
      // another thread by construction.
      const repliedTo = opts.replyToMessageId ? repliedToMessage(t.id, opts.replyToMessageId) : null;
      return tx(db, () => {
        const msg = insertMessage(t.id, 'outbound', actor, body, {
          ...opts,
          replyToMessageId: repliedTo?.id ?? null,
          replyToExcerpt: repliedTo ? excerpt(repliedTo.body) : null,
          deliveryStatus: kind === 'web' ? 'delivered' : 'pending',
        });
        recordActivity(db, ws, actor, 'thread.outbound', 'thread_message', msg.id, { threadId: t.id, channel: kind }, t.ticketId);
        ctx.events.emit('thread.message', 'thread_message', msg.id, { ...msg, channelKind: kind, ticketId: t.ticketId });
        return msg;
      });
    },

    messages(threadId, opts = {}) {
      const t = get(threadId);
      const params: Array<string | number> = [t.id];
      // The quote is joined in rather than resolved by the caller: this read is paged, so the replied-to
      // message is often outside the window, and a stored copy of its text could go stale. The join
      // repeats the thread predicate so the read enforces the invariant the write does.
      let sql = `SELECT m.*, r.body AS reply_to_excerpt FROM thread_messages m
                 LEFT JOIN thread_messages r ON r.id = m.reply_to_message_id AND r.thread_id = m.thread_id
                 WHERE m.thread_id = ?`;
      if (opts.before) { sql += ' AND m.created_at < ?'; params.push(opts.before); }
      sql += ' ORDER BY m.created_at DESC, m.rowid DESC LIMIT ?';
      params.push(Math.min(opts.limit ?? 50, 500));
      return db
        .all<ThreadMessage>(sql, params)
        .map((m) => (m.replyToExcerpt === null ? m : { ...m, replyToExcerpt: excerpt(m.replyToExcerpt) }))
        .reverse();
    },

    attachment(threadId, attachmentId) {
      // Scoped to the thread in the query itself, not checked after the fact: a row from another
      // thread — or another workspace's database entirely — simply does not match, and both come
      // back as the same `not_found` (openspec spec.md — cross-thread and cross-workspace fetches).
      const row = db.get<Attachment>('SELECT * FROM attachments WHERE id = ? AND thread_id = ?', [attachmentId, threadId]);
      if (!row) throw new OcError('not_found', `attachment ${attachmentId} not found in thread ${threadId}`);
      return { attachment: row, bytes: readAttachmentBytes(ctx, row.storageKey) };
    },

    primaryThread() {
      const r = db.get<Record<string, unknown>>(
        `SELECT t.* FROM channel_threads t JOIN channels c ON c.id = t.channel_id
         WHERE c.workspace_id = ? AND c.kind IN (${HUMAN_CHANNELS.map(() => '?').join(',')})
         ORDER BY t.is_primary DESC, COALESCE(t.last_message_at, t.created_at) DESC LIMIT 1`,
        [ws, ...HUMAN_CHANNELS],
      );
      return r ? (row(r) as ChannelThread) : null;
    },

    async notifyHuman(actor, message) {
      let thread = service.primaryThread();
      if (!thread) thread = service.bindOrGet('web', `web-${newId()}`, null, 'Web');
      await service.outbound(actor, thread.id, message.text, message.parts ? { parts: message.parts } : {});
    },
  };

  return service;
}
