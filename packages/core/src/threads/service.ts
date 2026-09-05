import { newId, nowIso, threadRow, type Db } from '@agent-conductor/db';
import { OcError, type ChannelThread, type ThreadMessage } from '@agent-conductor/shared';
import type { Actor, CoreServices, ThreadsService } from '../api.js';
import type { WorkspaceContext } from '../context.js';
import { recordActivity } from '../events.js';
import { tx } from '../tickets/tx.js';

interface ThreadRow extends ChannelThread { isPrimary: boolean; channelKind?: string }

/** Channels that reach a human directly; anything else is delivered by the server's channel manager. */
const HUMAN_CHANNELS = ['web', 'telegram'];

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
    opts: { parts?: unknown[]; runId?: string | null; externalMessageId?: string; deliveryStatus?: string; projectId?: string | null } = {},
  ): ThreadMessage {
    const msg: ThreadMessage = {
      id: newId(), threadId, direction, authorKind: actor.kind, authorId: actor.id, runId: opts.runId ?? actor.runId ?? null,
      projectId: opts.projectId ?? null, body, parts: opts.parts ?? [], externalMessageId: opts.externalMessageId ?? null,
      deliveryStatus: opts.deliveryStatus ?? 'received', createdAt: nowIso(),
    };
    db.insert('thread_messages', {
      id: msg.id, threadId, direction, authorKind: msg.authorKind, authorId: msg.authorId, runId: msg.runId, projectId: msg.projectId, body,
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
      // Resolved before anything is written, so a reference to a project this workspace does not
      // have stores no message and wakes nobody. `get` takes an id or a slug and is workspace-scoped.
      const project = opts.projectId ? deps().projects.get(opts.projectId) : null;
      return tx(db, () => {
        const msg = insertMessage(t.id, 'inbound', human, body, { ...opts, projectId: project?.id ?? null, deliveryStatus: 'received' });
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
              payload: { threadId: t.id, messageId: msg.id, body: body.slice(0, 2000), projectId: project?.id ?? null, projectSlug: project?.slug ?? null },
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
      return tx(db, () => {
        const msg = insertMessage(t.id, 'outbound', actor, body, {
          ...opts,
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
      let sql = 'SELECT * FROM thread_messages WHERE thread_id = ?';
      if (opts.before) { sql += ' AND created_at < ?'; params.push(opts.before); }
      sql += ' ORDER BY created_at DESC, rowid DESC LIMIT ?';
      params.push(Math.min(opts.limit ?? 50, 500));
      return db.all<ThreadMessage>(sql, params).reverse();
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
