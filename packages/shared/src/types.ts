import type * as E from './enums.js';
import type { TestTally } from './test-summary.js';

export interface Workspace { id: string; slug: string; name: string; ticketPrefix: string; status: E.WorkspaceStatus; rootPath: string; createdAt: string; updatedAt: string }
/** VS-359: a project's in-flight knowledge-repo switch — one pull request whose merge (or close) resolves the opt-in. */
export interface ProjectKnowledgeSwitch { direction: 'on' | 'off'; branch: string; prUrl: string; startedAt: string }
export interface Project { id: string; workspaceId: string; slug: string; name: string; gitUrl: string; defaultBranch: string; landingBranch: string | null; clonePath: string; maxWorkers: number; setupCommand: string | null; worktreeProvider: E.WorktreeProviderId; openspecEnabled: boolean; openspecVersion: string | null; knowledgeRepoEnabled: boolean; /** VS-359: set while a switch is waiting on its pull request. */ knowledgeSwitch: ProjectKnowledgeSwitch | null; policies: Record<string, unknown>; status: E.ProjectStatus; syncState: E.ProjectSyncState; /** VS-673: the clone's HEAD the last time `fetch()` left it matching origin/<landingBranch> — the baseline its guarded self-heal resets against. */ primaryCloneSyncedHead: string | null; lastFetchedAt: string | null; errorText: string | null }
/**
 * Where a ticket's work actually lands (VS-119): the ticket's own declaration first, else the
 * project's, else the project's default branch. The one place every merge-verification, worktree,
 * retire and worker-briefing call site resolves this, so a project or ticket that declares nothing
 * behaves exactly as if landing branches did not exist.
 */
export function landingBranchOf(project: Pick<Project, 'defaultBranch' | 'landingBranch'>, ticket?: Pick<Ticket, 'landingBranch'> | null): string {
  return ticket?.landingBranch ?? project.landingBranch ?? project.defaultBranch;
}
/**
 * What a project is called to a person (VS-330): its display name when it has one, else its slug.
 * The one rule every human-readable project label goes through, so a cleared or whitespace name
 * falls back to the slug everywhere instead of rendering blank. The slug stays the identifier
 * wherever one is typed, copied or linked.
 */
export function projectLabel(project: Pick<Project, 'name' | 'slug'>): string {
  return project.name?.trim() || project.slug;
}
/**
 * Whether a finished ticket claims a merge but lacks the record merge-done writes (VS-250). A
 * `done` ticket whose delivery has `prState: 'merged'` or `merged: true` without a non-empty
 * `mergeCommit` is incomplete: the old `merging → done` bypass left rows like VS-227 reading as an
 * ordinary success. Historical rows are only made visible, never rewritten. Any surface that shows
 * a finished ticket's outcome (board, detail, CLI) reads this, so the gap cannot drift between them.
 */
export function incompleteDelivery(ticket: Pick<Ticket, 'status' | 'delivery'>): boolean {
  if (ticket.status !== 'done') return false;
  const d = ticket.delivery;
  if (!d) return false;
  if (d['merged'] !== true && d['prState'] !== 'merged') return false;
  const sha = d['mergeCommit'];
  return !(d['merged'] === true && typeof sha === 'string' && sha.trim() !== '');
}
/**
 * The OpenSpec archive-backfill record a finished ticket's delivery can carry (VS-389). A `pending`
 * record means the change is not on the landing branch yet and a pull request carries it; `landed`
 * means it reached the landing branch. Surfaces read it to show "spec archive pending" with the
 * pull request link, and the daemon reads `declinedPrUrl` so a declined merge is not re-raised.
 */
export interface OpenSpecArchiveDelivery {
  changeName: string;
  state: 'pending' | 'landed';
  branch?: string | null;
  number?: number | null;
  pendingPrUrl?: string | null;
  prUrl?: string | null;
  archivedAs?: string | null;
  declinedPrUrl?: string | null;
}
/** The OpenSpec archive-backfill record on a ticket's delivery, or null when it has none. */
export function openspecArchive(ticket: Pick<Ticket, 'delivery'>): OpenSpecArchiveDelivery | null {
  const raw = ticket.delivery?.['openspecArchive'];
  if (!raw || typeof raw !== 'object') return null;
  const a = raw as Record<string, unknown>;
  const state = a['state'];
  if (state !== 'pending' && state !== 'landed') return null;
  return {
    changeName: typeof a['changeName'] === 'string' ? a['changeName'] : '',
    state,
    branch: typeof a['branch'] === 'string' ? a['branch'] : null,
    number: typeof a['number'] === 'number' ? a['number'] : null,
    pendingPrUrl: typeof a['pendingPrUrl'] === 'string' ? a['pendingPrUrl'] : null,
    prUrl: typeof a['prUrl'] === 'string' ? a['prUrl'] : null,
    archivedAs: typeof a['archivedAs'] === 'string' ? a['archivedAs'] : null,
    declinedPrUrl: typeof a['declinedPrUrl'] === 'string' ? a['declinedPrUrl'] : null,
  };
}
export interface Role { id: string; workspaceId: string; projectId: string; slug: string; name: string; title: string | null; icon: string | null; charterSummary: string; scopeText: string; responsibilities: string[]; capabilities: string[]; rules: string[]; permission: Record<string, unknown>; sessionPolicy: E.SessionPolicy; maxWorkers: number; /** VS-579: this role's worker memory limit in MB, or null to inherit the workspace default. */ memoryLimitMb: number | null; secrets: string[]; /** VS-621: workspace MCP servers this role's `weave` runs may use. Default none. */ mcpServers: string[]; status: E.RoleStatus; pauseReason: string | null; specRevision: number; createdBy: string; createdAt: string; updatedAt: string }
/** Why a paused worker stopped, when a failure paused it (VS-56). Every field is optional: a worker a human paused carries a `pauseReason` and no detail. */
export interface AgentPauseDetail { family: E.RunErrorFamily | null; code: string | null; message: string | null; resetAt: string | null; runId: string | null }
/**
 * The pause code marking an agent as waiting on its runtime's expired login rather than broken
 * (VS-75). Lives here because core raises it, render reads it and the surfaces branch on it: a
 * worker waiting on a login must not be offered a resume that could only fail again.
 */
export const LOGIN_PAUSE_CODE = 'runtime_login_expired';
/** Is this agent stopped because its runtime's login expired, rather than by a failure of its own? */
export function waitingOnRuntimeLogin(agent: { status?: string; pauseDetail?: AgentPauseDetail | null } | null | undefined): boolean {
  return agent?.status === 'paused' && agent.pauseDetail?.code === LOGIN_PAUSE_CODE;
}
/**
 * The pause code marking a worker as held by a human in their own terminal (VS-249) — the second
 * exception (alongside `LOGIN_PAUSE_CODE`) to "resume is offered wherever a paused worker is
 * shown": a worker paused for this reason is given back through handback, never plain resume, since
 * resume would skip reconciliation. The hold's own data (session/worktree snapshot, reconciliation)
 * lives in `agent_handovers`, keyed by agent id — this code is only what a generic pause-reason
 * surface needs to render something sensible without knowing about that table.
 */
export const HANDOVER_PAUSE_CODE = 'held_by_human';
/** Is this agent stopped because a human is holding its session in their own terminal? */
export function heldByHuman(agent: { status?: string; pauseDetail?: AgentPauseDetail | null } | null | undefined): boolean {
  return agent?.status === 'paused' && agent.pauseDetail?.code === HANDOVER_PAUSE_CODE;
}
export interface Agent { id: string; workspaceId: string; kind: E.AgentKind; projectId: string | null; roleId: string | null; roleRevision: number | null; ticketId: string | null; /** VS-398: the plan a `planner`-kind agent belongs to; null for every other kind. */ planId: string | null; name: string; runtimeId: string; status: E.AgentStatus; pauseReason: string | null; pauseDetail: AgentPauseDetail | null; errorText: string | null; homePath: string; worktreePath: string | null; branch: string | null; /** VS-526: the worker option a persistent session runs on; null means `models.workers` (or the ticket's own option once it holds one). */ workerModelId: string | null; turnEpoch: number; turnCount: number; spawnedBy: string; spawnReason: string | null; briefRevision: number; lastRunAt: string | null; retiredAt: string | null; createdAt: string; updatedAt: string }
export interface Ticket { id: string; workspaceId: string; projectId: string | null; number: number; identifier: string; kind: E.TicketKind; title: string; description: string; /** One-line why (VS-146); shown on plan-approval cards. Null until set. */ summary: string | null; status: E.TicketStatus; priority: E.TicketPriority; autoMerge: boolean; assigneeRoleId: string | null; workerId: string | null; assigneeHuman: boolean; /** A human is conversing with this ticket's worker directly (VS-101): the session's whole persistent record. */ interactiveSession: boolean; /** Overrides the project's landing branch for this ticket alone (VS-119); set only at creation. */ landingBranch: string | null; /** Workspace catalog option this ticket's worker runs on (VS-162); null means `models.workers`. */ workerModelId: string | null; parentId: string | null; createdByKind: string; createdById: string | null; createdRunId: string | null; originKind: string | null; originFingerprint: string | null; checkoutRunId: string | null; executionRunId: string | null; openspecChangeName: string | null; /** VS-624: fixed at assign from the project's `visualPlanArtifact` policy; the ticket needs an `artifact:plan` before `proposed`. `ticketRow` always sets it; absent reads as off. */ planArtifactRequired?: boolean; openspecState: Record<string, unknown> | null; delivery: Record<string, unknown> | null; unblock: { owner: string; action: string } | null; blockedFromStatus: E.TicketStatus | null; monitorNextCheckAt: string | null; blockedTransitionAt: string | null; mergeQueuedAt: string | null; mergeStartedAt: string | null; /** How many times this waiting ticket has been passed over (VS-390). */ mergeBypasses: number; startedAt: string | null; completedAt: string | null; cancelledAt: string | null; createdAt: string; updatedAt: string }
export interface TicketComment { id: string; ticketId: string; authorKind: E.AuthorKind; authorId: string | null; runId: string | null; body: string; kind: E.CommentKind; sourceTrust: E.SourceTrust; createdAt: string }
/** One of a `single_choice` or `multiselect` input's choices. Keys are unique within that input. */
export interface DecisionInputChoice { key: string; label: string; description?: string; recommended?: boolean }
/**
 * A value a decision asks the human for, alongside (or instead of) choosing an option (VS-92).
 * `single_choice` and `multiselect` carry their `choices`; a `single_choice` offers exactly one,
 * pre-selects the `recommended` one, and may allow the human's own words with `allowOther`.
 * `secret` carries the `secretName` its value is registered under — the value of a secret input is
 * never the answer, only the name is (see `answerInputs`).
 */
export interface DecisionInput {
  key: string;
  label: string;
  type: E.DecisionInputType;
  required?: boolean;
  placeholder?: string;
  /** A short context line shown under the label on every surface (VS-342). */
  description?: string;
  /** `single_choice` and `multiselect` only, and required for both. */
  choices?: DecisionInputChoice[];
  /** `secret` only, and required for it: the workspace secret name, which becomes the env var name. */
  secretName?: string;
  /**
   * A value the card pre-fills (VS-342): a string for `text`/`multiline`, a key for `single_choice`,
   * a list of keys for `multiselect`. A pre-fill only — the daemon never answers from it.
   */
  default?: string | string[];
  /** `single_choice` only: offer the human's own words alongside the choices (VS-342). */
  allowOther?: boolean;
}
/** What a card collected, keyed by input key: a string, or the chosen keys of a multi-select. A secret's string is its name. */
export type DecisionAnswerInputs = Record<string, string | string[]>;
export interface Decision {
  id: string; workspaceId: string; ticketId: string | null; projectId: string | null; kind: E.DecisionKind; owner: E.DecisionOwner; askedByAgentId: string | null; askedInRunId: string | null; title: string; context: string; options: Array<{ key: string; label: string; description?: string; recommended?: boolean }>; inputs: DecisionInput[]; allowFreeText: boolean; recommendation: string | null; status: E.DecisionStatus; answerKey: string | null; answerText: string | null; answerInputs: DecisionAnswerInputs | null; answeredByKind: string | null; answeredById: string | null; answeredAt: string | null; expiresAt: string | null; target: Record<string, unknown> | null; correlationKey: string | null; createdAt: string;
  /** VS-223: asserted conductor review of plan/merge/action cards. Default `unseen`. */
  weaverReviewStatus: E.WeaverReviewStatus;
  weaverReviewedAt: string | null;
  weaverReviewNote: string | null;
  weaverReviewedByAgentId: string | null;
  /**
   * VS-481: what the weaver's review mark says it is waiting on (≤120 chars), when it said so — a
   * line of its own on the card. Null when the mark carried none, a later mark replaced it, or the
   * delivery head moved since the mark was made.
   */
  weaverReviewWaitingOn: string | null;
  /**
   * VS-365: the delivery head (a pull request's head, else the ticket branch's head, else the project
   * clone's branch ref) the review mark was made against, recorded when a `merge_approval` is marked.
   * Null when no head could be resolved. A held merge approval whose head later differs from this
   * wakes the weaver once per new head.
   */
  weaverReviewedHeadSha: string | null;
  /**
   * VS-310: a relayed answer is the human's words recorded by the weaver from the message they were
   * sent in. `answeredByKind`/`answeredById` stay the *writer* (the weaver agent); this is the
   * *author* — always `'human'` on a relay, `null` on a direct answer, whose author is its writer.
   */
  answerAuthorKind: string | null;
  /**
   * VS-310: the inbound human thread message the answer was transcribed from. Non-null exactly when
   * the answer was relayed, and the one thing a query or surface checks to tell a relay from the
   * human's own tap.
   */
  relayedFromMessageId: string | null;
}
/** A workspace secret as any surface may see it (VS-92): the name, where it is exposed, and whether a value is held. Never the value. */
export interface WorkspaceSecret { name: string; envVarName: string; scope: E.SecretScope; scopeId: string | null; hasValue: boolean }
export interface Wakeup { id: string; workspaceId: string; agentId: string; source: E.WakeSource; reason: string; payload: Record<string, unknown>; idempotencyKey: string | null; status: E.WakeStatus; coalescedIntoId: string | null; skipReason: string | null; runId: string | null; requestedByKind: string | null; requestedById: string | null; notBefore: string | null; createdAt: string; claimedAt: string | null; finishedAt: string | null }
/**
 * `lastEventAt` is when any event was recorded; `lastProgressAt` (VS-461) when the last *progress*
 * event was recorded (`isProgressRunEvent`) and is what the supervisor's silence window measures;
 * `lastError` is the message of the most recent `error` event, so a run's own error text survives
 * the turn (see `worker-supervision/run-inspection`).
 */
export interface Run { id: string; workspaceId: string; agentId: string; ticketId: string | null; sessionId: string | null; wakeupIds: string[]; runtimeId: string; model: string | null; status: E.RunStatus; turnEpoch: number; cwd: string; startedAt: string | null; finishedAt: string | null; exitCode: number | null; signal: string | null; pid: number | null; pgid: number | null; errorCode: string | null; errorFamily: E.RunErrorFamily | null; retryOfRunId: string | null; /** VS-663: when an automatic retry of this failed run is due; null when it is not retried. Readable so a surface can show recovery in progress. */ scheduledRetryAt: string | null; usage: { inputTokens: number; outputTokens: number; cachedInputTokens: number; contextTokens?: number; basis: string; firstRequest?: { freshTokens: number; cachedTokens: number } } | null; costCents: number | null; result: Record<string, unknown> | null; liveness: E.RunLiveness | null; logPath: string | null; summary: string | null; lastEventAt: string | null; lastProgressAt: string | null; lastError: string | null; createdAt: string }
export interface RunEvent { id: string; runId: string; seq: number; ts: string; type: E.RunEventType; stream: string; level: string; payload: Record<string, unknown> }
/**
 * What a live worker is doing now, and the tally of its most recent test command (VS-328). Derived
 * in the daemon from run events and carried on the workers read and the workspace stream; never
 * stored, so a daemon that has just started simply has no entry to report.
 */
export interface WorkerActivitySummary {
  agentId: string;
  ticketId: string | null;
  /** The current activity line, or null when the worker has no run in progress. */
  activity: { verb: string; label: string; target: string | null; since: string } | null;
  /**
   * The live turn's state, computed in the daemon with the same `liveTurn` the web row uses (VS-602),
   * so a board card or ticket header shows the same words without opening a stream per card. Null
   * when the worker has no run in progress. `since` is when the current state began, so the client's
   * own clock ticks the elapsed time.
   */
  live?: { state: string; label: string; since: string; toolCount: number; turnMs: number; sinceLastMs: number; wholeStepsOnly: boolean } | null;
  /** The last parsed test tally, or null when none has been read. Kept across turns until replaced. */
  tests: TestTally | null;
}
/**
 * What a run did, counted off its stored events (VS-74). Cheap enough to ask for a page of history
 * at once, and enough to say what a turn was without loading its transcript. `files` counts distinct
 * paths, so a file edited four times is one; `texts` counts the assistant text and thinking blocks,
 * so `toolCalls + files + errors + texts` being zero is how a surface knows there is no transcript
 * worth offering, whatever bookkeeping events the run also recorded. `model` and `usage` are the
 * run's own (VS-204) — `usage` is `null` for a runtime that reported none, never a zeroed object.
 */
export interface RunTrace { runId: string; status: E.RunStatus; agentId: string; createdAt: string; startedAt: string | null; finishedAt: string | null; durationMs: number | null; toolCalls: number; files: number; errors: number; texts: number; events: number; summary: string | null; model: string | null; usage: Run['usage'] }
export interface UsageEvent { id: string; workspaceId: string; projectId: string | null; roleId: string | null; agentId: string; ticketId: string | null; runId: string; runtimeId: string; provider: string | null; model: string | null; billingType: E.BillingType; inputTokens: number; cachedInputTokens: number; outputTokens: number; costCents: number | null; costStatus: E.CostStatus; durationMs: number; occurredAt: string }
/** One plan limit window as a runtime reports it. `utilization` is a percentage 0..100; a window the runtime does not quantify is omitted, never reported as zero. */
export interface AccountLimitWindow { kind: E.AccountLimitKind; label: string; utilization: number; resetsAt: string | null; scopeLabel: string | null }
/** The current account snapshot for one runtime in one workspace (PLAN §16.2). */
export interface RuntimeAccount { workspaceId: string; runtimeId: string; billingType: E.BillingType; planLabel: string | null; limitsAvailable: boolean; limits: AccountLimitWindow[]; note: string | null; capturedAt: string }
/** A runtime an on-demand sync would not probe again yet, with the moment the next one is allowed (VS-84). */
export interface AccountSyncThrottle { runtimeId: string; nextSyncAt: string; retryAfterMs: number }
/** A runtime an on-demand sync probed and could not describe. Its previous snapshot still stands. */
export interface AccountSyncFailure { runtimeId: string; message: string }
/**
 * The answer to an on-demand account sync (VS-84): the current snapshot of every runtime that was
 * asked about — freshly probed or not — plus which of them were probed, which were refused as too
 * recent, and which failed. Unlike the supervisor poll, a manual sync never hides a failed probe.
 */
export interface AccountSync { accounts: RuntimeAccount[]; synced: string[]; throttled: AccountSyncThrottle[]; failed: AccountSyncFailure[] }
/**
 * The state of the one credential this host shares for a runtime (VS-75). `needsLogin` is the gate:
 * while it is true no turn is started for any agent on that runtime. Deliberately has no field that
 * could carry a token, and none may ever be added.
 */
export interface RuntimeCredential { workspaceId: string; runtimeId: string; present: boolean; expiresAt: string | null; lastVerifiedAt: string | null; refreshFailedAt: string | null; needsLogin: boolean; detail: string | null; updatedAt: string }
/** Tokens in a usage window split by how they were billed, so a client can tell whether any metered spend occurred. */
export interface UsageBillingMix { subscription: number; metered: number; unknown: number }

export interface KnowledgeFile { id: string; workspaceId: string; projectId: string | null; path: string; scope: E.KnowledgeScope; tokenEstimate: number; budgetTokens: number; lastCuratedAt: string | null; curationPending: boolean; hash: string; updatedAt: string }
export interface ChannelThread { id: string; channelId: string; agentId: string; ticketId: string | null; externalThreadId: string | null; externalUserId: string | null; humanLabel: string | null; createdAt: string; lastMessageAt: string | null }
/**
 * `replyToMessageIds` is every message this one answers, oldest-first (VS-449) — several when a turn
 * was woken by more than one human message and answered them together; normally one. It always
 * contains `replyToMessageId` when that is non-null: the newest target, whose body `replyToExcerpt`
 * renders.
 */
export interface ThreadMessage { id: string; threadId: string; direction: 'inbound' | 'outbound'; authorKind: string; authorId: string | null; runId: string | null; projectId: string | null; /** VS-491: a roadmap block of `projectId` the message was sent with; null when none was chosen. */ blockId: string | null; replyToMessageId: string | null; replyToMessageIds: string[]; replyToExcerpt: string | null; body: string; parts: unknown[]; externalMessageId: string | null; deliveryStatus: string; createdAt: string }
/** One full-text search hit over a thread's stored messages (VS-320): newest first, with the matched text located by a snippet delimited by `\u0002` / `\u0003` (control characters no message body will ever contain — `[` / `]` collide with markdown links, checkboxes and `[Risk]`-style labels; never raw HTML — the client renders the highlight itself). */
export interface ThreadSearchResult { messageId: string; authorKind: string; authorId: string | null; createdAt: string; snippet: string }
/** A file/image attached to a `ThreadMessage` (VS-133). Always written in the same transaction as the message that owns it. */
export interface Attachment { id: string; threadId: string; messageId: string; filename: string; mediaType: string; byteSize: number; storageKey: string; createdAt: string }
/** The `ThreadMessage.parts` shape an attachment is recorded as, so the transcript can render it without a second fetch. */
export interface AttachmentPart { type: 'attachment'; id: string; filename: string; mediaType: string; byteSize: number }
/** A binary file made available as context on a ticket (VS-502). */
export interface TicketAttachment { id: string; ticketId: string; label: string; mediaType: string; byteSize: number; sha256: string; storageKey: string; createdAt: string; url?: string }
export interface Briefing { needsYou: Array<{ decisionId: string; ticketId: string | null; title: string; kind: string; recommendation: string | null; createdAt: string }>; needsYouTotal?: number; landed: Array<{ ticketId: string; identifier: string; title: string; completedAt: string; prUrl?: string }>; underway: Array<{ workerId: string; workerName: string; workerStatus: string; workerPauseReason: string | null; ticketId: string; identifier: string; title: string; status: string; lastStatus: string | null }>; queued: Array<{ ticketId: string; identifier: string; title: string; reason: string }>; warnings: string[]; generatedAt: string }
/**
 * A system incident an agent filed (VS-174). Daemon-level: it lives in `daemon.sqlite`, not in a
 * workspace. `reporterKind` is the filing run's agent kind, never a caller-supplied field.
 */
export interface Incident {
  id: string;
  reporterKind: E.IncidentReporterKind;
  title: string;
  whatFailed: string;
  tryingToDo: string;
  evidence: string | null;
  workspaceId: string | null;
  projectId: string | null;
  ticketId: string | null;
  agentId: string;
  runId: string;
  roleId: string | null;
  createdAt: string;
  /** Set by `weave_incident_resolve` (VS-271); null means still open. */
  resolvedAt: string | null;
  resolvedByAgentId: string | null;
  /** The workspace the resolving run belonged to (VS-499); distinct from `workspaceId`, where it was filed. */
  resolvedByWorkspaceId: string | null;
  resolution: string | null;
  resolutionTicketId: string | null;
}

/**
 * A deferred daemon upgrade (PLAN §20). Daemon-level: it lives in `daemon.sqlite`, not in a workspace.
 * `drainedRuns` is what was still executing when the upgrade began holding dispatch, counted then
 * because nothing can count it afterwards; `interruptedRuns` is how many of those were still executing
 * when the bounded wait for idle expired and the upgrade proceeded anyway (VS-115) — `null` when the
 * wait never expired; `announcedAt` is the once-only marker of VS-76's announcement, set by the daemon
 * that reports the finished upgrade to the workspace.
 */
export interface Upgrade { id: string; state: E.UpgradeState; source: string; ref: string; runTest: number; targetSha: string | null; fromRelease: string | null; toRelease: string | null; toSha: string | null; requestedBy: string; requestedAt: string; startedAt: string | null; finishedAt: string | null; reason: E.UpgradeFailureReason | null; message: string | null; log: string[]; backups: string[]; cameBackVersion: string | null; drainedRuns: number | null; interruptedRuns: number | null; announcedAt: string | null; migrationOutcome: E.UpgradeMigrationOutcome | null }

/** One health check the upgrade announcement makes before it claims the daemon is back up (VS-76). */
export interface UpgradeHealthCheck { name: 'database' | 'supervisor' | 'runtimes'; ok: boolean; detail: string }

/** A release as an announcement names it: where it is, what it was built from, what it calls itself. */
export interface UpgradeRelease { path: string | null; sha: string | null; version: string | null }

/**
 * What a finished upgrade tells one workspace (VS-76, `daemon-upgrade/upgrade-announcement`). It is the
 * payload of the conductor's `system` wake; the chat line the human gets is rendered from the same
 * record, so the two can never disagree.
 */
export interface UpgradeAnnouncement {
  kind: 'daemon.upgraded';
  upgradeId: string;
  /**
   * `rolled_back` is a failure whose target is not the release now executing; `recorded_completed` is a
   * row recorded `completed` that the announcing daemon is not actually running, so the announcement
   * never reads as a successful upgrade (VS-315).
   */
  outcome: 'completed' | 'failed' | 'rolled_back' | 'recorded_completed';
  from: UpgradeRelease;
  to: UpgradeRelease;
  /** The release the daemon making the announcement is executing. */
  running: UpgradeRelease;
  startedAt: string | null;
  finishedAt: string | null;
  /** When the daemon making the announcement was serving again. */
  backUpAt: string;
  /**
   * `drained`: runs waited out before the switch. `interrupted`: how many turns the restart actually
   * recorded as interrupted (VS-339 reads this from the records, not from a pre-restart snapshot).
   * `resumed`: how many of those turns' own wakes are queued to start again, not every queued wake
   * in the workspace (VS-339).
   */
  runs: { drained: number; interrupted: number; resumed: number };
  /** Work that landed between the previous release being built and the new one being built. */
  tickets: Array<{ identifier: string; title: string; at: string }>;
  /**
   * How many landed tickets the cap left out of `tickets` (VS-315). The list is one entry per ticket,
   * newest first; a non-zero value is stated in the announcement line too, so the cap is never silent.
   */
  ticketsOmitted: number;
  /**
   * Ticket-referencing commits in the release window with no matching entry in `tickets` (VS-239):
   * `count` is the true total, `identifiers` a possibly-bounded list of them. Diagnostic only — never
   * a second source for `tickets` itself, since a commit subject is not a delivery record.
   */
  undelivered: { count: number; identifiers: string[] };
  /** Migration files applied when this process opened the daemon and workspace databases. */
  migrations: string[];
  /**
   * VS-316: whether this upgrade also migrated the host's service-management unit from the pre-rename
   * name to the current one. Not to be confused with `migrations` above (database schema files) — this
   * is about the systemd unit or launchd agent that runs the daemon itself. `null` when not applicable.
   */
  migrationOutcome: E.UpgradeMigrationOutcome | null;
  health: { ok: boolean; checks: UpgradeHealthCheck[] };
  failure: { reason: E.UpgradeFailureReason | null; message: string | null } | null;
}

/**
 * One worker turn a restart cut off and is resuming: the worker, its ticket and its run. Carried both
 * in the notice's `interrupted` list and, for the subset the run limit holds back, in
 * `queuedForCapacity` (VS-375).
 */
export interface RestartNoticeTurn {
  runId: string;
  agentId: string;
  agentName: string;
  agentKind: string;
  ticketId: string | null;
  ticketIdentifier: string | null;
}

/**
 * What a non-upgrade daemon restart tells one workspace (VS-339, `daemon-restart/restart-announcement`):
 * the payload of the weaver's `system` wake. The chat line the human gets is rendered from the same
 * record, so the two cannot disagree.
 */
export interface RestartNotice {
  kind: 'daemon.restarted';
  /** When this boot began serving again. */
  bootAt: string;
  /** When the previous process booted, from the durable lifecycle record; null on the first boot. */
  previousBootAt: string | null;
  /** When the previous process recorded a deliberate shutdown; null when it crashed or never shut down. */
  downAt: string | null;
  shutdownReason: string | null;
  /** True when the previous process recorded a deliberate shutdown at or after its own boot. */
  clean: boolean;
  /** Start attempts that failed since the previous boot, with the last one's reason. */
  failedStarts: { count: number; lastAt: string | null; lastReason: string | null };
  /** The turns the restart cut off and is resuming: the worker, its ticket and its run. */
  interrupted: RestartNoticeTurn[];
  /**
   * VS-375: the subset of `interrupted` that cannot start on the first dispatch because the run limit
   * is reached — the workspace's `maxConcurrentRuns` less the weaver's own slot, and a project's
   * `maxWorkers` — in dispatch order. Empty when every interrupted turn can start at once.
   */
  queuedForCapacity: RestartNoticeTurn[];
}
/** One sub-step of a job: fixed for the job's kind, timed independently (VS-37, workspace-setup/setup-jobs). */
export interface JobStep { id: string; label: string; state: E.JobStepState; startedAt: string | null; endedAt: string | null }
/** One captured output line. `seq` is monotonic within the job, so a stream can be resumed after it. */
export interface JobLogLine { seq: number; step: string; stream: E.JobLogStream; text: string }
/** A long-running workspace-setup operation. Workspace-scoped, durable, readable after a restart. */
export interface Job { id: string; workspaceId: string; kind: E.JobKind; entityType: string; entityId: string; state: E.JobState; steps: JobStep[]; log: JobLogLine[]; logSeq: number; requestedBy: string; startedAt: string; finishedAt: string | null; failedStep: string | null; message: string | null }

/** Daily wall-clock fire in `timezone`, including DST (VS-220). */
export interface RoutineScheduleDaily {
  kind: 'schedule';
  timezone: string;
  daily: { hour: number; minute: number };
}
/** Interval fire: `fromInstant + everyMinutes` (VS-220). */
export interface RoutineScheduleInterval {
  kind: 'schedule';
  timezone: string;
  everyMinutes: number;
}
export type RoutineTrigger = RoutineScheduleDaily | RoutineScheduleInterval;

/** Instruction carried on each fire. Not a ticket template (ADR 0018). */
export interface RoutineTemplate {
  instruction: string;
  action: E.RoutineAction;
  maxTicketsPerFire: number;
  projectId?: string | null;
}

/**
 * A recurring alarm that wakes the conductor (VS-220). Human-facing name is "Scheduled tasks";
 * the row, HTTP, CLI and MCP identifiers stay `routine`.
 */
export interface Routine {
  id: string;
  workspaceId: string;
  name: string;
  trigger: RoutineTrigger;
  template: RoutineTemplate;
  roleId: string | null;
  concurrency: E.RoutineConcurrency;
  status: E.RoutineStatus;
  lastFiredAt: string | null;
  nextFireAt: string | null;
  inFlightWakeId: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Per-routine spend rollup (conductor fires plus originated tickets). */
export interface RoutineUsage {
  tokensIn: number;
  tokensOut: number;
  tokensCached: number;
  runs: number;
  costCents: number;
  costReportedCents: number;
  window: E.RoutineUsageWindow;
}

/**
 * One kept fire of a routine, derived from its wake joined to the conductor run (VS-231).
 * `sharedTurn` is true when that run also claimed work that was not this routine.
 */
export interface RoutineFire {
  wakeId: string;
  runId: string | null;
  firedAt: string;
  status: string;
  summary: string | null;
  sharedTurn: boolean;
}

/** A routine as `list()` returns it: the row plus how many non-skipped fires it has kept. */
export interface RoutineListItem extends Routine {
  fireCount: number;
}

/**
 * A remembered idea on one project's roadmap (VS-397). Not a ticket: it belongs to a project, sits in
 * a manual order, and carries a status until captain decides to start it — at which point a ticket is
 * filed and linked through `ticketId`. Since VS-478 it may also be a **pending ticket**: assigned to
 * a block and carrying the fields a real ticket needs (`description`, `kind`, `priority`, `roleId`).
 */
export interface RoadmapItem {
  id: string;
  workspaceId: string;
  projectId: string;
  /** The block this item is a pending ticket of; null means a loose item (VS-478). */
  blockId: string | null;
  title: string;
  notes: string;
  /** The markdown body the created ticket will carry, acceptance criteria included (VS-478). */
  description: string;
  kind: E.TicketKind;
  priority: E.TicketPriority;
  /** The role the pending ticket targets; null when the weaver will pick one (VS-478). */
  roleId: string | null;
  position: number;
  status: E.RoadmapStatus;
  ticketId: string | null;
  createdByKind: E.AuthorKind;
  createdById: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * One merged-away pending ticket, recorded on the item that absorbed it (VS-478). The merged item is
 * deleted by the merge, so its title and description are snapshotted here — the record has to outlive
 * the row it came from.
 */
export interface RoadmapMergeRecord {
  id: string;
  itemId: string;
  sourceItemId: string;
  sourceTitle: string;
  sourceDescription: string;
  mergedByKind: E.AuthorKind;
  mergedById: string | null;
  mergedAt: string;
}

/**
 * An ordered, named group of pending tickets on one project's roadmap (VS-478). The weaver builds a
 * block up from chat and starts it: `status` is the stored lifecycle, while `reportedStatus` adds the
 * derived `done` once every linked ticket is terminal.
 */
export interface RoadmapBlock {
  id: string;
  workspaceId: string;
  projectId: string;
  title: string;
  notes: string;
  position: number;
  status: E.RoadmapBlockStoredStatus;
  reportedStatus: E.RoadmapBlockStatus;
  startedAt: string | null;
  createdByKind: E.AuthorKind;
  createdById: string | null;
  createdAt: string;
  updatedAt: string;
  /** The block's pending tickets, in the project's item order. */
  items: RoadmapItem[];
}

/**
 * The one filing-ready draft `start` returns for a block (VS-478, VS-557). Starting a block files
 * **one ticket for the whole block** by default, so the draft carries the block's title, every
 * still-unfiled item as a section of `description`, and the `itemIds` the one ticket covers.
 * Splitting is the exception and a deliberate second step, never the default path.
 */
export interface RoadmapBlockDraft {
  title: string;
  description: string;
  kind: E.TicketKind;
  priority: E.TicketPriority;
  roleId: string | null;
  /** Every still-unfiled item this one ticket covers (VS-557). */
  itemIds: string[];
}


/**
 * A captain-authored, pre-ticket planning session (VS-398): a read-only planning agent chats with
 * captain in `threadId` while `PlanDraft` rows accumulate a draft ticket plan. A project may hold
 * several `drafting` plans at once (VS-477), each shown as a tab; submitting one hands it to the
 * weaver as one structured wake.
 */
export interface Plan {
  id: string;
  workspaceId: string;
  projectId: string;
  threadId: string;
  /** The live planning agent for this plan; null once it has retired (submit or discard). */
  agentId: string | null;
  title: string | null;
  /** VS-477: whether `title` was generated by the planner (`auto`) or renamed by captain (`human`). */
  titleSource: E.PlanTitleSource;
  status: E.PlanStatus;
  createdByKind: E.AuthorKind;
  createdById: string;
  submittedAt: string | null;
  discardedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * A drafting plan as a tab (VS-477): enough to render the tab strip — title, status and draft count —
 * without loading every plan's full conversation and draft list.
 */
export interface PlanSummary {
  id: string;
  projectId: string;
  title: string | null;
  titleSource: E.PlanTitleSource;
  status: E.PlanStatus;
  draftCount: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * One draft ticket in a `Plan`'s ordered list. `suggestedTier` is the planner's pick; `tierOverride`
 * is captain's and takes precedence when set — neither carries an explanatory reason. `blockedBy` is
 * populated separately from `plan_draft_blockers` (other draft ids in the same plan), since real
 * tickets do not exist yet to use `ticket_relations`.
 */
export interface PlanDraft {
  id: string;
  planId: string;
  position: number;
  title: string;
  /** VS-622: an optional short summary shown on the collapsed card, distinct from the full `description`; null falls back to the description's first sentence at render time. */
  summary: string | null;
  description: string;
  kind: E.PlanDraftKind;
  priority: E.TicketPriority;
  targetRoleId: string | null;
  suggestedTier: E.PlanDraftTier;
  tierOverride: E.PlanDraftTier | null;
  status: E.PlanDraftStatus;
  createdTicketId: string | null;
  failureReason: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * VS-550: where a ticket came from a plan — the plan it was drafted in, and whether the draft
 * became this ticket before the plan was submitted (`dispatched`, a planner running its own scout
 * early) or at submission like every other draft. Read from `plan_drafts.created_ticket_id`; never
 * stored on the ticket.
 */
export interface PlanOrigin {
  ticketId: string;
  planId: string;
  planTitle: string | null;
  planStatus: E.PlanStatus;
  /** True when the linked draft was created before the plan was submitted — an early dispatch. */
  dispatched: boolean;
}

/**
 * One entry in a workspace's changelog (PLAN §13.6). Derived from an `activity` row at read time, so
 * `summary` and `link` are rendered rather than stored — see `changelogEntry` in `@weave-ai/render`.
 */
export interface ChangelogEntry {
  id: string; at: string; kind: E.ChangelogKind;
  actor: { kind: E.AuthorKind; id: string | null; label: string };
  projectId: string | null; ticketId: string | null; ticketIdentifier: string | null;
  summary: string; link: { kind: 'ticket' | 'url'; target: string } | null;
}
/** A page of changelog entries, newest first. `nextCursor` is null when nothing older remains. */
export interface ChangelogPage { entries: ChangelogEntry[]; nextCursor: string | null }
/** One day of the activity heatmap. `date` is `YYYY-MM-DD` in the timezone the caller asked for. */
export interface ChangelogDay { date: string; landed: number; total: number; byKind: Record<E.ChangelogKind, number> }
/** The heatmap series plus the measure it shades, so the view can state its definition. */
export interface ChangelogHeatmap {
  days: ChangelogDay[]; timezone: string;
  measure: { kind: E.ChangelogKind; label: string; definition: string };
}

/** What a done ticket's delivery reads as on a project that lands before it promotes (VS-568). */
export type DeliveryBadge = { state: 'on_landing'; branch: string } | { state: 'in_production'; branch: string };

/**
 * A ticket's delivery badge, derived from its recorded `delivery` JSON. `promotedAt` is stamped on the
 * ticket when a promotion includes it; a ticket landed directly on the default branch is in production
 * already. Null when the ticket has not landed or the project lands on its default branch (nothing to say).
 */
export function deliveryBadgeOf(project: Pick<Project, 'defaultBranch' | 'landingBranch'> | null, ticket: Pick<Ticket, 'status' | 'landingBranch' | 'delivery'>): DeliveryBadge | null {
  if (ticket.status !== 'done' || !project) return null;
  const d = (ticket.delivery ?? {}) as { merged?: unknown; landedOn?: unknown; promotedAt?: unknown };
  if (d.merged !== true) return null;
  const landedOn = typeof d.landedOn === 'string' ? d.landedOn : landingBranchOf(project, ticket);
  if (landedOn === project.defaultBranch) return project.landingBranch && project.landingBranch !== project.defaultBranch ? { state: 'in_production', branch: landedOn } : null;
  return typeof d.promotedAt === 'string' ? { state: 'in_production', branch: project.defaultBranch } : { state: 'on_landing', branch: landedOn };
}
