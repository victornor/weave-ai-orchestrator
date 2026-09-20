/** Workspace event types (outbox → SSE, hooks, webhooks). */
export const EVENT_TYPES = [
  'workspace.updated', 'project.added', 'project.updated', 'project.removed',
  'role.hired', 'role.activated', 'role.updated', 'role.paused', 'role.resumed', 'role.retired',
  'worker.spawned', 'worker.status', 'worker.retired', 'worker.stalled', 'worker.relaunched',
  'ticket.created', 'ticket.updated', 'ticket.assigned', 'ticket.status', 'ticket.comment', 'ticket.document', 'ticket.work_product', 'ticket.attachment', 'ticket.merged',
  'decision.created', 'decision.answered', 'decision.expired', 'decision.superseded', 'decision.updated',
  'wake.queued', 'wake.skipped', 'run.started', 'run.finished',
  'job.started', 'job.finished',
  'routine.created', 'routine.updated', 'routine.removed', 'routine.fired',
  'roadmap.created', 'roadmap.updated', 'roadmap.removed',
  'roadmap.block.created', 'roadmap.block.updated', 'roadmap.block.removed',
  'plan.created', 'plan.draft_added', 'plan.draft_updated', 'plan.draft_removed', 'plan.draft_reordered', 'plan.titled', 'plan.submitted', 'plan.discarded', 'plan.draft_linked',
  /** VS-622: a planner published or revised a plan-scoped artifact; `plan.*` so the tab strip's existing invalidation refreshes an open plan. */
  'plan.artifact_published',
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
 *
 * `run.event` (VS-417) carries one `RunEvent` and lets every live run on a page share the one
 * workspace stream instead of opening a per-run `EventSource`. `worker.activity` (VS-328) is the
 * per-worker activity summary. `run.delta` (VS-595) carries the coalesced partial output of the
 * parts a live run is still generating; it is never stored, and a completed event supersedes it.
 */
export const EPHEMERAL_EVENT_TYPES = ['worker.activity', 'run.event', 'run.delta', 'session.compaction'] as const;
export type EphemeralEventType = (typeof EPHEMERAL_EVENT_TYPES)[number];
export interface WorkspaceEvent<T = unknown> { seq: number; workspaceId: string; type: EventType; entityType: string; entityId: string; payload: T; createdAt: string }

/** VS-595: one part's partial output in a `run.delta` frame; `offset` is how many characters precede `text`. */
export interface RunDeltaPart { partId: string; kind: 'text' | 'thinking' | 'tool_input'; offset: number; text: string }
/** Payload of a `run.delta` frame: everything that changed since the run's previous frame. */
export interface RunDeltaFrame { runId: string; parts: RunDeltaPart[] }
/** `GET /runs/:id/live`: the partial output a live run has shown so far, for a page that just connected. */
export interface RunLiveSnapshot { partials: Array<{ partId: string; kind: RunDeltaPart['kind']; text: string }> }

/**
 * VS-595: what partial output each runtime reports while a step is generated (its adapter's
 * `capabilities.partialOutput`), for a page that must say whether it can stream. A runtime absent
 * here reports whole steps only. Each adapter's own test pins its declaration to this table.
 */
export const RUNTIME_PARTIAL_OUTPUT: Readonly<Record<string, 'text' | 'full'>> = { opencode: 'full', claude: 'full', codex: 'full', cursor: 'text', gemini: 'text', weave: 'full' };
