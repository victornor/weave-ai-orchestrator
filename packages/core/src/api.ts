/**
 * Core service interfaces. Server, MCP tools, CLI and tests code against these; implementations live in core/src/<module>/.
 * Every mutation writes an activity row and emits an event. Errors are OcError with a code from shared.
 */
import type * as S from '@agent-conductor/shared';
import type { ForgeChangedFile, ForgeCheck, ForgePullRequest } from '@agent-conductor/plugin-sdk';
import type { DiffFileStatus, DiffHunk } from '@agent-conductor/render';

export interface Actor { kind: 'human' | 'agent' | 'system'; id: string | null; runId?: string | null }
export interface Page<T> { items: T[]; total: number }

// ---------- tickets ----------
export interface TicketCreateInput { projectId?: string | null; kind: S.TicketKind; title: string; description?: string; /** One-line why (VS-146); shown on plan-approval cards. */ summary?: string | null; priority?: S.TicketPriority; parentId?: string | null; blockedBy?: string[]; assigneeRoleId?: string | null; autoMerge?: boolean; originKind?: string; originFingerprint?: string; /** VS-101: marks the ticket as an interactive session from the moment it is created. */ interactiveSession?: boolean; /** Overrides the project's landing branch for this ticket alone (VS-119); set only at creation. */ landingBranch?: string | null; /** Workspace catalog option this ticket's worker runs on (VS-162); omit for `models.workers`. */ workerModelId?: string | null }
/** `sort: 'finished'` orders by when a ticket reached done or cancelled, so a page of terminal tickets is the most recently finished ones rather than the most recently created. */
export interface TicketFilter { projectId?: string; status?: S.TicketStatus[]; kind?: S.TicketKind[]; roleId?: string; workerId?: string; search?: string; limit?: number; offset?: number; includeTerminal?: boolean; sort?: 'number' | 'finished'; /** `label` blanks `description` (VS-227 chat labels). */ fields?: 'label' }
export interface TransitionInput { to: S.TicketStatus; note?: string; unblock?: { owner: 'conductor' | 'human'; action: string }; blockedBy?: string[] }
export interface TicketsService {
  create(actor: Actor, input: TicketCreateInput): S.Ticket;
  get(id: string): S.Ticket;                      // id or identifier
  list(filter?: TicketFilter): Page<S.Ticket>;
  update(actor: Actor, id: string, patch: Partial<Pick<S.Ticket, 'title' | 'description' | 'summary' | 'priority' | 'autoMerge' | 'parentId' | 'projectId'>>): S.Ticket;
  assign(actor: Actor, id: string, roleId: string | null, workerModelId?: string | null): S.Ticket;
  /**
   * The one post-spawn write of `workerModelId`: answering a usage-limit retry card with a catalog
   * option that was on that card (VS-238). Not on HTTP, MCP, create, or assign.
   */
  setWorkerModelFromQuotaCard(actor: Actor, id: string, optionId: string): S.Ticket;
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
  /** The most recent worker to have held this ticket, even after it retired — `ticket.workerId` is
   * nulled on retirement, so this is the only way to name who built a ticket that has since landed. */
  lastWorker(id: string): S.Agent | null;
  /** `opts.system` is for the daemon's own internal write of the `plan` digest only — never set it from a tool or route handling external input; every other write to `key: 'plan'` is refused. */
  putDocument(actor: Actor, id: string, key: string, body: string, opts?: { system?: boolean }): { documentId: string; revision: number };
  getDocument(id: string, key: string, revision?: number): { documentId: string; revision: number; body: string; createdAt: string } | null;
  /** Read one of the ticket's documents by its id (VS-224) — how a decision's document target is followed; scoped to the ticket. */
  getDocumentById(id: string, documentId: string, revision?: number): { key: string; documentId: string; revision: number; currentRevision: number; body: string; createdAt: string } | null;
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
  /** A `proposed` change ticket or a non-`auto_merge` `in_review` ticket with no open approval gets a fresh one, raised as the daemon. Returns what it repaired. */
  repairApprovals(): Promise<Array<{ id: string; identifier: string; kind: 'plan_approval' | 'merge_approval' | 'action_approval' }>>;
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
export interface DecisionCreateInput { ticketId?: string | null; projectId?: string | null; kind: S.DecisionKind; owner?: S.DecisionOwner; title: string; context?: string; options?: S.Decision['options']; inputs?: S.DecisionInput[]; allowFreeText?: boolean; recommendation?: string | null; expiresInHours?: number; target?: Record<string, unknown>; correlationKey?: string; askedByAgentId?: string | null; askedInRunId?: string | null }
export interface DecisionsService {
  create(actor: Actor, input: DecisionCreateInput): S.Decision;
  get(id: string): S.Decision;
  list(filter?: { status?: S.DecisionStatus[]; owner?: S.DecisionOwner; ticketId?: string; limit?: number }): S.Decision[];
  /** Async: side effects drive ticket transitions and role activation. */
  answer(actor: Actor, id: string, answer: { key?: string; text?: string; remember?: boolean; inputs?: S.DecisionAnswerInputs }): Promise<S.Decision>;
  /**
   * Asserted conductor review of a plan/merge/action card (VS-223). Does not wake anyone and does
   * not affect `answer()`. Actor must be the workspace conductor.
   */
  review(actor: Actor, id: string, input: { status: 'looked' | 'concerns'; note?: string }): S.Decision;
  withdraw(actor: Actor, id: string, reason: string): S.Decision;
  /** Withdraws every still-open decision scoped to this ticket (e.g. once it reaches a terminal status). Returns the count closed. */
  withdrawForTicket(actor: Actor, ticketId: string, reason: string): number;
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
  /** Read-only (VS-131): fetches and classifies against origin/<landingBranch> without checkout or merge. */
  checkSync(id: string): Promise<{ syncState: S.ProjectSyncState; behindBy: number | null }>;
  reconcile(): Promise<void>;                                              // declared vs db
  /** The project's commit graph (VS-96): default branch plus every live worker/ticket branch, paged. */
  history(id: string, query?: HistoryQuery): Promise<HistoryPage>;
  /** One commit's full detail — message, parents and changed files against its first parent. */
  commit(id: string, sha: string): Promise<CommitDetail>;
}

/** A branch the history covers: the default branch, a worker's branch, or a ticket's. */
export interface ProjectRef {
  name: string; sha: string; isDefault: boolean;
  ticketId: string | null; ticketIdentifier: string | null;
  agentId: string | null; agentName: string | null;
}
export interface HistoryCommit {
  sha: string; parents: string[]; author: string; authoredAt: string; subject: string; refs: string[];
}
export interface HistoryQuery { cursor?: string | null; limit?: number }
export interface HistoryPage { refs: ProjectRef[]; commits: HistoryCommit[]; cursor: string | null }
export interface CommitFile { path: string; previousPath: string | null; status: 'added' | 'modified' | 'deleted' | 'renamed'; additions: number; deletions: number }
export interface CommitDetail {
  sha: string; parents: string[]; author: string; email: string; authoredAt: string; committedAt: string;
  message: string; files: CommitFile[]; truncatedFiles: number; forgeUrl: string | null;
}
export interface RolesService {
  list(projectId?: string): S.Role[]; get(id: string): S.Role;
  hire(actor: Actor, spec: S.RoleSpec, opts?: { autoActivate?: boolean }): Promise<{ role: S.Role; decisionId: string | null }>;
  activate(actor: Actor, id: string): Promise<S.Role>;
  update(actor: Actor, id: string, patch: Partial<S.RoleSpec>, reason: string, opts?: { applyToRunning?: boolean }): Promise<S.Role>;
  updateCharter(actor: Actor, id: string, charter: string, reason: string, opts?: { applyToRunning?: boolean }): Promise<S.Role>;
  /** Replace the role's secret names (VS-92). Refused in full if any name is not registered, so a role can never list a secret its workers would silently not get. */
  setSecrets(actor: Actor, id: string, names: string[], reason: string): Promise<S.Role>;
  charter(id: string): string;
  revisions(id: string): Array<{ revision: number; author: string; reason: string | null; changedKeys: string[]; createdAt: string }>;
  rollback(actor: Actor, id: string, revision: number): Promise<S.Role>;
  pause(actor: Actor, id: string, reason: string): S.Role; resume(actor: Actor, id: string): S.Role;
  retire(actor: Actor, id: string, reason: string): Promise<{ role: S.Role; decisionId: string | null }>;
  freeSlots(id: string): number;
  concurrency(id: string): RoleConcurrency;
}
/** Project-pooled spawn headroom (VS-156). `roleMax` is the stored field, not a spawn gate; `effective` is `projectMax`. */
export interface RoleConcurrency { roleMax: number; projectMax: number; effective: number; live: number; projectLive: number; free: number }
/** What happened to a message sent to a worker (VS-99): which delivery occurred, never both, never neither. */
export interface WorkerMessageOutcome { delivery: 'mid_turn' | 'queued'; runId: string | null; wake: S.Wakeup | null }
/**
 * A human taking a worker's session (VS-249): the copy-ready command (or the stated reason there is
 * none) plus the id of the hold this opened, so a later `endHandover` call can be matched to it —
 * though callers address a handover by worker id, not by this id, since a worker only ever has one
 * open hold at a time.
 */
export interface HandoverStartResult { resumable: boolean; command: string | null; runtime: string; landingLine: string | null; reason: string | null }
/** What changed in the worktree and the session while a hold was open, surfaced on handback. */
export interface HandoverReconciliation {
  worktree: { headBefore: string | null; headAfter: string | null; newCommits: number; dirty: boolean; changedFiles: number };
  sessionActivityDetected: boolean;
  durationMs: number;
}
export interface HandoverEndResult { note: string; reconciliation: HandoverReconciliation }
export interface WorkersService {
  list(filter?: { status?: S.AgentStatus[]; projectId?: string; roleId?: string; includeRetired?: boolean }): S.Agent[];
  get(id: string): S.Agent;
  conductor(): S.Agent;
  ensureConductor(): Promise<S.Agent>;
  spawnForTicket(actor: Actor, ticketId: string): Promise<S.Agent>;       // brief, home, worktree, session placeholder, first wake
  spawnCurator(actor: Actor, projectId: string): Promise<S.Agent>;
  /**
   * Start an interactive session (VS-101): always against a ticket, either one that already exists
   * or one created in the same action. Marks the ticket `interactiveSession` and calls the ordinary
   * `spawn` unchanged — the session's agent is that ticket's worker, nothing more.
   */
  startInteractiveSession(actor: Actor, input: { ticketId: string } | { projectId: string; roleId: string; kind: S.TicketKind; title: string; description?: string }): Promise<S.Agent>;
  /**
   * Steer a worker: records the human's words as a ticket comment first, always. When `live` is
   * asked for and the worker's runtime can take mid-turn input, attempts delivery to its executing
   * turn; otherwise (and whenever delivery fails) the message is queued as a `conductor_request`
   * wake, exactly as before VS-99. Never both, never neither.
   */
  message(actor: Actor, workerId: string, body: string, opts?: { live?: boolean }): Promise<WorkerMessageOutcome>;
  relaunch(actor: Actor, workerId: string, note: string): Promise<S.Agent>;
  cancel(actor: Actor, workerId: string, reason: string): Promise<S.Agent>;
  pause(actor: Actor, id: string, reason: string): S.Agent; resume(actor: Actor, id: string): S.Agent;
  retireIfLanded(actor: Actor, workerId: string): Promise<{ retired: boolean; reason?: string }>;
  /** Whether this agent's next turn would resume its existing session rather than start a fresh one. */
  sessionResumable(id: string): boolean;
  brief(workerId: string): string;
  resetSession(actor: Actor, id: string, reason: string): Promise<void>;
  /**
   * The resume command a worker would offer right now, without taking it (VS-249): read-only, safe
   * to call on every render of a worker or a decision raised for one. `startHandover` calls this
   * same builder and refuses the mutation when it reports `resumable: false`.
   */
  handoverCommand(id: string): HandoverStartResult;
  /**
   * Take a worker's session for a human's own terminal (VS-249): refuses a worker with a turn
   * currently executing, or one already held. Pauses the worker with `HANDOVER_PAUSE_CODE` and opens
   * an `agent_handovers` row snapshotting the worktree and session, excluding it from dispatch until
   * `endHandover` (or the supervisor's own abandonment sweep) closes the hold.
   */
  startHandover(actor: Actor, workerId: string): Promise<HandoverStartResult>;
  /**
   * Give a held session back: refuses an empty note, reconciles the worktree and session against the
   * snapshot `startHandover` took, posts that reconciliation and the note as a ticket comment, and
   * resumes ordinary dispatch. Distinct from `resume` on purpose — `resume` refuses a worker with an
   * open hold, per `run-recovery/paused-worker-visibility`.
   */
  endHandover(actor: Actor, workerId: string, note: string): Promise<HandoverEndResult>;
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
  /** The last `limit` events of a run, in ascending sequence order — the tail `events()` cannot page to. */
  tail(id: string, limit?: number): S.RunEvent[];
  /** Only the run's `run.phase.timing` events, in order. At most one per `RUN_PHASES` entry, wherever they fall in the run. */
  phaseTimings(id: string): S.RunEvent[];
  /**
   * What a set of runs did, counted off `run_events` (VS-74): one aggregate for the whole set, so a
   * surface can label a page of history without loading a transcript. `ids` names runs outright;
   * `agentId` with `since` adds every run that agent has taken in a window, which is how a surface
   * learns about a turn that left no trace of itself anywhere else. Ids that name no run in this
   * workspace are omitted. Oldest first; `limit` keeps the newest.
   */
  traces(filter: { ids?: readonly string[]; agentId?: string; since?: string; limit?: number }): S.RunTrace[];
  cancel(actor: Actor, id: string, mode?: 'interrupt' | 'kill'): Promise<void>;
  onEvent(handler: (runId: string, ev: S.RunEvent) => void): () => void;
}
export interface Dispatcher { tick(): Promise<void>; start(): void; stop(): Promise<void>; running(): number }
/** `running()` is the daemon's own health check: is the tick timer installed (VS-76)? */
export interface Supervisor { tick(): Promise<void>; start(): void; stop(): void; running(): boolean }

// ---------- knowledge / specs ----------
export interface KnowledgeService {
  get(scope: S.KnowledgeScope, projectId?: string | null): { path: string; body: string; tokenEstimate: number; budgetTokens: number; lastCuratedAt: string | null; curationPending: boolean; revision: number };
  note(actor: Actor, scope: S.KnowledgeScope, section: string, text: string, projectId?: string | null, doc?: string): { remainingTokens: number; revision: number };
  replace(actor: Actor, scope: S.KnowledgeScope, body: string, reason: S.KnowledgeRevisionReason, projectId?: string | null, removed?: string[]): { revision: number };
  revisions(scope: S.KnowledgeScope, projectId?: string | null): Array<{ revision: number; authorKind: string; reason: string; createdAt: string; ticketId: string | null; ticketIdentifier: string | null }>;
  revert(actor: Actor, scope: S.KnowledgeScope, revision: number, projectId?: string | null): { revision: number };
  lint(): Array<{ path: string; scope: string; projectId: string | null; tokenEstimate: number; budgetTokens: number; pct: number; lastCuratedAt: string | null; curationPending: boolean }>;
  requestCuration(actor: Actor, scope: S.KnowledgeScope, projectId?: string | null): Promise<{ ticketId?: string; wakeId?: string }>;
  search(query: string, projectId?: string | null, limit?: number): Array<{ kind: string; projectId: string | null; ref: string; title: string; snippet: string }>;
  reindex(): void;
  bootstrapDigest(agentId: string): { text: string; tokens: number; truncated: boolean; parts: KnowledgeBootstrapPart[] };
  appendDecision(decision: S.Decision): void;
  /** Linked documents (PLAN §13): topic pages under a scope that link to each other with [[slug]]. */
  listDocs(filter?: { scope?: S.KnowledgeScope; projectId?: string | null }): KnowledgeDocSummary[];
  getDoc(scope: S.KnowledgeScope, slug: string, projectId?: string | null): KnowledgeDocDetail;
  putDoc(actor: Actor, scope: S.KnowledgeScope, slug: string, body: string, projectId?: string | null, reason?: S.KnowledgeRevisionReason): KnowledgeDocWriteResult;
  deleteDoc(actor: Actor, scope: S.KnowledgeScope, slug: string, projectId?: string | null): void;
  graph(projectId?: string | null): KnowledgeGraph;
  /** The knowledge network's health (VS-102): derived on read, no new table. `projectId` omitted means the whole workspace. */
  health(projectId?: string | null): KnowledgeHealth;
}
export interface KnowledgeHealth {
  hubs: Array<{ path: string; scope: S.KnowledgeScope; projectId: string | null; projectSlug: string | null; tokenEstimate: number; budgetTokens: number; pct: number; nearBudget: boolean; curationPending: boolean; lastCuratedAt: string | null }>;
  orphans: KnowledgeDocSummary[];
  stale: KnowledgeDocSummary[];
  unresolvedLinks: Array<{ fromPath: string; fromTitle: string; toSlug: string }>;
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

// ---------- knowledge context accounting (VS-110) ----------
/** One hub chunk rendered into a bootstrap digest, measured at the point it was built — never the file's stored `tokenEstimate`. */
export interface KnowledgeBootstrapPart { scope: S.KnowledgeScope; projectId: string | null; tokens: number }
/** A knowledge read returned during a run: an explicit hub read (`slug` null) or a document read by slug. */
export interface KnowledgeReadEvent {
  runId: string; agentId: string; ticketId: string | null;
  scope: S.KnowledgeScope; projectId: string | null; slug: string | null; tokens: number;
}
/** A run's or a ticket's knowledge context: hub tokens, document tokens, and which documents were touched. */
export interface KnowledgeContextUsage {
  hubTokens: number; documentTokens: number; totalTokens: number;
  documents: Array<{ scope: S.KnowledgeScope; projectId: string | null; slug: string | null; tokens: number }>;
}
export interface KnowledgeUsageQuery { projectId?: string | null; window?: S.UsageWindow }
export interface KnowledgeDocumentUsage { scope: S.KnowledgeScope; projectId: string | null; slug: string; title: string | null; reads: number; tokens: number }
export interface KnowledgeDocumentRef { scope: S.KnowledgeScope; projectId: string | null; slug: string; title: string | null; tokenEstimate: number }
/**
 * Records what a run's turn actually consumed from the knowledge base — separate from `UsageService`,
 * which tracks billed model tokens. Measures only; nothing here throttles, caps or refuses a run.
 */
export interface KnowledgeUsageService {
  recordBootstrap(runId: string, agentId: string, ticketId: string | null, parts: KnowledgeBootstrapPart[]): void;
  recordRead(evt: KnowledgeReadEvent): void;
  forRun(runId: string): KnowledgeContextUsage;
  /** Sums the ticket's own runs plus its subtree, matching `UsageService.ticket()`'s subtree semantics. */
  forTicket(ticketId: string): KnowledgeContextUsage;
  summary(query: KnowledgeUsageQuery): { averageTokensPerRun: number; runs: number };
  topDocuments(query: KnowledgeUsageQuery, limit?: number): KnowledgeDocumentUsage[];
  neverRead(query: KnowledgeUsageQuery): KnowledgeDocumentRef[];
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

/**
 * The workspace's two model settings (VS-77, ADR 0011): the whole of model selection. `reconcile` is
 * called once per workspace at startup and raises the card a mixed-runtime migration left owing.
 */
export interface ModelsService {
  /** Effective settings after a daemon overlay (VS-185). */
  get(): S.WorkspaceModels;
  locked(): S.ModelsLocked;
  /** `workerOptions` omitted keeps the existing catalog; an explicit array (including `[]`) replaces it (VS-162). Locked controls are not written. */
  set(actor: Actor, next: S.WorkspaceModelsPut | S.WorkspaceModels): Promise<S.WorkspaceModels>;
  reconcile(): void;
  /** Answer the migration's question: write the workers runtime and close the matter for good. */
  settleWorkersRuntime(actor: Actor, runtime: string): Promise<S.WorkspaceModels>;
}

/** The current runtime account snapshots (PLAN §16.2): billing mode and plan limit windows per runtime. */
export interface AccountsService {
  list(): S.RuntimeAccount[];
  get(runtimeId: string): S.RuntimeAccount | null;
  /** Re-probe the given runtimes (default: every runtime this workspace uses) and replace their snapshots. */
  refresh(runtimeIds?: string[]): Promise<S.RuntimeAccount[]>;
  /**
   * A human's own re-probe (VS-84), rate limited per runtime to one every `MANUAL_SYNC_INTERVAL_MS`.
   * Returns the current snapshot of every runtime asked about, plus what was probed, what was
   * refused as too recent, and what failed — a manual sync never hides a failed probe the way the
   * poll does.
   */
  sync(runtimeIds?: string[]): Promise<S.AccountSync>;

  // ---- credential state (VS-75). Never returns a token; `RuntimeCredential` has nowhere to put one.
  /** The credential state of every runtime this workspace has recorded one for. */
  credentials(): S.RuntimeCredential[];
  /** One runtime's credential state, refreshed from the credential file itself (no CLI is spawned). */
  credential(runtimeId: string): S.RuntimeCredential;
  /** The runtimes currently gated: no turn may be started for an agent on any of them. */
  gatedRuntimes(): string[];
  /** Record that a turn on this runtime could not authenticate, and raise the gate. */
  noteAuthFailure(runtimeId: string, detail: string | null): S.RuntimeCredential;
  /** Record that a turn or a probe on this runtime worked, and clear the gate. */
  noteVerified(runtimeId: string): S.RuntimeCredential;
}

// ---------- channels / threads ----------
export interface ThreadsService {
  bindOrGet(channelKind: string, externalThreadId: string, externalUserId: string | null, humanLabel?: string): S.ChannelThread;
  get(id: string): S.ChannelThread;
  list(filter?: { channelKind?: string; agentId?: string; ticketId?: string }): S.ChannelThread[];
  bindTicket(actor: Actor, threadId: string, ticketId: string | null): S.ChannelThread;
  /** `attachments` bytes are already validated (type/size) by the caller; `inbound` only stores and links them. Rejected with `validation` if the thread is ticket-bound (VS-133 — out of scope there). */
  inbound(actor: Actor, threadId: string, body: string, opts?: { externalMessageId?: string; parts?: unknown[]; projectId?: string | null; replyToMessageId?: string | null; idempotencyKey?: string; attachments?: Array<{ filename: string; mediaType: S.AttachmentMediaType; bytes: Buffer }> }): Promise<S.ThreadMessage>;  // stores + wakes; a repeated idempotencyKey on this thread returns the existing message
  outbound(actor: Actor, threadId: string, body: string, opts?: { parts?: unknown[]; runId?: string | null; replyToMessageId?: string | null }): Promise<S.ThreadMessage>;  // reply target validated + excerpted like inbound
  messages(threadId: string, opts?: { before?: string; limit?: number }): S.ThreadMessage[];
  /** `not_found` when the message does not exist, or exists but under a different thread — the same response either way. Full stored body, regardless of whether the wake payload that referenced it was truncated (VS-242). */
  message(threadId: string, messageId: string): S.ThreadMessage;
  /** `not_found` when the attachment does not exist, or exists but under a different thread — the same response either way, so a thread id cannot be used to probe for one that belongs elsewhere. */
  attachment(threadId: string, attachmentId: string): { attachment: S.Attachment; bytes: Buffer };
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

// ---------- pull requests ----------
/**
 * Why a project's pull requests cannot be listed (VS-97). Every one of these is a settled statement
 * about the project rather than a failure, which is why the list answers with one instead of an
 * error status: a section cannot tell "this project has no forge" from "the request failed" out of
 * an HTTP code, and it must not show an error for the first.
 */
export type PullRequestUnavailable = 'no_forge' | 'not_authenticated' | 'no_clone' | 'unsupported' | 'unreachable' | 'no_local_branch';
/** The ticket a pull request belongs to, as a list entry shows it. */
export interface PullRequestTicket { id: string; identifier: string; title: string; status: S.TicketStatus; hasPlan: boolean }
/** One listed pull request with everything the daemon could join to it. */
export interface ProjectPullRequest extends ForgePullRequest {
  ticket: PullRequestTicket | null;
  /** The OpenSpec change its ticket implements, or null — including when it has no ticket. */
  changeName: string | null;
  queue: { state: 'landing' | 'waiting'; position: number | null } | null;
}
export interface ProjectPullRequestDetail extends ProjectPullRequest { body: string; files: ForgeChangedFile[]; checkRuns: ForgeCheck[] }
export interface ProjectPullRequests {
  projectId: string;
  available: boolean;
  reason: PullRequestUnavailable | null;
  /** Only ever set for `unreachable`: what the forge said. */
  message: string | null;
  /** The forge could not be re-read and this is the previous answer, still being served. */
  stale: boolean;
  capturedAt: string;
  windowDays: number;
  open: ProjectPullRequest[];
  recent: ProjectPullRequest[];
}
export interface PullRequestDetailResult {
  projectId: string; available: boolean; reason: PullRequestUnavailable | null; message: string | null; stale: boolean;
  /** Null with `available: true` means the forge has no such pull request. */
  pullRequest: ProjectPullRequestDetail | null;
}
/** One changed file's identity and shape, from the diff itself rather than the forge's own file list (VS-107). */
export interface DiffFileSummary {
  path: string; previousPath: string | null; status: DiffFileStatus;
  additions: number; deletions: number; binary: boolean; tooLarge: boolean;
}
export interface PullRequestDiffFilesResult {
  projectId: string; number: number; available: boolean; reason: PullRequestUnavailable | null; message: string | null; stale: boolean;
  files: DiffFileSummary[];
}
export interface DiffFileContent extends DiffFileSummary { hunks: DiffHunk[] }
export interface PullRequestDiffFileResult {
  projectId: string; number: number; available: boolean; reason: PullRequestUnavailable | null; message: string | null;
  /** `available: true` with `file: null` means the diff has no such path. */
  file: DiffFileContent | null;
}
export interface PullRequestDiffContextResult {
  projectId: string; number: number; available: boolean; reason: PullRequestUnavailable | null;
  /** Base-revision content for the requested range; empty when the file has none there (an added file, or past its end). */
  lines: string[];
}

/** Read-only (VS-97, diff content VS-107): there is no member here that writes, to the forge or to the database. */
export interface PullRequestsService {
  list(projectId: string): Promise<ProjectPullRequests>;
  get(projectId: string, number: number): Promise<PullRequestDetailResult>;
  /** The changed-file manifest for a pull request's diff — cheap: never carries a hunk. */
  diffFiles(projectId: string, number: number): Promise<PullRequestDiffFilesResult>;
  /** One file's hunks, sliced from the same diff `diffFiles` already read and cached. */
  diffFile(projectId: string, number: number, path: string): Promise<PullRequestDiffFileResult>;
  /** Base-revision content for a collapsed region's expand control. */
  diffContext(projectId: string, number: number, path: string, startLine: number, endLine: number): Promise<PullRequestDiffContextResult>;
}

// ---------- secrets ----------
/**
 * Registering a value the human supplied, and reading one back for the daemon alone (VS-92). The
 * value is never in the database and never on any client, channel or agent surface: `list` says
 * only whether one is held, and `value` has exactly one caller, `roleSecretsEnv`.
 */
export interface SecretsService {
  put(actor: Actor, input: { name: string; envVarName?: string; scope?: S.SecretScope; scopeId?: string | null }, value: string): S.WorkspaceSecret;
  list(): S.WorkspaceSecret[];
  /** Is this name registered at all — what `roles.setSecrets` checks before accepting a list. */
  has(name: string): boolean;
  /** Daemon-only. Do not expose through a route, a tool or an event. */
  value(name: string): string | null;
  /** Removes the registration and the stored value. A name that was never registered is a no-op. */
  clear(actor: Actor, name: string): void;
}

export interface CoreServices {
  tickets: TicketsService; decisions: DecisionsService; projects: ProjectsService; roles: RolesService; workers: WorkersService;
  wake: WakeService; runs: RunsService; dispatcher: Dispatcher; supervisor: Supervisor; knowledge: KnowledgeService; specs: SpecsService;
  openspec: OpenSpecService; usage: UsageService; knowledgeUsage: KnowledgeUsageService; accounts: AccountsService; threads: ThreadsService; briefing: BriefingService; jobs: JobsService;
  changelog: ChangelogService; models: ModelsService; secrets: SecretsService; pullRequests: PullRequestsService;
  routines: RoutinesService;
}

export interface RoutineCreateInput {
  name: string;
  trigger: S.RoutineTrigger | Record<string, unknown>;
  instruction: string;
  action?: S.RoutineAction;
  maxTicketsPerFire?: number;
  projectId?: string | null;
}

export interface RoutinePatch {
  name?: string;
  trigger?: S.RoutineTrigger | Record<string, unknown>;
  instruction?: string;
  action?: S.RoutineAction;
  maxTicketsPerFire?: number;
  projectId?: string | null;
  status?: S.RoutineStatus;
}

export interface RoutinesService {
  list(): S.RoutineListItem[];
  get(id: string): S.Routine;
  create(actor: Actor, input: RoutineCreateInput): S.Routine;
  update(actor: Actor, id: string, patch: RoutinePatch): S.Routine;
  remove(actor: Actor, id: string): void;
  usage(id: string, window: S.RoutineUsageWindow, now?: Date): S.RoutineUsage;
  /** Kept fires newest-first, joined to the conductor run (VS-231). Skipped enqueues are absent. */
  fires(id: string): S.RoutineFire[];
  /** Supervisor tick: enqueue a due-now `routine` wake for each active row past `next_fire_at`. */
  fireDue(now?: string): S.Routine[];
  /** After a run ends: clear matching in-flight wakes and snap a still-past `next_fire_at` forward. */
  onRunFinalized(wakes: S.Wakeup[], now?: string): void;
}
