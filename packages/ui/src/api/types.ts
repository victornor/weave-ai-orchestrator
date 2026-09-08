/**
 * Response shapes for docs/API.md. Entities come from @agent-conductor/shared;
 * these are the envelopes the HTTP layer wraps them in.
 */
import type { DiffFileStatus, DiffHunk } from '@agent-conductor/render';
import type {
  Agent,
  Briefing,
  ChangelogDay,
  ChangelogEntry,
  ChangelogHeatmap,
  ChangelogKind,
  ChangelogPage,
  Decision,
  KnowledgeFile,
  KnowledgeScope,
  Project,
  Role,
  Run,
  RunEvent,
  Ticket,
  TicketComment,
  TicketStatus,
  ThreadMessage,
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
} from '@agent-conductor/shared';

export interface Health {
  ok: boolean;
  version: string;
  release?: RunningRelease;
  workspaces: Array<{ id: string; name: string; status: string }>;
  operatorConfigured: boolean;
  tlsMode: string;
  publicUrl?: string;
  transcription?: { configured: boolean };
  host?: {
    platform: string;
    hostname: string;
    home: string;
    defaultWorkspaceRoot: string;
    tools: Record<string, { id: string; available: boolean; version: string | null; need: 'required' | 'recommended'; purpose: string }>;
  };
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

export interface RuntimeModel { id: string; label: string; provider?: string; source?: 'detected' | 'static'; tier?: string; notes?: string; contextWindowTokens?: number }

/** One of the two model settings a workspace holds (VS-77): `GET`/`PUT /models`. */
export interface ModelSetting { runtime: string; model: string | null; effort?: string }
export interface WorkspaceModels { conductor: ModelSetting; workers: ModelSetting }

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
   * Mirrors `RuntimeDetection` in @agent-conductor/runtime-sdk, which `GET /api/runtimes` returns
   * unchanged. There is no `available` boolean on the wire — declaring an optional one here let the
   * add-project selector read `undefined` and disable every runtime (VS-45), so the shape is exact
   * on purpose: a future SDK change has to fail typecheck here.
   */
  detection: { status: 'available' | 'missing_binary' | 'broken' | 'unsupported'; version?: string | null; path?: string | null; notes?: string | null };
  capabilities: Record<string, unknown>;
  models?: string[];
}

/**
 * `GET /api/workspaces`. Deliberately not the shared `Workspace` row: the daemon sends each loaded
 * workspace's identity, its project ids and the number of decisions waiting on the human — there is
 * no `slug` and there are no timestamps on the wire, and reading one that is not sent is how the
 * rail's workspace entries came to render an empty column.
 */
export interface WorkspaceListItem {
  id: string;
  name: string;
  ticketPrefix: string;
  root: string;
  projects: string[];
  /** Open decisions owned by the human, so every workspace can be badged from one request. */
  needsYou: number;
}

export interface WorkspaceSummary {
  workspace: Workspace;
  config: Record<string, unknown>;
  counts?: { projects: number; workers: number; openTickets: number; needsYou: number };
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
  openspecState: OpenSpecState | null;
  /** Where the ticket stands in its project's merge queue; `position` is null unless it is waiting. */
  mergeQueue: { position: number | null; concurrency: number };
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

export interface WorkProduct {
  id: string;
  type: string;
  url: string | null;
  ref: string | null;
  state: string | null;
  meta: Record<string, unknown> | null;
  createdAt: string;
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

export interface DocumentRevision {
  revision: number;
  createdAt: string;
  authorKind: string;
  reason: string | null;
}

export interface WorkerDetail {
  agent: Agent;
  ticket: Ticket | null;
  role: Role | null;
  project: Project | null;
  lastRun: Run | null;
  usage: UsageTotals | null;
  worktree: { status: string; dirty: boolean; ahead: number; behind: number; path: string | null } | null;
  lastStatusLine?: string | null;
  /** Whether a message sent right now would reach a running turn (VS-99), and why not when it wouldn't. */
  input: { midTurn: boolean; reason?: string };
  /** Whether this worker's *next* turn would resume its existing session rather than start fresh (VS-106). */
  sessionResumable: boolean;
}

/** `POST /workers/:id/message` result (VS-99): which delivery actually happened. */
export interface WorkerMessageOutcome { delivery: 'mid_turn' | 'queued'; runId: string | null; wakeId: string | null }

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
  path: string; scope: string; projectId: string | null; projectSlug: string | null; slug: string; title: string; summary: string;
  tokenEstimate: number; budgetTokens: number; links: number; backlinks: number; updatedAt: string;
}
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

export type { PresentationConfig };

export type { Agent, Briefing, Decision, Project, Role, Run, RunEvent, Ticket, TicketComment, ThreadMessage, Workspace };
export type { ChangelogDay, ChangelogEntry, ChangelogHeatmap, ChangelogKind, ChangelogPage };
