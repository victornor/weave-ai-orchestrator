import { EventEmitter } from 'node:events';
import type { Db } from '@openconductor/db';
import { newId, nowIso } from '@openconductor/db';
import type { EventType, WorkspaceEvent } from '@openconductor/shared';

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

export interface Actor { kind: 'human' | 'agent' | 'system'; id: string | null; runId?: string | null }
export function recordActivity(db: Db, workspaceId: string, actor: Actor, action: string, entityType: string, entityId: string, details: Record<string, unknown> = {}, ticketId: string | null = null): void {
  db.run('INSERT INTO activity (id, workspace_id, actor_kind, actor_id, run_id, action, entity_type, entity_id, ticket_id, details_json, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)', [newId(), workspaceId, actor.kind, actor.id, actor.runId ?? null, action, entityType, entityId, ticketId, JSON.stringify(details), nowIso()]);
}
