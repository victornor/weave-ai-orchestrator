/**
 * Core service interfaces. Server, MCP tools, CLI and tests code against these; implementations live in core/src/<module>/.
 * Every mutation writes an activity row and emits an event. Errors are OcError with a code from shared.
 */
import type * as S from '@agent-conductor/shared';

export interface Actor { kind: 'human' | 'agent' | 'system'; id: string | null; runId?: string | null }
export interface Page<T> { items: T[]; total: number }

// ---------- tickets ----------
export interface TicketCreateInput { projectId?: string | null; kind: S.TicketKind; title: string; description?: string; priority?: S.TicketPriority; parentId?: string | null; blockedBy?: string[]; assigneeRoleId?: string | null; autoMerge?: boolean; originKind?: string; originFingerprint?: string }
/** `sort: 'finished'` orders by when a ticket reached done or cancelled, so a page of terminal tickets is the most recently finished ones rather than the most recently created. */
export interface TicketFilter { projectId?: string; status?: S.TicketStatus[]; kind?: S.TicketKind[]; roleId?: string; workerId?: string; search?: string; limit?: number; offset?: number; includeTerminal?: boolean; sort?: 'number' | 'finished' }
export interface TransitionInput { to: S.TicketStatus; note?: string; unblock?: { owner: 'conductor' | 'human'; action: string }; blockedBy?: string[] }
export interface TicketsService {
  create(actor: Actor, input: TicketCreateInput): S.Ticket;
  get(id: string): S.Ticket;                      // id or identifier
  list(filter?: TicketFilter): Page<S.Ticket>;
  update(actor: Actor, id: string, patch: Partial<Pick<S.Ticket, 'title' | 'description' | 'priority' | 'autoMerge' | 'parentId' | 'projectId'>>): S.Ticket;
  assign(actor: Actor, id: string, roleId: string | null): S.Ticket;
  setBlockers(actor: Actor, id: string, blockedBy: string[]): S.Ticket;
  blockers(id: string): S.Ticket[];
  children(id: string): S.Ticket[];
  checkout(actor: Actor, id: string, runId: string, agentId: string): S.Ticket;
  release(actor: Actor, id: string, runId: string, note?: string): S.Ticket;
  /** Async: the `proposed` gate shells out to the OpenSpec CLI (PLAN §12.2). */
  transition(actor: Actor, id: string, input: TransitionInput): Promise<S.Ticket>;
  cancel(actor: Actor, id: string, reason: string): S.Ticket;
  comment(actor: Actor, id: string, body: string, kind?: S.CommentKind, sourceTrust?: S.SourceTrust): S.TicketComment;
  /** Relaunch the ticket's worker (or spawn one) after a failure or a pause; blocked tickets go back to work. */
  retry(actor: Actor, id: string, note?: string): Promise<S.Ticket>;
  comments(id: string, after?: string): S.TicketComment[];
  putDocument(actor: Actor, id: string, key: string, body: string): { documentId: string; revision: number };
  getDocument(id: string, key: string, revision?: number): { documentId: string; revision: number; body: string; createdAt: string } | null;
  documentRevisions(id: string, key: string): Array<{ revision: number; authorKind: string; createdAt: string }>;
  /** Every document on a ticket with its current revision — the catalogue an agent reads before asking for one by key. */
  documents(id: string): Array<{ key: string; revision: number; updatedAt: string }>;
  addWorkProduct(actor: Actor, id: string, wp: { type: S.WorkProductType; url?: string; title?: string; state?: string; provider?: string; externalId?: string; isPrimary?: boolean; metadata?: Record<string, unknown> }): { id: string };
  workProducts(id: string): Array<Record<string, unknown>>;
  /** Async: archives the OpenSpec change after the merge is verified (PLAN §12.2). */
  mergeDone(actor: Actor, id: string, info: { mergeCommit?: string; method?: string }): Promise<S.Ticket>;
  /** The per-project merge queue that decides which approved ticket merges now (PLAN §11.4). */
  mergeQueue: MergeQueueService;
  /** Liveness scan helper: tickets in active statuses without an action path. */
  livenessViolations(): S.Ticket[];
  /** Move `in_review` tickets with auto_merge on to `merging` once their delivery is ready (local-branch: immediately; pr: CI green or no CI). Returns how many advanced. */
  autoMergeSweep(): Promise<number>;
  nextIdentifier(): string;
  /** Async: cancel the follow-up work a merge or an `in_review` scheduled but has not run yet, and await what is already in flight. Never rejects; safe to call when idle and more than once. Drain before disposing of the workspace database. */
  stop(): Promise<void>;
}

// ---------- merge queue ----------
/** One ticket's place in a project's merge queue. `position` is null for a ticket already merging. */
export interface MergeQueueEntry { ticketId: string; identifier: string; title: string; projectId: string | null; position: number | null; queuedAt: string | null; startedAt: string | null; workerId: string | null }
/** A ticket that recently left a project's queue: `landed` merged, `failed` could not, `withdrawn` left without either. */
export interface MergeQueueOutcome { ticketId: string; identifier: string; title: string; outcome: 'landed' | 'failed' | 'withdrawn'; at: string; mergeCommit: string | null }
export interface MergeQueueView { projectId: string; concurrency: number; active: MergeQueueEntry[]; waiting: MergeQueueEntry[]; recent: MergeQueueOutcome[] }
export interface MergeQueueService {
  /** How many tickets of the project may be in the active merge step at once (policy, default 1). */
  limitFor(projectId: string | null): number;
  /** The ticket's 1-based place among its project's waiting tickets, or null when it is not waiting. */
  positionOf(ticketId: string): number | null;
  /** The tickets that recently left the project's queue, most recent first, read back from activity. */
  recentOf(projectId: string, limit?: number): MergeQueueOutcome[];
  forProject(projectId: string): MergeQueueView;
  /** Async: join the queue and pump it. The join time is stamped once and never moved. */
  join(ticketId: string): Promise<void>;
  /** Async: leave the queue, give the slot back, and admit the next waiting ticket. */
  leave(ticketId: string): Promise<void>;
  /** Async: admits waiting tickets up to the limit, spawning and waking their workers. */
  pump(projectId: string | null): Promise<number>;
  /** Async: pumps every project that holds a merging ticket. */
  pumpAll(): Promise<number>;
}

// ---------- decisions ----------
export interface DecisionCreateInput { ticketId?: string | null; kind: S.DecisionKind; owner?: S.DecisionOwner; title: string; context?: string; options?: S.Decision['options']; allowFreeText?: boolean; recommendation?: string | null; expiresInHours?: number; target?: Record<string, unknown>; correlationKey?: string; askedByAgentId?: string | null; askedInRunId?: string | null }
export interface DecisionsService {
  create(actor: Actor, input: DecisionCreateInput): S.Decision;
  get(id: string): S.Decision;
  list(filter?: { status?: S.DecisionStatus[]; owner?: S.DecisionOwner; ticketId?: string; limit?: number }): S.Decision[];
  /** Async: side effects drive ticket transitions and role activation. */
  answer(actor: Actor, id: string, answer: { key?: string; text?: string; remember?: boolean }): Promise<S.Decision>;
  withdraw(actor: Actor, id: string, reason: string): S.Decision;
  supersedeForTarget(actor: Actor, ticketId: string, correlationKey: string): number;
  expireDue(): Promise<S.Decision[]>;
}

// ---------- jobs ----------
/** One item of a job's stream: a sub-step transition, an output line, or the job ending. */
export type JobStreamItem =
  | { kind: 'step'; jobId: string; step: S.JobStep; seq: number }
  | { kind: 'log'; jobId: string; line: S.JobLogLine; seq: number }
  | { kind: 'finished'; jobId: string; job: S.Job; seq: number };
export interface JobFilter { kind?: S.JobKind; entityId?: string; limit?: number }
export interface JobsService {
  get(id: string): S.Job;
  list(filter?: JobFilter): S.Job[];
  /** The job still running for an entity, if any — what stops a second one from starting. */
  running(entityId: string): S.Job | null;
  start(kind: S.JobKind, entity: { type: string; id: string }, actor: Actor): S.Job;
  step(jobId: string, stepId: string, state: S.JobStepState): void;
  line(jobId: string, stepId: string, stream: S.JobLogStream, text: string): void;
  finish(jobId: string, state: Exclude<S.JobState, 'running'>, extra?: { failedStep?: string | null; message?: string | null }): S.Job;
  onItem(handler: (item: JobStreamItem) => void): () => void;
  /** Startup: fail the jobs a previous process left running. */
  reconcile(): void;
  /** Async: write every log tail still held in memory and cancel the timers waiting to do it. Never rejects; safe to call when idle and more than once. Drain before disposing of the workspace database. */
  stop(): Promise<void>;
}

// ---------- projects / roles / agents ----------
export interface ProjectsService {
  list(): S.Project[]; get(id: string): S.Project;
  add(actor: Actor, cfg: S.ProjectConfig): Promise<S.Project>;         // clone, worktrunk config, openspec init, seed KB, scout ticket
  /** The same pipeline, answered immediately: the row exists, the job reports the rest. */
  startAdd(actor: Actor, cfg: S.ProjectConfig): { project: S.Project; jobId: string };
  /** Re-run the pipeline for a project left in `error`, reusing whatever is already on disk. */
  retryAdd(actor: Actor, id: string): { project: S.Project; jobId: string };
  update(actor: Actor, id: string, patch: Partial<S.ProjectConfig>): Promise<S.Project>;
  remove(actor: Actor, id: string): Promise<void>;
  fetch(id: string): Promise<{ head: string; fastForwarded: boolean }>;   // git fetch + ff primary clone
  reconcile(): Promise<void>;                                              // declared vs db
}
export interface RolesService {
  list(projectId?: string): S.Role[]; get(id: string): S.Role;
  hire(actor: Actor, spec: S.RoleSpec, opts?: { autoActivate?: boolean }): Promise<{ role: S.Role; decisionId: string | null }>;
  activate(actor: Actor, id: string, opts?: { runtime?: string; model?: string | null }): Promise<S.Role>;
  update(actor: Actor, id: string, patch: Partial<S.RoleSpec>, reason: string, opts?: { applyToRunning?: boolean }): Promise<S.Role>;
  updateCharter(actor: Actor, id: string, charter: string, reason: string, opts?: { applyToRunning?: boolean }): Promise<S.Role>;
  charter(id: string): string;
  revisions(id: string): Array<{ revision: number; author: string; reason: string | null; changedKeys: string[]; createdAt: string }>;
  rollback(actor: Actor, id: string, revision: number): Promise<S.Role>;
  pause(actor: Actor, id: string, reason: string): S.Role; resume(actor: Actor, id: string): S.Role;
  retire(actor: Actor, id: string, reason: string): Promise<{ role: S.Role; decisionId: string | null }>;
  freeSlots(id: string): number;
  concurrency(id: string): RoleConcurrency;
}
/** What actually caps a role's workers: its own limit, its project's, and how much of it is in use. */
export interface RoleConcurrency { roleMax: number; projectMax: number; effective: number; live: number; projectLive: number; free: number }
export interface WorkersService {
  list(filter?: { status?: S.AgentStatus[]; projectId?: string; roleId?: string; includeRetired?: boolean }): S.Agent[];
  get(id: string): S.Agent;
  conductor(): S.Agent;
  ensureConductor(): Promise<S.Agent>;
  spawnForTicket(actor: Actor, ticketId: string): Promise<S.Agent>;       // brief, home, worktree, session placeholder, first wake
  spawnCurator(actor: Actor, projectId: string): Promise<S.Agent>;
  message(actor: Actor, workerId: string, body: string): Promise<S.Wakeup>;  // comment + conductor_request wake
  relaunch(actor: Actor, workerId: string, note: string): Promise<S.Agent>;
  cancel(actor: Actor, workerId: string, reason: string): Promise<S.Agent>;
  pause(actor: Actor, id: string, reason: string): S.Agent; resume(actor: Actor, id: string): S.Agent;
  retireIfLanded(actor: Actor, workerId: string): Promise<{ retired: boolean; reason?: string }>;
  brief(workerId: string): string;
  resetSession(actor: Actor, id: string, reason: string): Promise<void>;
}

// ---------- wake / runs ----------
export interface EnqueueInput { source: S.WakeSource; reason: string; payload?: Record<string, unknown>; idempotencyKey?: string; notBefore?: string; requestedBy?: Actor }
export interface WakeService {
  enqueue(agentId: string, input: EnqueueInput): S.Wakeup;
  listForAgent(agentId: string, status?: S.WakeStatus[]): S.Wakeup[];
  cancelForAgent(agentId: string, reason: string): number;
}
export interface RunsService {
  list(filter?: { agentId?: string; ticketId?: string; status?: S.RunStatus[]; limit?: number; offset?: number }): Page<S.Run>;
  get(id: string): S.Run;
  events(id: string, afterSeq?: number, limit?: number): S.RunEvent[];
  cancel(actor: Actor, id: string, mode?: 'interrupt' | 'kill'): Promise<void>;
  onEvent(handler: (runId: string, ev: S.RunEvent) => void): () => void;
}
export interface Dispatcher { tick(): Promise<void>; start(): void; stop(): Promise<void>; running(): number }
export interface Supervisor { tick(): Promise<void>; start(): void; stop(): void }

// ---------- knowledge / specs ----------
export interface KnowledgeService {
  get(scope: S.KnowledgeScope, projectId?: string | null): { path: string; body: string; tokenEstimate: number; budgetTokens: number; lastCuratedAt: string | null; curationPending: boolean; revision: number };
  note(actor: Actor, scope: S.KnowledgeScope, section: string, text: string, projectId?: string | null): { remainingTokens: number; revision: number };
  replace(actor: Actor, scope: S.KnowledgeScope, body: string, reason: S.KnowledgeRevisionReason, projectId?: string | null, removed?: string[]): { revision: number };
  revisions(scope: S.KnowledgeScope, projectId?: string | null): Array<{ revision: number; authorKind: string; reason: string; createdAt: string }>;
  revert(actor: Actor, scope: S.KnowledgeScope, revision: number, projectId?: string | null): { revision: number };
  lint(): Array<{ path: string; scope: string; projectId: string | null; tokenEstimate: number; budgetTokens: number; pct: number; lastCuratedAt: string | null; curationPending: boolean }>;
  requestCuration(actor: Actor, scope: S.KnowledgeScope, projectId?: string | null): Promise<{ ticketId?: string; wakeId?: string }>;
  search(query: string, projectId?: string | null, limit?: number): Array<{ kind: string; projectId: string | null; ref: string; title: string; snippet: string }>;
  reindex(): void;
  bootstrapDigest(agentId: string): { text: string; tokens: number; truncated: boolean };
  appendDecision(decision: S.Decision): void;
  /** Linked documents (PLAN §13): topic pages under a scope that link to each other with [[slug]]. */
  listDocs(filter?: { scope?: S.KnowledgeScope; projectId?: string | null }): KnowledgeDocSummary[];
  getDoc(scope: S.KnowledgeScope, slug: string, projectId?: string | null): KnowledgeDocDetail;
  putDoc(actor: Actor, scope: S.KnowledgeScope, slug: string, body: string, projectId?: string | null, reason?: S.KnowledgeRevisionReason): KnowledgeDocWriteResult;
  deleteDoc(actor: Actor, scope: S.KnowledgeScope, slug: string, projectId?: string | null): void;
  graph(projectId?: string | null): KnowledgeGraph;
}
export interface KnowledgeDocSummary {
  path: string; scope: S.KnowledgeScope; projectId: string | null; projectSlug: string | null; slug: string; title: string; summary: string;
  tokenEstimate: number; budgetTokens: number; links: number; backlinks: number; updatedAt: string;
}
export interface KnowledgeDocDetail extends KnowledgeDocSummary {
  body: string; revision: number;
  linksTo: Array<{ slug: string; path: string | null; title: string | null }>;
  linkedFrom: Array<{ path: string; slug: string | null; title: string | null }>;
}
export interface KnowledgeDocWriteResult { path: string; revision: number; tokenEstimate: number; budgetTokens: number; unresolvedLinks: string[]; backlinks: number; orphan: boolean }
export interface KnowledgeGraph {
  nodes: Array<{ id: string; kind: 'hub' | 'doc'; scope: S.KnowledgeScope; projectId: string | null; projectSlug: string | null; slug: string | null; title: string; tokens: number; updatedAt: string }>;
  edges: Array<{ from: string; to: string }>;
}
/** An active change touching a capability, as the capability lists show it. */
export interface PendingChange { changeName: string; ticketId: string | null; ticketIdentifier: string | null; deltaKind: string }
/** What an active change is about to do to one requirement, shown inline on the requirement (PLAN §12.5). */
export interface RequirementDelta { kind: 'ADDED' | 'MODIFIED' | 'REMOVED' | 'RENAMED'; changeName: string; ticketIdentifier: string | null; state: 'pending' }
/**
 * A capability's requirement as the spec index holds it, with the pending delta of the active change that
 * is about to touch it. A requirement an active change only adds has no scenarios on the default branch
 * yet, so its text and scenarios come from the delta spec.
 */
export interface CapabilityRequirement { name: string; text: string; scenarios: unknown[]; delta: RequirementDelta | null }
/** One indexed OpenSpec change, parsed for its clients: the raw folder lives in `artifacts_json`. */
export interface SpecChangeSummary {
  id: string; changeName: string; state: 'active' | 'archived'; ticketId: string | null; ticketIdentifier: string | null;
  archivedAs: string | null; archivedAt: string | null; createdAt: string | null; updatedAt: string;
  capabilities: Array<{ capability: string; deltaKind: string }>; taskProgress: { done: number; total: number };
}
export interface SpecChangeDetail extends SpecChangeSummary {
  proposal: string | null; design: string | null; tasks: Array<{ text: string; done: boolean }>;
  deltas: Array<{ capability: string; kind: 'added' | 'modified' | 'removed' | 'renamed'; body: string }>;
}
export interface SpecsService {
  index(projectId: string): Promise<{ capabilities: number; changes: number }>;
  listCapabilities(projectId: string): Array<{ id: string; capability: string; title: string | null; requirementCount: number; lastArchivedChange: string | null; pendingChanges: PendingChange[]; updatedAt: string }>;
  getCapability(projectId: string, capability: string): { id: string; capability: string; title: string | null; body: string; requirements: CapabilityRequirement[]; pending: PendingChange[]; history: Array<{ changeName: string; ticketId: string | null; ticketIdentifier: string | null; state: string; archivedAs: string | null; archivedAt: string | null }> };
  listChanges(projectId: string, state?: 'active' | 'archived'): SpecChangeSummary[];
  getChange(projectId: string, changeName: string): SpecChangeDetail;
  graph(projectId: string): { nodes: Array<{ id: string; kind: 'capability' | 'change' | 'ticket'; label: string; status?: string }>; edges: Array<{ from: string; to: string; kind: 'touches' | 'belongs_to' }> };
  search(query: string, projectId?: string | null): Array<{ kind: string; projectId: string; ref: string; title: string; snippet: string }>;
}
export interface OpenSpecStatus { changeName: string; planningComplete: boolean; artifacts: Array<{ id: string; status: string }>; tasks: { total: number; complete: number } | null; applyState: 'blocked' | 'ready' | 'all_done' | null; validation: { ok: boolean; issues: Array<{ level: string; message: string; path?: string }> } | null; archived: boolean }
export interface OpenSpecService {
  statusFor(ticketId: string): Promise<OpenSpecStatus>;
  validateForProposed(ticketId: string): Promise<{ ok: true; plan: string } | { ok: false; issues: Array<{ level: string; message: string; path?: string }> }>;
  archiveAfterMerge(ticketId: string): Promise<{ archivedAs: string | null; skipped: string | null }>;
  version(projectId: string): Promise<string | null>;
}

// ---------- usage ----------
export interface UsageQuery { scope: string; window: S.UsageWindow; grain?: S.UsageGrain; start?: string; end?: string }
export interface UsageSeriesPoint { bucket: string; tokensIn: number; tokensOut: number; tokensCached: number; runs: number; durationMs: number; costCents: number; costReportedCents: number }
export interface UsageService {
  series(q: UsageQuery): { range: S.UsageRange; points: UsageSeriesPoint[]; total: UsageSeriesPoint; previous: UsageSeriesPoint; costReportedShare: number; billingMix: S.UsageBillingMix };
  top(q: UsageQuery & { by: 'model' | 'ticket' | 'role' | 'worker' | 'project' }): Array<UsageSeriesPoint & { key: string; label: string }>;
  ticket(ticketId: string): { total: UsageSeriesPoint; subtree: UsageSeriesPoint; turns: Array<UsageSeriesPoint & { runId: string; agentId: string; model: string | null; occurredAt: string }> };
  models(q: UsageQuery): Array<{ model: string; provider: string | null } & UsageSeriesPoint>;
}

/** The current runtime account snapshots (PLAN §16.2): billing mode and plan limit windows per runtime. */
export interface AccountsService {
  list(): S.RuntimeAccount[];
  get(runtimeId: string): S.RuntimeAccount | null;
  /** Re-probe the given runtimes (default: every runtime this workspace uses) and replace their snapshots. */
  refresh(runtimeIds?: string[]): Promise<S.RuntimeAccount[]>;
}

// ---------- channels / threads ----------
export interface ThreadsService {
  bindOrGet(channelKind: string, externalThreadId: string, externalUserId: string | null, humanLabel?: string): S.ChannelThread;
  get(id: string): S.ChannelThread;
  list(filter?: { channelKind?: string; agentId?: string; ticketId?: string }): S.ChannelThread[];
  bindTicket(actor: Actor, threadId: string, ticketId: string | null): S.ChannelThread;
  inbound(actor: Actor, threadId: string, body: string, opts?: { externalMessageId?: string; parts?: unknown[]; projectId?: string | null; replyToMessageId?: string | null }): Promise<S.ThreadMessage>;  // stores + wakes
  outbound(actor: Actor, threadId: string, body: string, opts?: { parts?: unknown[]; runId?: string | null }): Promise<S.ThreadMessage>;
  messages(threadId: string, opts?: { before?: string; limit?: number }): S.ThreadMessage[];
  primaryThread(): S.ChannelThread | null;
  notifyHuman(actor: Actor, message: { text: string; parts?: unknown[] }): Promise<void>;   // primary thread + web
}

// ---------- auth ----------
export interface AuthService {
  hasOperator(): boolean;
  setPassword(username: string, password: string): Promise<void>;
  login(input: { username: string; password: string; totp?: string; kind: S.AuthSessionKind; deviceName?: string; ip?: string; userAgent?: string }): Promise<{ token: string; sessionId: string; expiresAt: string } | { totpRequired: true }>;
  verify(token: string): { sessionId: string; operatorId: string; kind: S.AuthSessionKind } | null;
  logout(sessionId: string): void;
  sessions(): Array<{ id: string; kind: string; deviceName: string | null; createdAt: string; lastSeenAt: string; expiresAt: string; ip: string | null; revokedAt: string | null }>;
  revoke(sessionId: string): void; revokeAll(exceptSessionId?: string): number;
  totpSetup(): Promise<{ secret: string; otpauthUrl: string; recoveryCodes: string[] }>;
  totpEnable(code: string): Promise<void>; totpDisable(): Promise<void>; totpEnabled(): boolean;
  changePassword(current: string, next: string): Promise<void>;
  /** Check the operator's password without creating a session (re-auth before TOTP changes). */
  verifyPassword(password: string): Promise<boolean>;
}

// ---------- briefing / conductor ----------
export interface BriefingService { snapshot(): S.Briefing }

// ---------- changelog ----------
/** What a page of the changelog is asked for. `before` is the cursor a previous page returned. */
export interface ChangelogQuery { projectId?: string | null; before?: string | null; limit?: number }
/** A range of days to aggregate, in the timezone the caller names. `from`/`to` are `YYYY-MM-DD`. */
export interface ChangelogHeatmapQuery { projectId?: string | null; from?: string | null; to?: string | null; timezone?: string | null }
/**
 * The human-facing record of what happened (PLAN §13.6): a read-only projection over the `activity`
 * table. There is deliberately no write, edit or delete member — the record is append-only, and the
 * only thing that appends to it is `recordActivity` on the path that caused the event.
 */
export interface ChangelogService {
  list(q?: ChangelogQuery): S.ChangelogPage;
  heatmap(q?: ChangelogHeatmapQuery): S.ChangelogHeatmap;
}

export interface CoreServices {
  tickets: TicketsService; decisions: DecisionsService; projects: ProjectsService; roles: RolesService; workers: WorkersService;
  wake: WakeService; runs: RunsService; dispatcher: Dispatcher; supervisor: Supervisor; knowledge: KnowledgeService; specs: SpecsService;
  openspec: OpenSpecService; usage: UsageService; accounts: AccountsService; threads: ThreadsService; briefing: BriefingService; jobs: JobsService;
  changelog: ChangelogService;
}
