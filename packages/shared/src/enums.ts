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

export const DECISION_KINDS = ['approval', 'question', 'concern', 'gate_finding', 'plan_approval', 'hire_approval', 'merge_approval', 'discard_approval', 'retry_approval'] as const;
export type DecisionKind = (typeof DECISION_KINDS)[number];

/**
 * What the general-purpose ask tool (`ac_ask`) may construct (VS-127): `question`, `concern` and
 * `gate_finding` only. `plan_approval`, `merge_approval`, `hire_approval`, `discard_approval`,
 * `retry_approval` and the generic `approval` stay exclusively system-raised — each of those already
 * sets its own owner directly (tickets, roles, the run engine) — so a caller of `ac_ask` can never
 * construct one and collide its correlation key with a real approval's.
 */
export const ASKABLE_DECISION_KINDS = ['question', 'concern', 'gate_finding'] as const;
export type AskableDecisionKind = (typeof ASKABLE_DECISION_KINDS)[number];

export const DECISION_OWNERS = ['human', 'conductor'] as const;
export type DecisionOwner = (typeof DECISION_OWNERS)[number];

export const DECISION_STATUSES = ['open', 'answered', 'expired', 'withdrawn', 'superseded'] as const;
export type DecisionStatus = (typeof DECISION_STATUSES)[number];

/**
 * The option keys a "named variant" decision card (packages/ui's DecisionCard: `plan_approval`,
 * `merge_approval`, `hire_approval`, `discard_approval`) is allowed to send with its hard-coded
 * buttons, keyed by name so a call site can cite `NAMED_CARD_OPTION_KEYS.merge_approval.approve`
 * rather than a free-floating string literal. The daemon's decision creation for these kinds MUST
 * offer exactly these keys, so a card's button can never send a key its decision does not accept
 * (VS-111).
 */
export const NAMED_CARD_OPTION_KEYS = {
  plan_approval: { approve: 'approve', revise: 'revise', reject: 'reject' },
  merge_approval: { approve: 'approve', changes: 'changes' },
  hire_approval: { approve: 'approve', reject: 'reject' },
  discard_approval: { approve: 'approve', reject: 'reject' },
} as const satisfies Record<'plan_approval' | 'merge_approval' | 'hire_approval' | 'discard_approval', Record<string, string>>;
export type NamedCardKind = keyof typeof NAMED_CARD_OPTION_KEYS;

/** What a decision can ask for beyond an option (VS-92). `secret` never records its value — only the name it was stored under. */
export const DECISION_INPUT_TYPES = ['text', 'multiline', 'multiselect', 'secret'] as const;
export type DecisionInputType = (typeof DECISION_INPUT_TYPES)[number];

/** How widely a registered secret applies. The `secrets` table has carried this since 0001_init. */
export const SECRET_SCOPES = ['workspace', 'project', 'role'] as const;
export type SecretScope = (typeof SECRET_SCOPES)[number];

export const WAKE_SOURCES = ['human_message', 'ticket_assigned', 'ticket_comment', 'mention', 'decision_answered', 'blockers_resolved', 'children_completed', 'ticket_blocked', 'timer', 'routine', 'system', 'retry', 'conductor_request', 'merge_approved'] as const;
export type WakeSource = (typeof WAKE_SOURCES)[number];

export const WAKE_STATUSES = ['queued', 'claimed', 'coalesced', 'skipped', 'completed', 'failed', 'cancelled'] as const;
export type WakeStatus = (typeof WAKE_STATUSES)[number];

export const RUN_STATUSES = ['queued', 'running', 'succeeded', 'failed', 'timed_out', 'cancelled', 'interrupted'] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];
/** Runs the daemon has not finished with — the ones a live view streams. */
export const ACTIVE_RUN_STATUSES: readonly RunStatus[] = ['queued', 'running'];
export const isActiveRun = (status: string | null | undefined): boolean => ACTIVE_RUN_STATUSES.includes(status as RunStatus);

export const RUN_ERROR_FAMILIES = ['transient_upstream', 'provider_quota', 'model_refusal', 'auth', 'tooling', 'unknown'] as const;
export type RunErrorFamily = (typeof RUN_ERROR_FAMILIES)[number];

export const RUN_LIVENESS = ['advanced', 'plan_only', 'empty', 'blocked', 'needs_decision', 'failed'] as const;
export type RunLiveness = (typeof RUN_LIVENESS)[number];

export const REPORT_STATES = ['working', 'needs_decision', 'blocked', 'paused', 'done', 'failed', 'idle'] as const;
export type ReportState = (typeof REPORT_STATES)[number];

export const RUN_PHASES = ['prepare_home', 'prepare_worktree', 'build_prompt', 'spawn', 'turn', 'collect_result', 'finalize'] as const;
export type RunPhase = (typeof RUN_PHASES)[number];
/**
 * The phases the run engine actually times, in the order it times them. `RUN_PHASES` also declares
 * `spawn` and `finalize`, which nothing records — reading "the next phase" off the full list puts
 * every mid-turn run in `spawn`. Anything inferring the phase under way from `run.phase.timing`
 * events walks this list instead. `packages/core/src/runs/engine.test.ts` pins it to the engine.
 */
export const RECORDED_RUN_PHASES: readonly RunPhase[] = ['prepare_home', 'prepare_worktree', 'build_prompt', 'turn', 'collect_result'];

/**
 * `human.input` (VS-99): a human sent text to a running agent. Payload
 * `{ text, authorKind, authorId, delivery: 'mid_turn' | 'queued', acknowledgedAt? }` — never
 * `user_input.requested`, which is the agent asking for input, the opposite direction.
 */
export const RUN_EVENT_TYPES = [
  'session.started', 'session.resumed', 'turn.started', 'assistant.text', 'assistant.thinking', 'tool.call', 'tool.result', 'tool.denied',
  'permission.requested', 'user_input.requested', 'plan.proposed', 'file.changed', 'command.executed', 'usage.delta', 'error', 'turn.completed',
  'runtime.raw', 'run.started', 'run.finalized', 'run.phase.timing', 'supervisor.action', 'human.input',
] as const;
export type RunEventType = (typeof RUN_EVENT_TYPES)[number];

export const WORKTREE_STATUSES = ['active', 'dirty', 'landed', 'removed', 'orphaned'] as const;
export type WorktreeStatus = (typeof WORKTREE_STATUSES)[number];

export const WORKTREE_PROVIDERS = ['worktrunk', 'git'] as const;
export type WorktreeProviderId = (typeof WORKTREE_PROVIDERS)[number];

export const PROJECT_STATUSES = ['cloning', 'ready', 'error', 'archived'] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

/**
 * How a project's primary clone compares to `origin/<landingBranch>` (VS-131): `behind` is
 * fast-forwardable and routine; `diverged` means the clone holds a commit the remote's tip no
 * longer recognises (a force-push or rebase upstream) and needs a human, never an automatic fix.
 */
export const PROJECT_SYNC_STATES = ['in_sync', 'behind', 'diverged'] as const;
export type ProjectSyncState = (typeof PROJECT_SYNC_STATES)[number];

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

/** Plan limit windows a runtime account can report (PLAN §16.2): the rolling session window, the weekly window, and a weekly window scoped to one model. */
export const ACCOUNT_LIMIT_KINDS = ['session', 'weekly_all', 'weekly_scoped'] as const;
export type AccountLimitKind = (typeof ACCOUNT_LIMIT_KINDS)[number];

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

/** `conductor daemon update apply`: the deferred upgrade's lifecycle (PLAN §20). Forward-only. */
export const UPGRADE_STATES = ['queued', 'waiting', 'building', 'switching', 'restarting', 'completed', 'failed', 'cancelled'] as const;
export type UpgradeState = (typeof UPGRADE_STATES)[number];
export const TERMINAL_UPGRADE_STATES: readonly UpgradeState[] = ['completed', 'failed', 'cancelled'];
export const isTerminalUpgrade = (state: string | null | undefined): boolean => TERMINAL_UPGRADE_STATES.includes(state as UpgradeState);
/** Cancellable only before anything has been built: `building` and later are past the point of no return. */
export const CANCELLABLE_UPGRADE_STATES: readonly UpgradeState[] = ['queued', 'waiting'];
export const isCancellableUpgrade = (state: string | null | undefined): boolean => CANCELLABLE_UPGRADE_STATES.includes(state as UpgradeState);

/** Why an upgrade ended in `failed`. Never branch on the message; branch on this. */
export const UPGRADE_FAILURE_REASONS = ['build_failed', 'backup_failed', 'switch_failed', 'restart_unverified', 'restart_failed', 'abandoned'] as const;
export type UpgradeFailureReason = (typeof UPGRADE_FAILURE_REASONS)[number];

/**
 * A job is one long-running workspace-setup operation, observable while it runs: an ordered list of
 * sub-steps with their own timings plus a bounded tail of the output its commands produced. Adding a
 * project is the only kind so far — minutes of cloning, adopting OpenSpec and seeding knowledge that
 * used to happen inside one silent request.
 */
export const JOB_KINDS = ['project_add'] as const;
export type JobKind = (typeof JOB_KINDS)[number];

export const JOB_STATES = ['running', 'done', 'failed'] as const;
export type JobState = (typeof JOB_STATES)[number];
export const TERMINAL_JOB_STATES: readonly JobState[] = ['done', 'failed'];
export const isTerminalJob = (state: string | null | undefined): boolean => TERMINAL_JOB_STATES.includes(state as JobState);

export const JOB_STEP_STATES = ['pending', 'running', 'done', 'skipped', 'failed'] as const;
export type JobStepState = (typeof JOB_STEP_STATES)[number];

/** Which of a job's two streams a captured line came from. `daemon` is the job's own narration. */
export const JOB_LOG_STREAMS = ['stdout', 'stderr', 'daemon'] as const;
export type JobLogStream = (typeof JOB_LOG_STREAMS)[number];

/** The sub-steps of a `project_add` job, in the order `projects.add` performs them. */
export const PROJECT_ADD_STEPS = [
  { id: 'clone', label: 'Clone the repository' },
  { id: 'resolve_branch', label: 'Resolve the default branch' },
  { id: 'declare', label: 'Declare the project' },
  { id: 'openspec', label: 'Adopt OpenSpec' },
  { id: 'knowledge', label: 'Seed the knowledge base' },
  { id: 'ticket', label: 'Create the scout ticket' },
] as const;
export type ProjectAddStepId = (typeof PROJECT_ADD_STEPS)[number]['id'];

/** Every kind's step list, so a job can be seeded complete-and-`pending` the moment it is created. */
export const JOB_STEPS: Record<JobKind, ReadonlyArray<{ id: string; label: string }>> = { project_add: PROJECT_ADD_STEPS };

/**
 * The changelog (PLAN §13.6) is the human-facing record of what happened in a workspace: a projection
 * over the `activity` table, not a log of its own. These are the only activity actions it shows —
 * everything else `recordActivity` writes stays operational detail the changelog never surfaces.
 */
export const CHANGELOG_KINDS = ['filed', 'plan_approved', 'pr_opened', 'landed', 'cancelled', 'hired', 'upgraded'] as const;
export type ChangelogKind = (typeof CHANGELOG_KINDS)[number];

/**
 * The activity action behind each changelog kind, and the `details_json` field that has to match when
 * one action carries several meanings: `ticket.transition` fires on every status edge and only the one
 * into `approved` is a plan approval; `ticket.work_product` records branches and reports as well as
 * pull requests. `landed` reads `ticket.delivery_landed` rather than the transition into `done`,
 * because that row is written once, by `mergeDone`, when the work actually reached the clone.
 */
export const CHANGELOG_SOURCES: Record<ChangelogKind, { action: string; detail?: { key: string; value: string } }> = {
  filed: { action: 'ticket.create' },
  plan_approved: { action: 'ticket.transition', detail: { key: 'to', value: 'approved' } },
  pr_opened: { action: 'ticket.work_product', detail: { key: 'type', value: 'pull_request' } },
  landed: { action: 'ticket.delivery_landed' },
  cancelled: { action: 'ticket.cancel' },
  hired: { action: 'role.hire' },
  upgraded: { action: 'daemon.upgraded' },
};

/** The kind the changelog's productivity measure counts: work that reached the repository. */
export const CHANGELOG_MEASURE_KIND: ChangelogKind = 'landed';

export const LOG_DOMAINS = ['daemon', 'wake', 'run', 'runtime', 'ticket', 'openspec', 'decision', 'channel', 'knowledge', 'usage', 'plugin', 'http', 'auth', 'worktree', 'surface', 'supervisor'] as const;
export type LogDomain = (typeof LOG_DOMAINS)[number];

export { makeEnum };
