/**
 * Core service interfaces. Server, MCP tools, CLI and tests code against these; implementations live in core/src/<module>/.
 * Every mutation writes an activity row and emits an event. Errors are OcError with a code from shared.
 */
import type * as S from '@openconductor/shared';

export interface Actor { kind: 'human' | 'agent' | 'system'; id: string | null; runId?: string | null }
export interface Page<T> { items: T[]; total: number }

// ---------- tickets ----------
export interface TicketCreateInput { projectId?: string | null; kind: S.TicketKind; title: string; description?: string; priority?: S.TicketPriority; parentId?: string | null; blockedBy?: string[]; assigneeRoleId?: string | null; autoMerge?: boolean; originKind?: string; originFingerprint?: string }
export interface TicketFilter { projectId?: string; status?: S.TicketStatus[]; kind?: S.TicketKind[]; roleId?: string; workerId?: string; search?: string; limit?: number; offset?: number; includeTerminal?: boolean }
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
  comments(id: string, after?: string): S.TicketComment[];
  putDocument(actor: Actor, id: string, key: string, body: string): { documentId: string; revision: number };
  getDocument(id: string, key: string, revision?: number): { documentId: string; revision: number; body: string; createdAt: string } | null;
  documentRevisions(id: string, key: string): Array<{ revision: number; authorKind: string; createdAt: string }>;
  addWorkProduct(actor: Actor, id: string, wp: { type: S.WorkProductType; url?: string; title?: string; state?: string; provider?: string; externalId?: string; isPrimary?: boolean; metadata?: Record<string, unknown> }): { id: string };
  workProducts(id: string): Array<Record<string, unknown>>;
  /** Async: archives the OpenSpec change after the merge is verified (PLAN §12.2). */
  mergeDone(actor: Actor, id: string, info: { mergeCommit?: string; method?: string }): Promise<S.Ticket>;
  /** Liveness scan helper: tickets in active statuses without an action path. */
  livenessViolations(): S.Ticket[];
  nextIdentifier(): string;
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

// ---------- projects / roles / agents ----------
export interface ProjectsService {
  list(): S.Project[]; get(id: string): S.Project;
  add(actor: Actor, cfg: S.ProjectConfig): Promise<S.Project>;         // clone, worktrunk config, openspec init, seed KB, scout ticket
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
}
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
}
export interface SpecsService {
  index(projectId: string): Promise<{ capabilities: number; changes: number }>;
  listCapabilities(projectId: string): Array<{ id: string; capability: string; title: string | null; requirementCount: number; lastArchivedChange: string | null; pendingChanges: number; updatedAt: string }>;
  getCapability(projectId: string, capability: string): { id: string; capability: string; title: string | null; body: string; requirements: Array<{ name: string; text: string; scenarios: unknown[] }>; pending: Array<{ changeName: string; ticketId: string | null; deltaKind: string }>; history: Array<{ changeName: string; ticketId: string | null; archivedAs: string | null; archivedAt: string | null }> };
  listChanges(projectId: string, state?: 'active' | 'archived'): Array<Record<string, unknown>>;
  getChange(projectId: string, changeName: string): Record<string, unknown>;
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
  series(q: UsageQuery): { range: S.UsageRange; points: UsageSeriesPoint[]; total: UsageSeriesPoint; previous: UsageSeriesPoint; costReportedShare: number };
  top(q: UsageQuery & { by: 'model' | 'ticket' | 'role' | 'worker' | 'project' }): Array<UsageSeriesPoint & { key: string; label: string }>;
  ticket(ticketId: string): { total: UsageSeriesPoint; subtree: UsageSeriesPoint; turns: Array<UsageSeriesPoint & { runId: string; agentId: string; model: string | null; occurredAt: string }> };
  models(q: UsageQuery): Array<{ model: string; provider: string | null } & UsageSeriesPoint>;
}

// ---------- channels / threads ----------
export interface ThreadsService {
  bindOrGet(channelKind: string, externalThreadId: string, externalUserId: string | null, humanLabel?: string): S.ChannelThread;
  get(id: string): S.ChannelThread;
  list(filter?: { channelKind?: string; agentId?: string; ticketId?: string }): S.ChannelThread[];
  bindTicket(actor: Actor, threadId: string, ticketId: string | null): S.ChannelThread;
  inbound(actor: Actor, threadId: string, body: string, opts?: { externalMessageId?: string; parts?: unknown[] }): Promise<S.ThreadMessage>;  // stores + wakes
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
}

// ---------- briefing / conductor ----------
export interface BriefingService { snapshot(): S.Briefing }

export interface CoreServices {
  tickets: TicketsService; decisions: DecisionsService; projects: ProjectsService; roles: RolesService; workers: WorkersService;
  wake: WakeService; runs: RunsService; dispatcher: Dispatcher; supervisor: Supervisor; knowledge: KnowledgeService; specs: SpecsService;
  openspec: OpenSpecService; usage: UsageService; threads: ThreadsService; briefing: BriefingService;
}
