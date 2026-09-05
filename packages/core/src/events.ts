import { EventEmitter } from 'node:events';
import type { Db } from '@agent-conductor/db';
import { newId, nowIso } from '@agent-conductor/db';
import type { EventType, WorkspaceEvent } from '@agent-conductor/shared';

/** Durable outbox + in-process bus. Every domain change appends here; SSE/hooks/webhooks consume by seq. */
export class EventBus {
  private emitter = new EventEmitter();
  constructor(private db: Db, private workspaceId: string) { this.emitter.setMaxListeners(200); }
  emit<T>(type: EventType, entityType: string, entityId: string, payload: T): WorkspaceEvent<T> {
    const createdAt = nowIso();
    const id = newId();
    const r = this.db.run('INSERT INTO events (id, workspace_id, type, entity_type, entity_id, payload_json, created_at) VALUES (?,?,?,?,?,?,?)', [id, this.workspaceId, type, entityType, entityId, JSON.stringify(payload ?? {}), createdAt]);
    const ev: WorkspaceEvent<T> = { seq: Number(r.lastInsertRowid), workspaceId: this.workspaceId, type, entityType, entityId, payload, createdAt };
    queueMicrotask(() => this.emitter.emit('event', ev));
    return ev;
  }
  on(handler: (ev: WorkspaceEvent) => void): () => void { this.emitter.on('event', handler); return () => this.emitter.off('event', handler); }
  since(seq: number, limit = 500): WorkspaceEvent[] {
    return this.db.all<{ seq: number; id: string; workspaceId: string; type: EventType; entityType: string; entityId: string; payload: unknown; createdAt: string }>('SELECT seq, id, workspace_id, type, entity_type, entity_id, payload_json, created_at FROM events WHERE workspace_id = ? AND seq > ? ORDER BY seq LIMIT ?', [this.workspaceId, seq, limit])
      .map((r) => ({ seq: r.seq, workspaceId: r.workspaceId, type: r.type, entityType: r.entityType, entityId: r.entityId, payload: r.payload, createdAt: r.createdAt }));
  }
  lastSeq(): number { return this.db.get<{ s: number }>('SELECT COALESCE(MAX(seq),0) s FROM events WHERE workspace_id = ?', [this.workspaceId])?.s ?? 0; }
}

import type { Actor } from './api.js';
/**
 * Append one row to the append-only activity record. `projectId` scopes the row to a project so the
 * changelog (PLAN §13.6) can page a single project's history without a per-row-kind join.
 *
 * Left out, it is resolved the same three ways `0011_activity_project.sql` backfilled the history that
 * predates the column — through the ticket, through the role, or from the project itself — so a row
 * recorded now and the same row recorded a year ago are scoped identically. A row that reaches no
 * project stays workspace-level, which is where a workspace ticket's activity belongs.
 */
export function recordActivity(db: Db, workspaceId: string, actor: Actor, action: string, entityType: string, entityId: string, details: Record<string, unknown> = {}, ticketId: string | null = null, projectId: string | null = null): void {
  const project = projectId ?? resolveProject(db, entityType, entityId, ticketId);
  db.run('INSERT INTO activity (id, workspace_id, actor_kind, actor_id, run_id, action, entity_type, entity_id, ticket_id, project_id, details_json, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)', [newId(), workspaceId, actor.kind, actor.id, actor.runId ?? null, action, entityType, entityId, ticketId, project, JSON.stringify(details), nowIso()]);
}

function resolveProject(db: Db, entityType: string, entityId: string, ticketId: string | null): string | null {
  if (ticketId) return db.get<{ projectId: string | null }>('SELECT project_id FROM tickets WHERE id = ?', [ticketId])?.projectId ?? null;
  if (entityType === 'role') return db.get<{ projectId: string | null }>('SELECT project_id FROM roles WHERE id = ?', [entityId])?.projectId ?? null;
  if (entityType === 'project') return db.get<{ id: string }>('SELECT id FROM projects WHERE id = ?', [entityId])?.id ?? null;
  return null;
}
