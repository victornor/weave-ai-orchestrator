/** Workspace event types (outbox → SSE, hooks, webhooks). */
export const EVENT_TYPES = [
  'workspace.updated', 'project.added', 'project.updated', 'project.removed',
  'role.hired', 'role.activated', 'role.updated', 'role.paused', 'role.resumed', 'role.retired',
  'worker.spawned', 'worker.status', 'worker.retired', 'worker.stalled', 'worker.relaunched',
  'ticket.created', 'ticket.updated', 'ticket.assigned', 'ticket.status', 'ticket.comment', 'ticket.document', 'ticket.work_product', 'ticket.merged',
  'decision.created', 'decision.answered', 'decision.expired', 'decision.superseded',
  'wake.queued', 'wake.skipped', 'run.started', 'run.event', 'run.finished',
  'job.started', 'job.finished',
  'thread.message', 'knowledge.updated', 'knowledge.curated', 'spec.indexed', 'usage.recorded', 'auth.login', 'auth.logout', 'auth.revoked', 'presentation.updated',
] as const;
export type EventType = (typeof EVENT_TYPES)[number];
export interface WorkspaceEvent<T = unknown> { seq: number; workspaceId: string; type: EventType; entityType: string; entityId: string; payload: T; createdAt: string }
