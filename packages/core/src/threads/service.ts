import { newId, nowIso, threadRow, type Db } from '@weave-ai/db';
import { OcError, projectLabel, type Attachment, type AttachmentPart, type ChannelThread, type ThreadMessage, type ThreadSearchResult } from '@weave-ai/shared';
import type { Actor, CoreServices, ThreadsService } from '../api.js';
import type { WorkspaceContext } from '../context.js';
import { recordActivity } from '../events.js';
import { ftsQuery } from '../search/ftsQuery.js';
import { tx } from '../tickets/tx.js';
import { readAttachmentBytes, sanitizeAttachmentFilename, writeAttachment, writeGeneratedAttachment } from './attachmentStorage.js';

/** Default/max window sizes for `around()` — generous enough to cover a screenful of context either
 * side of a jumped-to message without loading the whole thread (VS-320). */
const AROUND_DEFAULT_BEFORE = 25;
const AROUND_DEFAULT_AFTER = 24;
const AROUND_MAX = 250;
/** Default/max result count for `search()`, matching `specs/index.ts`'s own search limit. */
const SEARCH_DEFAULT_LIMIT = 50;
const SEARCH_MAX_LIMIT = 200;

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

/**
 * How much of an inbound human message's body travels directly in the `human_message` wake
 * payload. 8,000 covers most of how captain actually writes — a pasted report, a stack trace, a
 * spec section — without letting several messages coalesced into one wake's `payload.bundle`
 * balloon unboundedly. A message over this bound is marked `truncated: true` with `bodyLength` set
 * to its real length; the full body stays reachable via `ThreadsService.message()` (VS-242).
 */
export const HUMAN_MESSAGE_WAKE_BODY_CHARS = 8000;

export function createThreadsService(ctx: WorkspaceContext, deps: () => CoreServices): ThreadsService {
  const db: Db = ctx.db;
  const log = ctx.log('channel');
  const ws = ctx.workspaceId;

  function conductor(): { id: string } {
    const c = db.get<{ id: string }>("SELECT id FROM agents WHERE workspace_id = ? AND kind = 'weaver'", [ws]);
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

  /**
   * The `body`, `truncated` and `bodyLength` fields for a `human_message` wake payload. A body at
   * or under the bound is passed through with no new fields, so it reads exactly as it did before
   * this bound existed; a longer body is cut with a marker naming its real length.
   */
  function wakeBody(body: string): { body: string; truncated?: true; bodyLength?: number } {
    if (body.length <= HUMAN_MESSAGE_WAKE_BODY_CHARS) return { body };
    return { body: body.slice(0, HUMAN_MESSAGE_WAKE_BODY_CHARS), truncated: true, bodyLength: body.length };
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
    opts: { parts?: unknown[]; runId?: string | null; externalMessageId?: string; deliveryStatus?: string; projectId?: string | null; replyToMessageId?: string | null; replyToExcerpt?: string | null; idempotencyKey?: string | null } = {},
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
      idempotencyKey: opts.idempotencyKey ?? null,
    });
    // The single write path for both directions, so this is the one place a message needs indexing
    // (VS-320). `threadId` is already resolved to this workspace by every caller's own `get()`, so
    // `ws` — not a fresh lookup — is the row's workspace.
    db.insert('thread_message_search', { messageId: msg.id, threadId, workspaceId: ws, body });
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

    // VS-398: a fresh `web`-kind thread owned by a specific agent (a planning agent's own plan
    // conversation) — never bound to an external channel thread id, and never primary, unlike
    // `bindOrGet`'s. Always creates; there is nothing to match against for a brand-new plan.
    createOwned(agentId, opts = {}) {
      return tx(db, () => {
        const cid = channelId('web');
        const id = newId();
        db.insert('channel_threads', {
          id, channelId: cid, agentId, ticketId: null, externalThreadId: `internal-${id}`, externalUserId: null,
          humanLabel: opts.humanLabel ?? null, isPrimary: false, createdAt: nowIso(), lastMessageAt: null,
        });
        const t = get(id);
        recordActivity(db, ws, { kind: 'system', id: null }, 'thread.created', 'channel_thread', id, { channelKind: 'web', agentId });
        return t as ChannelThread;
      });
    },

    get,

    list(filter = {}) {
      // VS-398: a planner's own plan conversation (`createOwned`) is a channel_thread like any
      // other, never `isPrimary`, and often the most recently active one the moment captain talks
      // to it — left in, it would outrank the weaver's own thread here and in the Chats page, and
      // ChatPage's default-thread pick would open the plan conversation instead of the weaver's.
      // Excluded unconditionally rather than behind an opt-in flag: nothing today ever wants a
      // planner's thread through this general listing — the plan modal reads its own thread by id.
      const where: string[] = ['c.workspace_id = ?', "(a.kind IS NULL OR a.kind != 'planner')"];
      const params: Array<string> = [ws];
      if (filter.channelKind) { where.push('c.kind = ?'); params.push(filter.channelKind); }
      if (filter.agentId) { where.push('t.agent_id = ?'); params.push(filter.agentId); }
      if (filter.ticketId) { where.push('t.ticket_id = ?'); params.push(filter.ticketId); }
      return db
        .all<Record<string, unknown>>(
          `SELECT t.* FROM channel_threads t JOIN channels c ON c.id = t.channel_id LEFT JOIN agents a ON a.id = t.agent_id
           WHERE ${where.join(' AND ')} ORDER BY t.is_primary DESC, COALESCE(t.last_message_at, t.created_at) DESC`,
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
      const idempotencyKey = opts.idempotencyKey || undefined;
      return tx(db, () => {
        // A client retry after a lost response carries the same key; return the stored message
        // without a second row, event, or wake (VS-148).
        if (idempotencyKey) {
          const existing = db.get<ThreadMessage>(
            `SELECT m.*, r.body AS reply_to_excerpt FROM thread_messages m
             LEFT JOIN thread_messages r ON r.id = m.reply_to_message_id AND r.thread_id = m.thread_id
             WHERE m.thread_id = ? AND m.idempotency_key = ?`,
            [t.id, idempotencyKey],
          );
          if (existing) {
            return existing.replyToExcerpt === null ? existing : { ...existing, replyToExcerpt: excerpt(existing.replyToExcerpt) };
          }
        }
        const msg = insertMessage(t.id, 'inbound', human, body, {
          ...opts,
          projectId: project?.id ?? null,
          replyToMessageId: repliedTo?.id ?? null,
          replyToExcerpt: repliedTo ? excerpt(repliedTo.body) : null,
          deliveryStatus: 'received',
          idempotencyKey: idempotencyKey ?? null,
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
              reason: `message from ${t.humanLabel ?? 'the human'}${project ? ` about ${projectLabel(project)}` : ''}`,
              payload: {
                threadId: t.id, messageId: msg.id, ...wakeBody(body),
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
        // Same posture as inbound's own block: written inside this transaction, so an attachment row
        // never exists without the message that owns it (VS-273, mirroring design.md Decision 3 for
        // the inbound side). Bytes are already resolved and size-checked by the caller
        // (`resolveOutboundAttachments`) — this only stores and links them.
        const attachmentParts: AttachmentPart[] = (opts.attachments ?? []).map((a) => {
          const dot = a.filename.lastIndexOf('.');
          const extension = dot > 0 ? a.filename.slice(dot + 1).toLowerCase() : 'bin';
          const stored = writeGeneratedAttachment(ctx, extension, a.bytes);
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

    message(threadId, messageId) {
      // Scoped to the thread in the query itself, the same way `attachment` is: a message from
      // another thread and an unknown message id come back as the identical `not_found`, so a
      // caller cannot use this to tell "exists elsewhere" from "does not exist" (VS-242).
      const r = db.get<ThreadMessage>(
        `SELECT m.*, r.body AS reply_to_excerpt FROM thread_messages m
         LEFT JOIN thread_messages r ON r.id = m.reply_to_message_id AND r.thread_id = m.thread_id
         WHERE m.id = ? AND m.thread_id = ?`,
        [messageId, threadId],
      );
      if (!r) throw new OcError('not_found', `message ${messageId} not found in thread ${threadId}`);
      return r.replyToExcerpt === null ? r : { ...r, replyToExcerpt: excerpt(r.replyToExcerpt) };
    },

    attachment(threadId, attachmentId) {
      // Scoped to the thread in the query itself, not checked after the fact: a row from another
      // thread — or another workspace's database entirely — simply does not match, and both come
      // back as the same `not_found` (openspec spec.md — cross-thread and cross-workspace fetches).
      const row = db.get<Attachment>('SELECT * FROM attachments WHERE id = ? AND thread_id = ?', [attachmentId, threadId]);
      if (!row) throw new OcError('not_found', `attachment ${attachmentId} not found in thread ${threadId}`);
      return { attachment: row, bytes: readAttachmentBytes(ctx, row.storageKey) };
    },

    search(threadId, query, opts = {}) {
      // Scoped exactly like `messages()`: `get()` throws `not_found` for a thread outside this
      // workspace before any search runs, rather than a bespoke "search returns empty" behavior
      // (VS-320 design.md — one behavior for "this thread isn't yours," not two). `workspace_id` is
      // filtered again in the query itself as a belt-and-suspenders check against the row that was
      // actually indexed.
      const t = get(threadId);
      const match = ftsQuery(query);
      if (!match.length) return [];
      const limit = Math.min(opts.limit ?? SEARCH_DEFAULT_LIMIT, SEARCH_MAX_LIMIT);
      // Delimiters must never occur in a stored message body, or a coincidental occurrence reads as
      // a highlighted match. `[`/`]` do not qualify: markdown links (`[PR #267](...)`), checkboxes
      // (`[x]`) and `[Risk]`-style labels are common in this chat and would be misread as hits.
      // `char(2)`/`char(3)` (STX/ETX) are control characters no message body will ever contain.
      const rows = db.all<ThreadSearchResult>(
        `SELECT m.author_kind, m.author_id, m.created_at, m.id AS message_id,
                snippet(thread_message_search, 3, char(2), char(3), '…', 16) AS snippet
         FROM thread_message_search s
         JOIN thread_messages m ON m.id = s.message_id
         WHERE s.thread_id = ? AND s.workspace_id = ? AND thread_message_search MATCH ?
         ORDER BY m.created_at DESC, m.rowid DESC
         LIMIT ?`,
        [t.id, ws, match, limit],
      );
      return rows;
    },

    around(threadId, messageId, opts = {}) {
      const t = get(threadId);
      // Scoped to the thread the same way `message()` is, and needed here for its `rowid`: the
      // tie-break `messages()` itself uses when two messages share a `created_at` (a relayed answer
      // and its echo are written together) — comparing `created_at` alone could drop the target from
      // its own window, or repeat/skip a neighbour (VS-320 design.md).
      const target = db.get<{ createdAt: string; rowid: number }>(
        'SELECT created_at, rowid FROM thread_messages WHERE id = ? AND thread_id = ?',
        [messageId, t.id],
      );
      if (!target) throw new OcError('not_found', `message ${messageId} not found in thread ${threadId}`);
      const before = Math.min(opts.before ?? AROUND_DEFAULT_BEFORE, AROUND_MAX);
      const after = Math.min(opts.after ?? AROUND_DEFAULT_AFTER, AROUND_MAX);
      const beforeRows = db.all<ThreadMessage>(
        `SELECT m.*, r.body AS reply_to_excerpt FROM thread_messages m
         LEFT JOIN thread_messages r ON r.id = m.reply_to_message_id AND r.thread_id = m.thread_id
         WHERE m.thread_id = ? AND (m.created_at, m.rowid) <= (?, ?)
         ORDER BY m.created_at DESC, m.rowid DESC LIMIT ?`,
        [t.id, target.createdAt, target.rowid, before + 1],
      );
      const afterRows = db.all<ThreadMessage>(
        `SELECT m.*, r.body AS reply_to_excerpt FROM thread_messages m
         LEFT JOIN thread_messages r ON r.id = m.reply_to_message_id AND r.thread_id = m.thread_id
         WHERE m.thread_id = ? AND (m.created_at, m.rowid) > (?, ?)
         ORDER BY m.created_at ASC, m.rowid ASC LIMIT ?`,
        [t.id, target.createdAt, target.rowid, after],
      );
      return [...beforeRows.reverse(), ...afterRows].map((m) => (m.replyToExcerpt === null ? m : { ...m, replyToExcerpt: excerpt(m.replyToExcerpt) }));
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
      await service.outbound(actor, thread.id, message.text, {
        ...(message.parts ? { parts: message.parts } : {}),
        ...(message.attachments ? { attachments: message.attachments } : {}),
      });
    },
  };

  return service;
}
