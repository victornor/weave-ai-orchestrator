/**
 * Response shapes for docs/API.md. Entities come from @weave-ai/shared;
 * these are the envelopes the HTTP layer wraps them in.
 */
import type { DiffFileStatus, DiffHunk } from '@weave-ai/render';
import type {
  Agent,
  Briefing,
  ChangelogDay,
  ChangelogEntry,
  ChangelogHeatmap,
  ChangelogKind,
  ChangelogPage,
  ChannelThread,
  Decision,
  KnowledgeFile,
  KnowledgeScope,
  Project,
  Role,
  Run,
  RunEvent,
  Ticket,
  TicketAttachment,
  TicketComment,
  TicketPriority,
  TicketStatus,
  ThreadMessage,
  ThreadSearchResult,
  Workspace,
  CostStatus,
  UsageGrain,
  UsageWindow,
  AccountSyncFailure,
  AccountSyncThrottle,
  RuntimeAccount,
  RuntimeCredential,
  UsageBillingMix,
  AuthSessionKind,
  PresentationConfig,
  PlanOrigin,
} from '@weave-ai/shared';
export type { TicketAttachment } from '@weave-ai/shared';

export interface Health {
  ok: boolean;
  version: string;
  release?: RunningRelease;
  workspaces: Array<{ id: string; name: string; status: string }>;
  operatorConfigured: boolean;
  tlsMode: string;
  publicUrl?: string;
  transcription?: { configured: boolean; backend?: 'chrome' | 'voxtype' };
  host?: {
    platform: string;
    hostname: string;
    home: string;
    defaultWorkspaceRoot: string;
    tools: Record<string, HostToolInfo>;
  };
}

export interface TranscriptionStatus {
  backend: 'chrome' | 'voxtype';
  model: string | null;
  voxtype: { installed: boolean; models: Array<{ id: string; engine: string; installed: boolean }>; error?: string };
}

/* ---- daemon updates and the deferred upgrade (PLAN §20) ---- */

export interface RunningRelease {
  version: string;
  /** The release directory the daemon is executing from. */
  path: string;
  /** The commit it was built from; null when it could not be determined. */
  sha: string | null;
}

export interface UpdateStatus {
  /** False when no release source is configured: not an update, and not an error. */
  configured: boolean;
  running: RunningRelease;
  source: string | null;
  ref: string | null;
  targetSha: string | null;
  updateAvailable: boolean;
  checkedAt: string | null;
  error: string | null;
}

export type UpgradeState = 'queued' | 'waiting' | 'building' | 'switching' | 'restarting' | 'completed' | 'failed' | 'cancelled';

export interface Upgrade {
  id: string;
  state: UpgradeState;
  source: string;
  ref: string;
  targetSha: string | null;
  fromRelease: string | null;
  toRelease: string | null;
  toSha: string | null;
  requestedBy: string;
  requestedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  reason: string | null;
  message: string | null;
  log: string[];
  backups: string[];
  cameBackVersion: string | null;
}

/** What a waiting upgrade is holding for, derived live rather than stored. */
export interface WaitingRun { workspace: string; running: number; runIds: string[] }

export interface UpgradeStatusResponse { upgrade: Upgrade | null; waitingFor: WaitingRun[] }

export interface RuntimeModel { id: string; label: string; provider?: string; source?: 'detected' | 'static'; tier?: string; notes?: string; contextWindowTokens?: number; efforts?: string[] }

/** One of the two model settings a workspace holds (VS-77): `GET`/`PUT /models`. */
export type CompactionMode = 'off' | 'percent' | 'tokens';
export interface ModelCompaction { mode: CompactionMode; value?: number }
/** Mirrors shared's `RuntimeOptionValueSchema` — the value shapes a runtime option may hold. */
export type RuntimeOptionValue = string | number | boolean | string[];
export type RuntimeOptions = Record<string, RuntimeOptionValue>;
export interface ModelSetting { runtime: string; model: string | null; effort?: string; compaction?: ModelCompaction; options?: RuntimeOptions }
export interface WorkerModelOption { id: string; description: string; runtime: string | null; model: string | null; effort?: string; compaction?: ModelCompaction; options?: RuntimeOptions }
/** Where an effective control comes from (VS-356): stored on this workspace, a filled daemon overlay, or the schema default. */
export type ModelSource = 'workspace' | 'daemon' | 'default';
export interface WorkspaceModelsSource { weaver: ModelSource; workers: ModelSource; workerOptions: ModelSource }
/** VS-284, VS-356: the effective settings plus each control's source. Never locked; always editable. */
export interface WorkspaceModels { weaver: ModelSetting; workers: ModelSetting; workerOptions?: WorkerModelOption[]; source: WorkspaceModelsSource }
/** `PUT /models` (VS-356): a value overrides, `null` clears back to inherit, omission keeps. */
export interface WorkspaceModelsPut { weaver?: ModelSetting | null; workers?: ModelSetting | null; workerOptions?: WorkerModelOption[] | null }
export interface DaemonModels { weaver: ModelSetting | null; workers: ModelSetting | null; workerOptions: WorkerModelOption[] | null }

/* ------------------------------------------------ weave-runtime providers (VS-610) */

/** One model entry a provider profile lists; mirrors the provider schema's `models` values. */
export interface ProviderModelEntry { contextWindow?: number; maxOutputTokens?: number; compat?: Record<string, unknown>; params?: Record<string, unknown> }
/**
 * A `weave`-runtime provider profile as `GET /providers` returns it. Never carries a key: the key
 * lives in the workspace secret store, named by `apiKeySecret`, and only `secretConfigured` says
 * whether one is held. Fields the daemon has defaulted are present.
 */
export interface ProviderProfile {
  preset?: string;
  baseUrl: string;
  apiKeySecret?: string;
  auth: string;
  headers: Record<string, string>;
  query?: Record<string, string>;
  discover?: boolean;
  maxConcurrentRuns?: number;
  timeouts?: { connectMs?: number; idleMs?: number; requestMs?: number };
  compat?: Record<string, unknown>;
  params?: Record<string, unknown>;
  models: Record<string, ProviderModelEntry>;
}
/** VS-633: where a workspace's view of an entry comes from. */
export type ConfigSource = 'daemon' | 'workspace' | 'override';
export interface ProviderView { id: string; profile: ProviderProfile; secretConfigured: boolean; models: string[]; source?: ConfigSource }
/** One preset the add-a-provider flow can start from; the daemon owns the id and the description. */
export interface PresetSummary { id: string; description: string }
/** `disabled` (workspace scope only): inherited daemon providers this workspace hides. */
export interface ProvidersPayload { providers: ProviderView[]; disabled?: ProviderView[]; presets: PresetSummary[] }
/** `POST /providers/:id/test` (VS-609): the per-capability probe verdict and the flags it measured. */
export interface ProviderTestReport { ok?: boolean; provider: string; model: string; checks: Array<{ name: string; ok: boolean; detail: string }>; detected: Record<string, unknown> }

/* ------------------------------------------------------- MCP servers (VS-621) */

/**
 * One MCP server definition as `GET /mcp` returns it. A secret value is never here: an `env` or
 * `headers` value may carry a `${SECRET_NAME}` reference, resolved at run time. Fields the daemon
 * has defaulted are present.
 */
export interface McpServer {
  type: 'http' | 'stdio';
  url?: string;
  headers: Record<string, string>;
  command?: string;
  args: string[];
  env: Record<string, string>;
  listTimeoutMs: number;
  callTimeoutMs: number;
  readOnly: boolean;
}
export interface McpServerView { name: string; config: McpServer; secrets: Array<{ name: string; configured: boolean }>; source?: ConfigSource }
export interface McpServersPayload { servers: McpServerView[]; disabled?: McpServerView[] }
/** `POST /mcp/:name/test`: the server's tools, or why it could not be reached. */
export interface McpTestReport { name: string; ok: boolean; tools: Array<{ name: string; description: string }>; error?: string }


/** VS-318: one host tool the daemon needs, as `/api/daemon/host-tools` and `/api/health` report it. */
export interface HostToolInfo { id: string; available: boolean; version: string | null; path: string | null; need: 'required' | 'recommended'; purpose: string }
/** VS-318: the daemon host's detected tools plus the configured extra directories. */
export interface DaemonHostTools { paths: string[]; tools: HostToolInfo[] }

export interface LoginResponse {
  token?: string;
  sessionId?: string;
  expiresAt?: string;
  totpRequired?: boolean;
}

export interface AuthMe {
  operator: { username: string; createdAt?: string };
  session: { id: string; kind: AuthSessionKind; name?: string | null; expiresAt?: string };
  totpEnabled: boolean;
}

export interface AuthSession {
  id: string;
  name: string | null;
  kind: AuthSessionKind;
  ip: string | null;
  lastSeenAt: string | null;
  createdAt: string;
  current?: boolean;
}

export interface TotpSetup {
  secret: string;
  otpauthUrl: string;
  recoveryCodes: string[];
}

export interface RuntimeInfo {
  id: string;
  displayName: string;
  /**
   * Mirrors `RuntimeDetection` in @weave-ai/runtime-sdk, which `GET /api/runtimes` returns
   * unchanged. There is no `available` boolean on the wire — declaring an optional one here let the
   * add-project selector read `undefined` and disable every runtime (VS-45), so the shape is exact
   * on purpose: a future SDK change has to fail typecheck here.
   */
  detection: { status: 'available' | 'missing_binary' | 'broken' | 'unsupported'; version?: string | null; path?: string | null; notes?: string | null };
  capabilities: Record<string, unknown>;
  /** The runtime's own JSON Schema for its per-setting options (`ModelSetting.options`). */
  configSchema?: Record<string, unknown>;
  models?: string[];
}

/**
 * `GET /api/workspaces`. Deliberately not the shared `Workspace` row: the daemon sends each loaded
 * workspace's identity, its project ids and the number of decisions waiting on the human — there is
 * no `slug` and there are no timestamps on the wire, and reading one that is not sent is how the
 * rail's workspace entries came to render an empty column.
 *
 * `id` is the slug (the map key and the value routes/links carry); `internalId` is the row's own
 * ULID, which records minted from a run token carry (VS-403), so a consumer can resolve by whichever
 * id it holds instead of comparing the two systems.
 */
export interface WorkspaceListItem {
  id: string;
  internalId: string;
  name: string;
  ticketPrefix: string;
  root: string;
  projects: string[];
  /** Open decisions owned by the human, so every workspace can be badged from one request. */
  needsYou: number;
}

/** One plugin this workspace loads (VS-334): from `daemon.yaml` (`daemon`) or its own `workspace.yaml` (`workspace`). */
export interface WorkspacePlugin {
  id: string;
  version: string | null;
  /** The plugin's own declared display name (VS-385) — the page title/rail label, falling back to `id`. */
  name: string | null;
  source: 'workspace' | 'daemon';
  loaded: boolean;
  error: string | null;
  hasPage: boolean;
}

export interface WorkspaceSummary {
  workspace: Workspace;
  config: Record<string, unknown>;
  /** VS-579: the worker memory limit every role inherits, and where it came from. */
  workerMemory?: { mb: number; source: 'role' | 'workspace' | 'derived' };
  counts?: { projects: number; workers: number; openTickets: number; needsYou: number };
  plugins?: WorkspacePlugin[];
}

export interface TicketDetail {
  ticket: Ticket;
  project: Project | null;
  worker: Agent | null;
  role: Role | null;
  blockers: Ticket[];
  children: Ticket[];
  documents: Array<{ key: string; revision: number; updatedAt: string; title?: string }>;
  workProducts: WorkProduct[];
  attachments: TicketAttachment[];
  openspecState: OpenSpecState | null;
  /** Where the ticket stands in its project's merge queue; `position` is null unless it is waiting. */
  mergeQueue: { position: number | null; concurrency: number };
  /** VS-550: the plan this ticket was created from, or null. */
  plan: PlanOrigin | null;
  usage?: UsageTotals;
}

/** One ticket's place in a project's merge queue (PLAN §11.4). `position` is null while it merges. */
export interface MergeQueueEntry {
  ticketId: string;
  identifier: string;
  title: string;
  projectId: string | null;
  position: number | null;
  queuedAt: string | null;
  startedAt: string | null;
  workerId: string | null;
  /** The ticket's priority, and whether its position is ahead of an earlier join (VS-390). */
  priority: TicketPriority;
  ahead: boolean;
  /** VS-391: the active merge's pull-request check state and when it was first observed. */
  ciState: 'pending' | 'success' | 'failure' | 'none' | null;
  ciStateAt: string | null;
}

/** A ticket that recently left a project's queue: `landed` merged, `failed` could not, `withdrawn` left without either. */
export interface MergeQueueOutcome {
  ticketId: string;
  identifier: string;
  title: string;
  outcome: 'landed' | 'failed' | 'withdrawn';
  at: string;
  mergeCommit: string | null;
}

export interface MergeQueue {
  projectId: string;
  concurrency: number;
  active: MergeQueueEntry[];
  waiting: MergeQueueEntry[];
  recent: MergeQueueOutcome[];
}

/** Matches `workProducts()`'s real wire shape (`ticket_work_products` row, camelCased) — VS-269 fixed
 * a drift here: `ref`/`meta` never existed on the wire, and `title` existed but was untyped. */
export interface WorkProduct {
  id: string;
  ticketId: string;
  runId: string | null;
  type: string;
  provider: string | null;
  externalId: string | null;
  url: string | null;
  title: string | null;
  state: string | null;
  isPrimary: boolean;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

/** `POST /tickets/:id/discard` (VS-346): `discarded: false` with the raised approval's id when the
 * daemon had to ask first, `discarded: true` once an approval lets the work go. */
export interface DiscardResult {
  discarded: boolean;
  decisionId?: string;
  force?: boolean;
  ticket?: Ticket;
}

/** One row of `GET /knowledge/artifacts` (VS-270): a published artifact joined with its own ticket's
 * identifier/title, for the document explorer's Artifacts entry. Not a knowledge document — no slug. */
export interface TicketArtifactSummary {
  id: string;
  ticketId: string;
  ticketIdentifier: string;
  ticketTitle: string;
  key: string;
  title: string | null;
  metadata: Record<string, unknown>;
  url: string | null;
  /** True when the artifact is backed by a stored `artifact:<key>` document (VS-331) — a link-only
   * work product is listed with `false` and must not be opened in the viewer. */
  previewable: boolean;
  updatedAt: string;
}

/** One row of `GET /artifacts` (VS-297): a weaver's workspace-scoped artifact — no ticket at all, so
 * no `ticketId`/`ticketIdentifier` the way `TicketArtifactSummary` above carries. */
export interface WeaverArtifactSummary {
  key: string;
  title: string | null;
  kind: string | null;
  revision: number;
  updatedAt: string;
}

/** One row of `GET /plans/:planId/artifacts` (VS-622): a planner's plan-scoped artifact. */
export interface PlanArtifactSummary {
  key: string;
  title: string | null;
  kind: string | null;
  revision: number;
  updatedAt: string;
}

export interface OpenSpecState {
  changeName: string | null;
  state: string | null;
  tasks: Array<{ text: string; done: boolean }>;
  validated?: boolean;
}

export interface TicketDocument {
  key: string;
  revision: number;
  body: string;
  reason?: string | null;
  createdAt: string;
}

/** `GET /tickets/:id/documents/by-id/:documentId` (VS-224): what a decision's document target fetches. */
export interface TicketDocumentById {
  key: string;
  documentId: string;
  /** The revision this response carries — HEAD unless the query named one. */
  revision: number;
  /** The document's current revision, for the superseded check. */
  currentRevision: number;
  body: string;
  createdAt: string;
}

export interface DocumentRevision {
  revision: number;
  createdAt: string;
  authorKind: string;
  reason: string | null;
}

/** A worker's own pending scheduled wakeup (VS-317): when it asked to be woken, and why. */
export interface WorkerScheduledWake { at: string | null; reason: string }

export interface WorkerDetail {
  agent: Agent;
  ticket: Ticket | null;
  /** VS-495: a persistent session's own conversation thread; null for every other kind. */
  thread: ChannelThread | null;
  role: Role | null;
  project: Project | null;
  lastRun: Run | null;
  usage: UsageTotals | null;
  worktree: { status: string; dirty: boolean; ahead: number; behind: number; path: string | null } | null;
  /** The worker's pending self-wake, if it has one (VS-317). */
  scheduledWake: WorkerScheduledWake | null;
  lastStatusLine?: string | null;
  /**
   * Whether a message sent right now would reach a running turn (VS-99), and why not when it
   * wouldn't. `interrupts` (VS-254): the runtime can't take mid-turn input, but a turn is running,
   * so a live send would interrupt it rather than queue behind it.
   */
  input: { midTurn: boolean; interrupts?: boolean; reason?: string };
  /** Whether this worker's *next* turn would resume its existing session rather than start fresh (VS-106). */
  sessionResumable: boolean;
  /** VS-526: turns taken by the current session; 0 means a fresh conversation (e.g. after a runtime change). Null when the agent has no session. */
  sessionTurns?: number | null;
  /** True while the session is being compacted out of band: wakes are held, so a message sent now is queued. */
  compacting: boolean;
  compactingError: string | null;
}

/**
 * `POST /workers/:id/message` result (VS-99): which delivery actually happened. `'interrupted'`
 * (VS-254) is a human's live send that cancelled the running turn on a runtime that cannot take
 * mid-turn input, rather than queuing behind it.
 */
export interface WorkerMessageOutcome { delivery: 'mid_turn' | 'queued' | 'interrupted'; runId: string | null; wakeId: string | null }

/** `GET/POST /workers/:id/handover(-command)` (VS-249): the offered resume command, or why there is none. */
export interface HandoverCommandResult { resumable: boolean; command: string | null; runtime: string; landingLine: string | null; reason: string | null }
/** `POST /workers/:id/handback` result (VS-249). */
export interface HandoverEndResult {
  note: string;
  reconciliation: {
    worktree: { headBefore: string | null; headAfter: string | null; newCommits: number; dirty: boolean; changedFiles: number };
    sessionActivityDetected: boolean;
    durationMs: number;
  };
}

export interface RoleDetail {
  role: Role;
  charter: string;
  revisions: Array<{ revision: number; createdAt: string; reason: string | null }>;
  workers: Agent[];
  concurrency?: RoleConcurrency;
  usage?: UsageTotals;
}

/** What actually caps a role's workers: its own limit, its project's, and how much of it is in use. */
export interface RoleConcurrency { roleMax: number; projectMax: number; effective: number; live: number; projectLive: number; free: number }

export interface RunDetail {
  run: Run;
  agent: Agent | null;
  ticket: Ticket | null;
  phases: Array<{ phase: string; durationMs: number }>;
  usage: UsageTotals | null;
}

export interface UsageTotals {
  tokensIn: number;
  tokensOut: number;
  tokensCached: number;
  runs: number;
  workerTurns: number;
  durationMs: number;
  costCents: number | null;
  costStatus: CostStatus;
}

export interface UsagePoint extends UsageTotals {
  bucket: string;
}

export interface UsageSeries {
  scope: string;
  window: UsageWindow;
  grain: UsageGrain;
  start: string;
  end: string;
  series: UsagePoint[];
  total: UsageTotals;
  previous?: UsageTotals;
  reportedShare?: number;
  /** Tokens in this window per billing type; drives whether cost is shown at all. */
  billingMix?: UsageBillingMix;
}

/** One runtime account snapshot as `GET /usage/accounts` serves it. */
export interface UsageAccount extends RuntimeAccount { displayName: string }

/** The answer to `POST /usage/accounts/refresh` (VS-84): the snapshots, and what happened to each. */
export interface UsageAccountSync { accounts: UsageAccount[]; synced: string[]; throttled: AccountSyncThrottle[]; failed: AccountSyncFailure[] }

/** One runtime's credential state as `GET /usage/credentials` serves it. Carries no token (VS-75). */
export interface UsageCredential extends RuntimeCredential { displayName: string }

export interface UsageTopRow {
  key: string;
  label: string;
  sublabel?: string | null;
  tokens: number;
  costCents: number | null;
  costStatus: CostStatus;
  share?: number;
}

export interface UsageModelRow extends UsageTopRow {
  model: string;
  series?: UsagePoint[];
}

/**
 * Knowledge context (VS-110): the hub tokens and distinct documents a run's or a ticket's turns
 * actually consumed — separate from `UsageTotals` above, which is billed model tokens.
 */
export interface KnowledgeContextUsage {
  hubTokens: number;
  documentTokens: number;
  totalTokens: number;
  documents: Array<{ scope: KnowledgeScope; projectId: string | null; slug: string | null; tokens: number }>;
}

export interface KnowledgeUsageSummary { averageTokensPerRun: number; runs: number }

export interface KnowledgeDocumentUsage { scope: KnowledgeScope; projectId: string | null; slug: string; title: string | null; reads: number; tokens: number }

export interface KnowledgeDocumentRef { scope: KnowledgeScope; projectId: string | null; slug: string; title: string | null; tokenEstimate: number }

export interface KnowledgeIndex {
  files: Array<KnowledgeFile & { title?: string | null; projectSlug?: string | null; kind?: 'hub' | 'doc'; curationDueInDays?: number | null }>;
  warnings: string[];
}

export interface KnowledgeDocSummary {
  path: string; scope: string; projectId: string | null; projectSlug: string | null; slug: string; folder: string | null; title: string; summary: string;
  tokenEstimate: number; budgetTokens: number; links: number; backlinks: number; updatedAt: string;
}

export interface KnowledgeArchiveEntry { path: string; date: string }
export interface KnowledgeArchiveFile { path: string; body: string }
export interface KnowledgeDocDetail extends KnowledgeDocSummary {
  body: string; revision: number;
  linksTo: Array<{ slug: string; path: string | null; title: string | null }>;
  linkedFrom: Array<{ path: string; slug: string | null; title: string | null }>;
}
export interface KnowledgeGraph {
  nodes: Array<{ id: string; kind: 'hub' | 'doc'; scope: string; projectId: string | null; projectSlug: string | null; slug: string | null; title: string; tokens: number; updatedAt: string }>;
  edges: Array<{ from: string; to: string }>;
}

/** The knowledge network's health (VS-102): derived on read, no `project` means the whole workspace. */
export interface KnowledgeHealth {
  hubs: Array<{ path: string; scope: string; projectId: string | null; projectSlug: string | null; tokenEstimate: number; budgetTokens: number; pct: number; nearBudget: boolean; curationPending: boolean; lastCuratedAt: string | null }>;
  orphans: KnowledgeDocSummary[];
  stale: KnowledgeDocSummary[];
  /** VS-492: documents no run has read within the configured never-read window. */
  neverRead: KnowledgeDocSummary[];
  unresolvedLinks: Array<{ fromPath: string; fromTitle: string; toSlug: string }>;
}

export interface KnowledgeDoc {
  path: string;
  scope: string;
  body: string;
  tokenEstimate: number;
  budgetTokens: number;
  lastCuratedAt: string | null;
  curationPending: boolean;
  revision?: number;
}

export interface KnowledgeRevision {
  revision: number;
  createdAt: string;
  reason: string;
  tokenEstimate: number;
  /** Which ticket produced this revision (VS-102); null for a human edit or a daemon seed, or a revision recorded before provenance existed. */
  ticketId: string | null;
  ticketIdentifier: string | null;
  /** VS-492: the existing claims this revision recorded as superseded, empty when it recorded none. */
  superseded: string[];
}

export interface SearchHit {
  kind: 'capability' | 'requirement' | 'change' | 'knowledge';
  projectId: string | null;
  projectSlug: string | null;
  title: string;
  subtitle: string | null;
  href: { capability?: string; change?: string; scope?: string };
  snippet?: string | null;
}

export interface PendingChange {
  changeName: string;
  ticketId: string | null;
  ticketIdentifier: string | null;
  deltaKind: string;
}

export interface CapabilitySummary {
  id: string;
  capability: string;
  title: string | null;
  requirementCount: number;
  lastArchivedChange: string | null;
  updatedAt: string;
  pendingChanges: PendingChange[];
}

export interface Requirement {
  name: string;
  text: string;
  scenarios: Array<{ text?: string; steps?: Array<{ word: string; text: string }> }>;
  /** Inline pending delta (PLAN §12.5): set for a requirement an active change is about to touch, absent otherwise. */
  delta?: { kind: 'ADDED' | 'MODIFIED' | 'REMOVED' | 'RENAMED'; changeName: string; ticketIdentifier: string | null; state: string } | null;
}

/** `GET /specs/:project/capabilities/:capability` — flat, exactly as core `getCapability` returns it. */
export interface CapabilityDetail {
  id: string;
  capability: string;
  title: string | null;
  body: string;
  requirements: Requirement[];
  pending: PendingChange[];
  history: Array<{ changeName: string; ticketId: string | null; ticketIdentifier: string | null; state: string; archivedAs: string | null; archivedAt: string | null }>;
}

export interface SpecChangeSummary {
  changeName: string;
  state: 'active' | 'archived';
  ticketId: string | null;
  ticketIdentifier: string | null;
  createdAt: string | null;
  archivedAt: string | null;
  capabilities: Array<{ capability: string; deltaKind: string }>;
  taskProgress?: { done: number; total: number };
}

export interface SpecChangeDetail extends SpecChangeSummary {
  proposal: string | null;
  design: string | null;
  tasks: Array<{ text: string; done: boolean }>;
  deltas: Array<{ capability: string; kind: string; body: string }>;
}

/** `GET /projects/:id/pull-requests` (VS-97). Flat, exactly as the daemon joins it. */
export type PullRequestUnavailable = 'no_forge' | 'not_authenticated' | 'no_clone' | 'unsupported' | 'unreachable' | 'no_local_branch';
export type PullRequestChecks = 'pending' | 'success' | 'failure' | 'none';

export interface PullRequestTicket { id: string; identifier: string; title: string; status: TicketStatus; hasPlan: boolean }

export interface ProjectPullRequest {
  number: number;
  title: string;
  url: string;
  author: string | null;
  state: 'open' | 'merged' | 'closed';
  isDraft: boolean;
  headRefName: string;
  baseRefName: string;
  createdAt: string;
  updatedAt: string;
  mergedAt: string | null;
  closedAt: string | null;
  additions: number;
  deletions: number;
  changedFiles: number;
  checks: PullRequestChecks;
  reviewDecision: string | null;
  mergeCommit: string | null;
  ticket: PullRequestTicket | null;
  /** The OpenSpec change its ticket implements; null when it has no ticket or the ticket names none. */
  changeName: string | null;
  queue: { state: 'landing' | 'waiting'; position: number | null } | null;
}

export interface ProjectPullRequestDetail extends ProjectPullRequest {
  body: string;
  files: Array<{ path: string; additions: number; deletions: number }>;
  checkRuns: Array<{ name: string; state: PullRequestChecks; url: string | null }>;
  /** The pull request's current head commit (VS-452), or null when the forge reports none. */
  headSha: string | null;
}

/** `available: false` is a settled statement about the project, never a failed request. */
export interface ProjectPullRequests {
  projectId: string;
  available: boolean;
  reason: PullRequestUnavailable | null;
  message: string | null;
  stale: boolean;
  capturedAt: string;
  windowDays: number;
  open: ProjectPullRequest[];
  recent: ProjectPullRequest[];
}

export interface PullRequestDetailResult {
  projectId: string;
  available: boolean;
  reason: PullRequestUnavailable | null;
  message: string | null;
  stale: boolean;
  /** Null with `available: true` means the forge has no such pull request. */
  pullRequest: ProjectPullRequestDetail | null;
}

/** `GET /projects/:id/pull-requests/:number/diff` (VS-107). Never carries a hunk — the cheap manifest a file tree renders from. */
export interface DiffFileSummary {
  path: string; previousPath: string | null; status: DiffFileStatus;
  additions: number; deletions: number; binary: boolean; tooLarge: boolean;
}
export interface PullRequestDiffFilesResult {
  projectId: string; number: number; available: boolean; reason: PullRequestUnavailable | null; message: string | null; stale: boolean;
  files: DiffFileSummary[];
}

/** `GET /projects/:id/pull-requests/:number/diff/file` (VS-107). */
export interface DiffFileContent extends DiffFileSummary { hunks: DiffHunk[] }
export interface PullRequestDiffFileResult {
  projectId: string; number: number; available: boolean; reason: PullRequestUnavailable | null; message: string | null;
  /** `available: true` with `file: null` means the diff has no such path. */
  file: DiffFileContent | null;
}

/** `GET /projects/:id/pull-requests/:number/diff/file/context` (VS-107): a collapsed region's expand control. */
export interface PullRequestDiffContextResult {
  projectId: string; number: number; available: boolean; reason: PullRequestUnavailable | null;
  lines: string[];
}

/** `GET /projects/:id/history` (VS-96). A branch the history covers — the default branch, a worker's, or an unfinished ticket's. */
export interface ProjectRef {
  name: string; sha: string; isDefault: boolean;
  ticketId: string | null; ticketIdentifier: string | null;
  agentId: string | null; agentName: string | null;
}
export interface HistoryCommit { sha: string; parents: string[]; author: string; authoredAt: string; subject: string; refs: string[] }
/** `cursor` pins the ref tips the first page resolved; `null` means there is no more. */
export interface HistoryPage { refs: ProjectRef[]; commits: HistoryCommit[]; cursor: string | null }

/** `GET /projects/:id/commits/:sha`. A merge's files are reported against its first parent. */
export interface CommitFile { path: string; previousPath: string | null; status: 'added' | 'modified' | 'deleted' | 'renamed'; additions: number; deletions: number }
export interface CommitDetail {
  sha: string; parents: string[]; author: string; email: string; authoredAt: string; committedAt: string;
  message: string; files: CommitFile[]; truncatedFiles: number; forgeUrl: string | null;
}

export interface SpecGraph {
  nodes: Array<{ id: string; kind: 'capability' | 'change' | 'ticket'; label: string; status?: string | null; updatedAt?: string | null }>;
  edges: Array<{ from: string; to: string; kind: string }>;
}

export interface ThreadSummary {
  id: string;
  channelId: string;
  agentId: string;
  ticketId: string | null;
  humanLabel: string | null;
  lastMessageAt: string | null;
  createdAt: string;
}

export interface ThreadMessagesPage {
  messages: ThreadMessage[];
  hasMore?: boolean;
}

/** `GET /presentation/surfaces` — the surface kinds this daemon can hand to a presenter. */
export interface PresentationSurfaces {
  surfaces: string[];
}

/** `GET /channels/telegram/token` (VS-125) — never a value, only whether one is configured and where it came from. */
export interface TelegramTokenStatus {
  configured: boolean;
  source: 'secret' | 'env' | null;
  botUsername: string | null;
}

/** One row of `GET /channels/telegram/pending` (VS-135) — identity only, never the message that triggered it. */
export interface TelegramPendingUser {
  externalUserId: string;
  username: string | null;
  displayName: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  attemptCount: number;
}

export type { PresentationConfig };

export type { Agent, Briefing, Decision, Project, Role, Run, RunEvent, Ticket, TicketComment, ThreadMessage, ThreadSearchResult, Workspace };
export type { ChangelogDay, ChangelogEntry, ChangelogHeatmap, ChangelogKind, ChangelogPage };
