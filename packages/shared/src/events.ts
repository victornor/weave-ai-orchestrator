/** Workspace event types (outbox → SSE, hooks, webhooks). */
export const EVENT_TYPES = [
  'workspace.updated', 'project.added', 'project.updated', 'project.removed',
  'role.hired', 'role.activated', 'role.updated', 'role.paused', 'role.resumed', 'role.retired',
  'worker.spawned', 'worker.status', 'worker.retired', 'worker.stalled', 'worker.relaunched',
  'ticket.created', 'ticket.updated', 'ticket.assigned', 'ticket.status', 'ticket.comment', 'ticket.document', 'ticket.work_product', 'ticket.merged',
  'decision.created', 'decision.answered', 'decision.expired', 'decision.superseded', 'decision.updated',
  'wake.queued', 'wake.skipped', 'run.started', 'run.event', 'run.finished',
  'job.started', 'job.finished',
  'routine.created', 'routine.updated', 'routine.removed', 'routine.fired',
  'roadmap.created', 'roadmap.updated', 'roadmap.removed',
  'thread.message', 'knowledge.updated', 'knowledge.curated', 'spec.indexed', 'usage.recorded', 'knowledge_usage.recorded', 'auth.login', 'auth.logout', 'auth.revoked', 'presentation.updated',
  'weaver_artifact.published',
  /** VS-334: a plugin's own event, `entityType` is `plugin:<pluginId>`; payload is `{ pluginId, kind, payload }`. */
  'plugin.event',
] as const;
export type EventType = (typeof EVENT_TYPES)[number];
/**
 * Frames the workspace stream forwards to connected clients without writing an outbox row (VS-328).
 * They are live-only: a client that misses one converges from the read behind it. Kept out of
 * `EVENT_TYPES` so nothing treats them as a durable domain event.
 */
export const EPHEMERAL_EVENT_TYPES = ['worker.activity'] as const;
export type EphemeralEventType = (typeof EPHEMERAL_EVENT_TYPES)[number];
export interface WorkspaceEvent<T = unknown> { seq: number; workspaceId: string; type: EventType; entityType: string; entityId: string; payload: T; createdAt: string }
