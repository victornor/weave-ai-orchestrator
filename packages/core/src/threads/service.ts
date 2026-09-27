import { newId, nowIso, threadRow, type Db } from '@weave-ai/db';
import { OcError, projectLabel, type Attachment, type AttachmentPart, type ChannelThread, type ThreadMessage, type ThreadSearchResult } from '@weave-ai/shared';
import type { Actor, CoreServices, ThreadsService } from '../api.js';
import type { WorkspaceContext } from '../context.js';
import { recordActivity } from '../events.js';
import { runState, type ActiveRun } from '../runs/active.js';
import { ftsQuery } from '../search/ftsQuery.js';
import { literalSnippet, needsLiteralMatch } from '../search/literalMatch.js';
import { tx } from '../tickets/tx.js';
import { readAttachmentBytes, sanitizeAttachmentFilename, writeAttachment, writeGeneratedAttachment } from './attachmentStorage.js';

/** Default/max window sizes for `around()` — generous enough to cover a screenful of context either
 * side of a jumped-to message without loading the whole thread (VS-320). Both sides match the UI's
 * own `THREAD_PAGE_SIZE` (VS-714): the client tells whether more history exists beyond this window
 * by comparing each side's count against that same size, the same way it already does for an
 * ordinary `before`/`after` page, so the two constants must move together. */
const AROUND_DEFAULT_BEFORE = 30;
const AROUND_DEFAULT_AFTER = 30;
const AROUND_MAX = 250;
/** Default/max result count for `search()`, matching `specs/index.ts`'s own search limit. */
const SEARCH_DEFAULT_LIMIT = 50;
const SEARCH_MAX_LIMIT = 200;

interface ThreadRow extends ChannelThread { isPrimary: boolean; channelKind?: string }

/** Channels that reach a human directly; anything else is delivered by the server's channel manager. */
const HUMAN_CHANNELS = ['web', 'telegram'];

/** VS-622: the one card shape `setMessageParts` will rewrite a message with — a plan-artifact card. */
function isPlanArtifactCardPart(p: unknown): boolean {
  if (typeof p !== 'object' || p === null) return false;
  const part = p as Record<string, unknown>;
  if (part.type !== 'card') return false;
  const ref = part.ref;
  return typeof ref === 'object' && ref !== null && (ref as Record<string, unknown>).kind === 'plan-artifact';
}

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

  /**
   * VS-567: a plan's thread is owned by the plan's planner, and a planner can be replaced (an upgrade
   * retires one and spawns another). Returns the agent a wake for this thread should address: the
   * thread's own agent, unless that is a retired planner and the plan has a live one, in which case
   * the thread is rebound first and the human messages that were skipped as `agent_retired` are
   * re-enqueued for the live planner (idempotent by message id).
   */
  function liveAddressee(t: ChannelThread): string {
    const stale = db.get<{ status: string }>('SELECT status FROM agents WHERE id = ?', [t.agentId]);
    if (stale?.status !== 'retired') return t.agentId;
    const live = db.get<{ id: string }>(
      `SELECT a.id FROM plans p JOIN agents a ON a.id = p.agent_id
        WHERE p.thread_id = ? AND a.kind = 'planner' AND a.status NOT IN ('retired', 'done')`,
      [t.id],
    );
    if (!live) return t.agentId;
    const oldAgentId = t.agentId;
    db.run('UPDATE channel_threads SET agent_id = ? WHERE id = ?', [live.id, t.id]);
    recordActivity(db, ws, { kind: 'system', id: null }, 'thread.rebind', 'channel_thread', t.id, { from: oldAgentId, to: live.id });
    const skipped = db.all<{ payload: Record<string, unknown> | null; reason: string }>(
      "SELECT payload_json, reason FROM wakeups WHERE agent_id = ? AND source = 'human_message' AND status = 'skipped' AND skip_reason = 'agent_retired' ORDER BY created_at",
      [oldAgentId],
    );
    for (const w of skipped) {
      const payload = w.payload ?? {};
      if (payload.threadId !== t.id || typeof payload.messageId !== 'string') continue;
      try {
        deps().wake.enqueue(live.id, {
          source: 'human_message', reason: w.reason, payload, requestedBy: { kind: 'system', id: null },
          idempotencyKey: `replay:${payload.messageId}`,
        });
      } catch (e) {
        log.warn({ err: e, threadId: t.id }, 'replay of a skipped plan message failed');
      }
    }
    return live.id;
  }

  function row(r: Record<string, unknown>): ThreadRow {
    return threadRow(r) as unknown as ThreadRow;
  }

  /**
   * VS-657: is this addressee a ticketless persistent session? Only a session is interrupted by a
   * new message; the weaver, a planner and a ticket-bound worker keep their existing delivery.
   */
  function ticketlessSession(agentId: string): boolean {
    const a = db.get<{ kind: string; ticketId: string | null }>('SELECT kind, ticket_id AS ticketId FROM agents WHERE id = ?', [agentId]);
    return a?.kind === 'session' && !a.ticketId;
  }

  /** The run currently executing for this agent in this process, if any. */
  function activeRunFor(agentId: string): ActiveRun | null {
    for (const active of runState(ctx).active.values()) if (active.agentId === agentId) return active;
    return null;
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

  /** One row per message a reply answers (VS-449), written beside the message in the same transaction. */
  function linkReplies(messageId: string, targetIds: string[], createdAt: string): void {
    for (const repliedToMessageId of targetIds) db.insert('thread_message_replies', { messageId, repliedToMessageId, createdAt });
  }

  /**
   * Every message a page of replies answers, keyed by reply message id, oldest-first. One query for
   * the whole page rather than one per message. A row with no link rows (a database written directly,
   * not through `insertMessage`) falls back to its single `reply_to_message_id` in `withReplyTargets`.
   */
  function replyTargetsFor(messageIds: string[]): Map<string, string[]> {
    const out = new Map<string, string[]>();
    if (messageIds.length === 0) return out;
    const rows = db.all<{ messageId: string; targetId: string }>(
      `SELECT mr.message_id AS message_id, mr.replied_to_message_id AS target_id
       FROM thread_message_replies mr
       JOIN thread_messages t ON t.id = mr.replied_to_message_id
       WHERE mr.message_id IN (${messageIds.map(() => '?').join(',')})
       ORDER BY t.created_at ASC, t.rowid ASC`,
      messageIds,
    );
    for (const r of rows) {
      const list = out.get(r.messageId);
      if (list) list.push(r.targetId);
      else out.set(r.messageId, [r.targetId]);
    }
    return out;
  }

  /** A read's messages with their complete reply-target list (VS-449). */
  function withReplyTargets(msgs: ThreadMessage[]): ThreadMessage[] {
    const targets = replyTargetsFor(msgs.map((m) => m.id));
    return msgs.map((m) => ({ ...m, replyToMessageIds: targets.get(m.id) ?? (m.replyToMessageId ? [m.replyToMessageId] : []) }));
  }

  /**
   * The messages an outbound reply answers, oldest-first (VS-449). An explicit `replyToMessageId`
   * (including `null`) is honoured exactly. Otherwise the turn's waking human messages are the
   * candidates: those that exist in this thread and that no earlier reply of the same run has
   * already linked. That last filter is what stops a second send in one turn re-quoting a message an
   * earlier send already answered.
   */
  function resolveOutboundTargets(
    threadId: string,
    opts: { replyToMessageId?: string | null; defaultReplyToMessageIds?: string[] },
    runId: string | null,
  ): string[] {
    if (opts.replyToMessageId !== undefined) return opts.replyToMessageId ? [opts.replyToMessageId] : [];
    const candidates = [...new Set(opts.defaultReplyToMessageIds ?? [])];
    if (candidates.length === 0) return [];
    const inThread = new Map(
      db
        .all<{ id: string; createdAt: string }>(
          `SELECT id, created_at FROM thread_messages WHERE thread_id = ? AND id IN (${candidates.map(() => '?').join(',')})`,
          [threadId, ...candidates],
        )
        .map((r) => [r.id, r.createdAt]),
    );
    const linked = runId
      ? new Set(
          db
            .all<{ targetId: string }>(
              `SELECT DISTINCT mr.replied_to_message_id AS target_id
               FROM thread_message_replies mr
               JOIN thread_messages m ON m.id = mr.message_id
               WHERE m.thread_id = ? AND m.run_id = ? AND mr.replied_to_message_id IN (${candidates.map(() => '?').join(',')})`,
              [threadId, runId, ...candidates],
            )
            .map((r) => r.targetId),
        )
      : new Set<string>();
    return candidates
      .filter((id) => inThread.has(id) && !linked.has(id))
      .sort((a, b) => {
        const ta = inThread.get(a)!;
        const tb = inThread.get(b)!;
        return ta === tb ? (a < b ? -1 : a > b ? 1 : 0) : ta < tb ? -1 : 1;
      });
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
    opts: { parts?: unknown[]; runId?: string | null; externalMessageId?: string; deliveryStatus?: string; projectId?: string | null; blockId?: string | null; replyToMessageId?: string | null; replyToMessageIds?: string[]; replyToExcerpt?: string | null; idempotencyKey?: string | null } = {},
  ): ThreadMessage {
    const replyToMessageIds = opts.replyToMessageIds ?? (opts.replyToMessageId ? [opts.replyToMessageId] : []);
    const msg: ThreadMessage = {
      id: newId(), threadId, direction, authorKind: actor.kind, authorId: actor.id, runId: opts.runId ?? actor.runId ?? null,
      projectId: opts.projectId ?? null, blockId: opts.blockId ?? null, replyToMessageId: opts.replyToMessageId ?? null, replyToMessageIds, replyToExcerpt: opts.replyToExcerpt ?? null,
      body, parts: opts.parts ?? [], externalMessageId: opts.externalMessageId ?? null,
      deliveryStatus: opts.deliveryStatus ?? 'received', createdAt: nowIso(),
    };
    db.insert('thread_messages', {
      id: msg.id, threadId, direction, authorKind: msg.authorKind, authorId: msg.authorId, runId: msg.runId, projectId: msg.projectId, blockId: msg.blockId,
      replyToMessageId: msg.replyToMessageId, body,
      partsJson: msg.parts, externalMessageId: msg.externalMessageId, deliveryStatus: msg.deliveryStatus, createdAt: msg.createdAt,
      idempotencyKey: opts.idempotencyKey ?? null,
    });
    linkReplies(msg.id, replyToMessageIds, msg.createdAt);
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
      // A block only means something alongside the project it belongs to (VS-491): resolve it through
      // the roadmap service before anything is written, so a project-less, unknown or foreign block
      // stores nothing and wakes nobody. `getBlock` throws `not_found` for an unknown id.
      if (opts.blockId && !project) throw new OcError('validation', 'a roadmap block needs the project it belongs to');
      const block = opts.blockId ? deps().roadmap.getBlock(opts.blockId) : null;
      if (block && block.projectId !== project!.id) throw new OcError('not_found', `roadmap block ${opts.blockId} is not in this project`);
      // Same posture for the replied-to message, and scoped to this thread rather than checked against
      // it: the query cannot return a row from another thread, so a reference can never cross a thread
      // — and therefore a workspace — boundary. It is also the read that produces the excerpt.
      const repliedTo = opts.replyToMessageId ? repliedToMessage(t.id, opts.replyToMessageId) : null;
      const idempotencyKey = opts.idempotencyKey || undefined;
      // VS-657: set inside the transaction (synchronous reads only), acted on after it commits.
      let interruptRunId: string | null = null;
      const result = tx(db, () => {
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
          blockId: block?.id ?? null,
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
          if (opts.dictated) deps().tickets.comment(human, t.ticketId, body, 'comment', 'trusted', { dictated: true });
          else deps().tickets.comment(human, t.ticketId, body, 'comment', 'trusted');
        } else {
          const addresseeId = liveAddressee(t);
          // VS-657: a message to a ticketless persistent session whose turn is executing stops that
          // turn now, so the wake below becomes the session's next turn instead of queueing behind
          // it. Skipped once the run is already marked cancelled for a message, so two rapid messages
          // coalesce into the one resumed turn rather than starting two.
          if (ticketlessSession(addresseeId)) {
            const active = activeRunFor(addresseeId);
            if (active && active.cancelled?.cause !== 'message') interruptRunId = active.runId;
          }
          try {
            deps().wake.enqueue(addresseeId, {
              source: 'human_message',
              reason: `message from ${t.humanLabel ?? 'the human'}${project ? ` about ${projectLabel(project)}` : ''}`,
              payload: {
                threadId: t.id, messageId: msg.id, body,
                projectId: project?.id ?? null, projectSlug: project?.slug ?? null,
                blockId: block?.id ?? null, blockTitle: block?.title ?? null,
                replyToMessageId: msg.replyToMessageId, replyToExcerpt: msg.replyToExcerpt,
                ...(opts.dictated ? { dictated: true } : {}),
                ...(interruptRunId ? { interruptedRunId: interruptRunId } : {}),
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
      // Done outside the transaction: `tx` must not await and `runs.cancel` is async. Issued in the
      // same turn as the enqueue, so the message is already queued for the resumed turn when the
      // turn being stopped finalizes.
      if (interruptRunId) {
        const runId = interruptRunId;
        void deps().runs.cancel(human, runId, 'interrupt', 'message').catch((e) => log.warn({ err: e, threadId: t.id, runId }, 'interrupting the session turn failed'));
      }
      return result;
    },

    async outbound(actor, threadId, body, opts = {}) {
      const t = get(threadId);
      const kind = kindOf(t.id);
      // Resolved before anything is written, same posture as inbound: an invalid or cross-thread
      // target is rejected rather than stored, and `repliedToMessage` cannot return a row from
      // another thread by construction. The single quote target is the newest one answered (VS-449).
      const targetIds = resolveOutboundTargets(t.id, opts, opts.runId ?? null);
      const repliedTo = targetIds.length ? repliedToMessage(t.id, targetIds[targetIds.length - 1]!) : null;
      return tx(db, () => {
        const msg = insertMessage(t.id, 'outbound', actor, body, {
          ...opts,
          replyToMessageId: repliedTo?.id ?? null,
          replyToMessageIds: targetIds,
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

    hasOutboundForRun(threadId, runId) {
      return !!db.get(
        "SELECT 1 FROM thread_messages WHERE thread_id = ? AND run_id = ? AND direction = 'outbound' LIMIT 1",
        [threadId, runId],
      );
    },

    setMessageParts(messageId, parts) {
      // VS-622: a card-only replacement, so a republished plan artifact refreshes its one card instead
      // of appending a second — and so this can never become a general message editor.
      if (!Array.isArray(parts) || parts.length === 0 || !parts.every(isPlanArtifactCardPart)) {
        throw new OcError('validation', 'only plan-artifact card parts may replace a message\'s parts');
      }
      const existing = db.get<{ id: string }>('SELECT id FROM thread_messages WHERE id = ?', [messageId]);
      if (!existing) throw new OcError('not_found', `message ${messageId} not found`);
      db.update('thread_messages', messageId, { partsJson: parts });
      return true;
    },

    messages(threadId, opts = {}) {
      const t = get(threadId);
      if (opts.after !== undefined && opts.before !== undefined) {
        throw new OcError('validation', '`before` and `after` cannot be combined in the same request');
      }
      const params: Array<string | number> = [t.id];
      // The quote is joined in rather than resolved by the caller: this read is paged, so the replied-to
      // message is often outside the window, and a stored copy of its text could go stale. The join
      // repeats the thread predicate so the read enforces the invariant the write does.
      let sql = `SELECT m.*, r.body AS reply_to_excerpt FROM thread_messages m
                 LEFT JOIN thread_messages r ON r.id = m.reply_to_message_id AND r.thread_id = m.thread_id
                 WHERE m.thread_id = ?`;
      // `after` pages forward, toward the live tail (VS-714): ascending order is already the shape
      // `messages()` returns, so — unlike `before`, which queries DESC for `LIMIT` correctness and
      // reverses after — no reverse is needed here.
      if (opts.after !== undefined) {
        sql += ' AND m.created_at > ? ORDER BY m.created_at ASC, m.rowid ASC LIMIT ?';
        params.push(opts.after, Math.min(opts.limit ?? 50, 500));
        return withReplyTargets(
          db.all<ThreadMessage>(sql, params).map((m) => (m.replyToExcerpt === null ? m : { ...m, replyToExcerpt: excerpt(m.replyToExcerpt) })),
        );
      }
      if (opts.before) { sql += ' AND m.created_at < ?'; params.push(opts.before); }
      sql += ' ORDER BY m.created_at DESC, m.rowid DESC LIMIT ?';
      params.push(Math.min(opts.limit ?? 50, 500));
      return withReplyTargets(
        db.all<ThreadMessage>(sql, params).map((m) => (m.replyToExcerpt === null ? m : { ...m, replyToExcerpt: excerpt(m.replyToExcerpt) })),
      ).reverse();
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
      return withReplyTargets([r.replyToExcerpt === null ? r : { ...r, replyToExcerpt: excerpt(r.replyToExcerpt) }])[0]!;
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
      // A query with a character the tokenizer treats as a separator (VS-714) — `_password` and
      // `password` tokenize identically — needs the raw body checked for a literal, case-insensitive
      // match; the FTS `MATCH` above is still run first as a safe superset (its tokenized form always
      // matches everything the literal text could possibly appear in), just over-fetched since the
      // literal filter below narrows it. Bounded at `SEARCH_MAX_LIMIT` rather than an unbounded retry
      // loop — see design.md's accepted trade-off.
      if (needsLiteralMatch(query)) {
        const needle = query.trim();
        const candidates = db.all<ThreadSearchResult & { body: string }>(
          `SELECT m.author_kind, m.author_id, m.created_at, m.id AS message_id, m.body AS body
           FROM thread_message_search s
           JOIN thread_messages m ON m.id = s.message_id
           WHERE s.thread_id = ? AND s.workspace_id = ? AND thread_message_search MATCH ?
           ORDER BY m.created_at DESC, m.rowid DESC
           LIMIT ?`,
          [t.id, ws, match, SEARCH_MAX_LIMIT],
        );
        return candidates
          .filter((c) => c.body.toLowerCase().includes(needle.toLowerCase()))
          .slice(0, limit)
          .map(({ authorKind, authorId, createdAt, messageId, body }) => ({
            authorKind, authorId, createdAt, messageId, snippet: literalSnippet(body, needle),
          }));
      }
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
      return withReplyTargets([...beforeRows.reverse(), ...afterRows].map((m) => (m.replyToExcerpt === null ? m : { ...m, replyToExcerpt: excerpt(m.replyToExcerpt) })));
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
