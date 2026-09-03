// Business enums: const object + values tuple + derived type. Never branch on raw string literals elsewhere.
function makeEnum<const T extends readonly string[]>(values: T) {
  const obj = Object.fromEntries(values.map((v) => [v.toUpperCase().replace(/-/g, '_'), v])) as { [K in T[number] as Uppercase<K extends `${infer A}-${infer B}` ? `${A}_${B}` : K>]: K };
  return { values, ...obj } as const;
}

export const AGENT_KINDS = ['conductor', 'worker'] as const;
export type AgentKind = (typeof AGENT_KINDS)[number];

export const AGENT_STATUSES = ['provisioning', 'active', 'running', 'paused', 'error', 'done', 'retired'] as const;
export type AgentStatus = (typeof AGENT_STATUSES)[number];

export const ROLE_STATUSES = ['pending_activation', 'active', 'paused', 'retired'] as const;
export type RoleStatus = (typeof ROLE_STATUSES)[number];

export const SESSION_POLICIES = ['per_ticket', 'fresh', 'persistent'] as const;
export type SessionPolicy = (typeof SESSION_POLICIES)[number];

export const TICKET_KINDS = ['change', 'task', 'scout', 'question'] as const;
export type TicketKind = (typeof TICKET_KINDS)[number];

export const TICKET_STATUSES = ['backlog', 'todo', 'proposing', 'proposed', 'approved', 'in_progress', 'in_review', 'merging', 'blocked', 'done', 'cancelled'] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];
export const TERMINAL_TICKET_STATUSES: readonly TicketStatus[] = ['done', 'cancelled'];
export const ACTIVE_TICKET_STATUSES: readonly TicketStatus[] = ['todo', 'proposing', 'approved', 'in_progress', 'merging'];

export const TICKET_PRIORITIES = ['critical', 'high', 'medium', 'low'] as const;
export type TicketPriority = (typeof TICKET_PRIORITIES)[number];

export const DELIVERY_MODES = ['pr', 'local-branch'] as const;
export type DeliveryMode = (typeof DELIVERY_MODES)[number];

export const MERGE_METHODS = ['squash', 'merge', 'rebase'] as const;
export type MergeMethod = (typeof MERGE_METHODS)[number];

export const APPROVAL_OWNERS = ['human', 'conductor', 'none'] as const;
export type ApprovalOwner = (typeof APPROVAL_OWNERS)[number];

export const DECISION_KINDS = ['approval', 'question', 'gate_finding', 'plan_approval', 'hire_approval', 'merge_approval', 'discard_approval'] as const;
export type DecisionKind = (typeof DECISION_KINDS)[number];

export const DECISION_OWNERS = ['human', 'conductor'] as const;
export type DecisionOwner = (typeof DECISION_OWNERS)[number];

export const DECISION_STATUSES = ['open', 'answered', 'expired', 'withdrawn', 'superseded'] as const;
export type DecisionStatus = (typeof DECISION_STATUSES)[number];

export const WAKE_SOURCES = ['human_message', 'ticket_assigned', 'ticket_comment', 'mention', 'decision_answered', 'blockers_resolved', 'children_completed', 'timer', 'routine', 'system', 'retry', 'conductor_request', 'merge_approved'] as const;
export type WakeSource = (typeof WAKE_SOURCES)[number];

export const WAKE_STATUSES = ['queued', 'claimed', 'coalesced', 'skipped', 'completed', 'failed', 'cancelled'] as const;
export type WakeStatus = (typeof WAKE_STATUSES)[number];

export const RUN_STATUSES = ['queued', 'running', 'succeeded', 'failed', 'timed_out', 'cancelled', 'interrupted'] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

export const RUN_ERROR_FAMILIES = ['transient_upstream', 'provider_quota', 'model_refusal', 'auth', 'tooling', 'unknown'] as const;
export type RunErrorFamily = (typeof RUN_ERROR_FAMILIES)[number];

export const RUN_LIVENESS = ['advanced', 'plan_only', 'empty', 'blocked', 'needs_decision', 'failed'] as const;
export type RunLiveness = (typeof RUN_LIVENESS)[number];

export const REPORT_STATES = ['working', 'needs_decision', 'blocked', 'paused', 'done', 'failed', 'idle'] as const;
export type ReportState = (typeof REPORT_STATES)[number];

export const RUN_PHASES = ['prepare_home', 'prepare_worktree', 'build_prompt', 'spawn', 'turn', 'collect_result', 'finalize'] as const;
export type RunPhase = (typeof RUN_PHASES)[number];

export const RUN_EVENT_TYPES = [
  'session.started', 'session.resumed', 'turn.started', 'assistant.text', 'assistant.thinking', 'tool.call', 'tool.result', 'tool.denied',
  'permission.requested', 'user_input.requested', 'plan.proposed', 'file.changed', 'command.executed', 'usage.delta', 'error', 'turn.completed',
  'runtime.raw', 'run.started', 'run.finalized', 'run.phase.timing', 'supervisor.action',
] as const;
export type RunEventType = (typeof RUN_EVENT_TYPES)[number];

export const WORKTREE_STATUSES = ['active', 'dirty', 'landed', 'removed', 'orphaned'] as const;
export type WorktreeStatus = (typeof WORKTREE_STATUSES)[number];

export const WORKTREE_PROVIDERS = ['worktrunk', 'git'] as const;
export type WorktreeProviderId = (typeof WORKTREE_PROVIDERS)[number];

export const PROJECT_STATUSES = ['cloning', 'ready', 'error', 'archived'] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const WORKSPACE_STATUSES = ['active', 'paused', 'archived'] as const;
export type WorkspaceStatus = (typeof WORKSPACE_STATUSES)[number];

export const COMMENT_KINDS = ['comment', 'status', 'report', 'relay'] as const;
export type CommentKind = (typeof COMMENT_KINDS)[number];

export const AUTHOR_KINDS = ['human', 'agent', 'system'] as const;
export type AuthorKind = (typeof AUTHOR_KINDS)[number];

export const SOURCE_TRUST = ['trusted', 'agent', 'external'] as const;
export type SourceTrust = (typeof SOURCE_TRUST)[number];

export const WORK_PRODUCT_TYPES = ['pull_request', 'branch', 'commit', 'artifact', 'preview_url', 'report'] as const;
export type WorkProductType = (typeof WORK_PRODUCT_TYPES)[number];

export const KNOWLEDGE_SCOPES = ['workspace', 'shared', 'decisions', 'project'] as const;
export type KnowledgeScope = (typeof KNOWLEDGE_SCOPES)[number];

export const KNOWLEDGE_REVISION_REASONS = ['note', 'curation', 'human', 'expiry', 'seed'] as const;
export type KnowledgeRevisionReason = (typeof KNOWLEDGE_REVISION_REASONS)[number];

export const CHANNEL_KINDS = ['web', 'cli', 'telegram'] as const;
export type ChannelKind = (typeof CHANNEL_KINDS)[number] | (string & {});

export const SURFACE_KINDS = ['headless', 'tmux', 'herdr', 'hyprland', 'terminal'] as const;

export const BILLING_TYPES = ['metered_api', 'subscription_included', 'unknown'] as const;
export type BillingType = (typeof BILLING_TYPES)[number];

export const COST_STATUSES = ['reported', 'estimated', 'unpriced'] as const;
export type CostStatus = (typeof COST_STATUSES)[number];

export const AUTH_SESSION_KINDS = ['web', 'cli', 'presenter'] as const;
export type AuthSessionKind = (typeof AUTH_SESSION_KINDS)[number];

export const USAGE_WINDOWS = ['24h', 'today', 'yesterday', 'week', '7d', 'month', 'all', 'custom'] as const;
export type UsageWindow = (typeof USAGE_WINDOWS)[number];
export const USAGE_GRAINS = ['hour', 'day', 'week'] as const;
export type UsageGrain = (typeof USAGE_GRAINS)[number];

export const PERMISSION_MODES = ['auto', 'restricted', 'bypass'] as const;
export type PermissionMode = (typeof PERMISSION_MODES)[number];

/** UI status vocabulary (design contract §2): the nine tokens used identically everywhere. */
export const UI_STATUSES = ['idle', 'working', 'blocked', 'needs-you', 'merging', 'done', 'failed', 'paused', 'stalled'] as const;
export type UiStatus = (typeof UI_STATUSES)[number];

export const LOG_DOMAINS = ['daemon', 'wake', 'run', 'runtime', 'ticket', 'openspec', 'decision', 'channel', 'knowledge', 'usage', 'plugin', 'http', 'auth', 'worktree', 'surface', 'supervisor'] as const;
export type LogDomain = (typeof LOG_DOMAINS)[number];

export { makeEnum };
