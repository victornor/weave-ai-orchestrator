import type * as E from './enums.js';

export interface Workspace { id: string; slug: string; name: string; ticketPrefix: string; status: E.WorkspaceStatus; rootPath: string; createdAt: string; updatedAt: string }
export interface Project { id: string; workspaceId: string; slug: string; name: string; gitUrl: string; defaultBranch: string; clonePath: string; maxWorkers: number; setupCommand: string | null; worktreeProvider: E.WorktreeProviderId; openspecEnabled: boolean; openspecVersion: string | null; policies: Record<string, unknown>; status: E.ProjectStatus; lastFetchedAt: string | null; errorText: string | null }
export interface Role { id: string; workspaceId: string; projectId: string; slug: string; name: string; title: string | null; icon: string | null; charterSummary: string; scopeText: string; responsibilities: string[]; capabilities: string[]; rules: string[]; permission: Record<string, unknown>; sessionPolicy: E.SessionPolicy; maxWorkers: number; secrets: string[]; status: E.RoleStatus; pauseReason: string | null; specRevision: number; createdBy: string; createdAt: string; updatedAt: string }
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
export interface Agent { id: string; workspaceId: string; kind: E.AgentKind; projectId: string | null; roleId: string | null; roleRevision: number | null; ticketId: string | null; name: string; runtimeId: string; status: E.AgentStatus; pauseReason: string | null; pauseDetail: AgentPauseDetail | null; errorText: string | null; homePath: string; worktreePath: string | null; branch: string | null; turnEpoch: number; turnCount: number; spawnedBy: string; spawnReason: string | null; briefRevision: number; lastRunAt: string | null; retiredAt: string | null; createdAt: string; updatedAt: string }
export interface Ticket { id: string; workspaceId: string; projectId: string | null; number: number; identifier: string; kind: E.TicketKind; title: string; description: string; status: E.TicketStatus; priority: E.TicketPriority; autoMerge: boolean; assigneeRoleId: string | null; workerId: string | null; assigneeHuman: boolean; /** A human is conversing with this ticket's worker directly (VS-101): the session's whole persistent record. */ interactiveSession: boolean; parentId: string | null; createdByKind: string; createdById: string | null; createdRunId: string | null; originKind: string | null; originFingerprint: string | null; checkoutRunId: string | null; executionRunId: string | null; openspecChangeName: string | null; openspecState: Record<string, unknown> | null; delivery: Record<string, unknown> | null; unblock: { owner: string; action: string } | null; blockedFromStatus: E.TicketStatus | null; monitorNextCheckAt: string | null; blockedTransitionAt: string | null; mergeQueuedAt: string | null; mergeStartedAt: string | null; startedAt: string | null; completedAt: string | null; cancelledAt: string | null; createdAt: string; updatedAt: string }
export interface TicketComment { id: string; ticketId: string; authorKind: E.AuthorKind; authorId: string | null; runId: string | null; body: string; kind: E.CommentKind; sourceTrust: E.SourceTrust; createdAt: string }
/** One of a `multiselect` input's choices. Keys are unique within that input. */
export interface DecisionInputChoice { key: string; label: string; description?: string }
/**
 * A value a decision asks the human for, alongside (or instead of) choosing an option (VS-92).
 * `multiselect` carries its `choices`; `secret` carries the `secretName` its value is registered
 * under — the value of a secret input is never the answer, only the name is (see `answerInputs`).
 */
export interface DecisionInput {
  key: string;
  label: string;
  type: E.DecisionInputType;
  required?: boolean;
  placeholder?: string;
  /** `multiselect` only, and required for it. */
  choices?: DecisionInputChoice[];
  /** `secret` only, and required for it: the workspace secret name, which becomes the env var name. */
  secretName?: string;
}
/** What a card collected, keyed by input key: a string, or the chosen keys of a multi-select. A secret's string is its name. */
export type DecisionAnswerInputs = Record<string, string | string[]>;
export interface Decision { id: string; workspaceId: string; ticketId: string | null; projectId: string | null; kind: E.DecisionKind; owner: E.DecisionOwner; askedByAgentId: string | null; askedInRunId: string | null; title: string; context: string; options: Array<{ key: string; label: string; description?: string; recommended?: boolean }>; inputs: DecisionInput[]; allowFreeText: boolean; recommendation: string | null; status: E.DecisionStatus; answerKey: string | null; answerText: string | null; answerInputs: DecisionAnswerInputs | null; answeredByKind: string | null; answeredById: string | null; answeredAt: string | null; expiresAt: string | null; target: Record<string, unknown> | null; correlationKey: string | null; createdAt: string }
/** A workspace secret as any surface may see it (VS-92): the name, where it is exposed, and whether a value is held. Never the value. */
export interface WorkspaceSecret { name: string; envVarName: string; scope: E.SecretScope; scopeId: string | null; hasValue: boolean }
export interface Wakeup { id: string; workspaceId: string; agentId: string; source: E.WakeSource; reason: string; payload: Record<string, unknown>; idempotencyKey: string | null; status: E.WakeStatus; coalescedIntoId: string | null; skipReason: string | null; runId: string | null; requestedByKind: string | null; requestedById: string | null; notBefore: string | null; createdAt: string; claimedAt: string | null; finishedAt: string | null }
export interface Run { id: string; workspaceId: string; agentId: string; ticketId: string | null; sessionId: string | null; wakeupIds: string[]; runtimeId: string; model: string | null; status: E.RunStatus; turnEpoch: number; cwd: string; startedAt: string | null; finishedAt: string | null; exitCode: number | null; signal: string | null; pid: number | null; pgid: number | null; errorCode: string | null; errorFamily: E.RunErrorFamily | null; retryOfRunId: string | null; usage: { inputTokens: number; outputTokens: number; cachedInputTokens: number; contextTokens?: number; basis: string } | null; costCents: number | null; result: Record<string, unknown> | null; liveness: E.RunLiveness | null; logPath: string | null; summary: string | null; createdAt: string }
export interface RunEvent { id: string; runId: string; seq: number; ts: string; type: E.RunEventType; stream: string; level: string; payload: Record<string, unknown> }
/**
 * What a run did, counted off its stored events (VS-74). Cheap enough to ask for a page of history
 * at once, and enough to say what a turn was without loading its transcript. `files` counts distinct
 * paths, so a file edited four times is one; `texts` counts the assistant text and thinking blocks,
 * so `toolCalls + files + errors + texts` being zero is how a surface knows there is no transcript
 * worth offering, whatever bookkeeping events the run also recorded.
 */
export interface RunTrace { runId: string; status: E.RunStatus; agentId: string; createdAt: string; startedAt: string | null; finishedAt: string | null; durationMs: number | null; toolCalls: number; files: number; errors: number; texts: number; events: number; summary: string | null }
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
export interface ThreadMessage { id: string; threadId: string; direction: 'inbound' | 'outbound'; authorKind: string; authorId: string | null; runId: string | null; projectId: string | null; replyToMessageId: string | null; replyToExcerpt: string | null; body: string; parts: unknown[]; externalMessageId: string | null; deliveryStatus: string; createdAt: string }
export interface Briefing { needsYou: Array<{ decisionId: string; ticketId: string | null; title: string; kind: string; recommendation: string | null; createdAt: string }>; landed: Array<{ ticketId: string; identifier: string; title: string; completedAt: string; prUrl?: string }>; underway: Array<{ workerId: string; workerName: string; ticketId: string; identifier: string; title: string; status: string; lastStatus: string | null }>; queued: Array<{ ticketId: string; identifier: string; title: string; reason: string }>; warnings: string[]; generatedAt: string }
/**
 * A deferred daemon upgrade (PLAN §20). Daemon-level: it lives in `daemon.sqlite`, not in a workspace.
 * `drainedRuns` is what was still executing when the upgrade began holding dispatch, counted then
 * because nothing can count it afterwards; `announcedAt` is the once-only marker of VS-76's
 * announcement, set by the daemon that reports the finished upgrade to the workspace.
 */
export interface Upgrade { id: string; state: E.UpgradeState; source: string; ref: string; runTest: number; targetSha: string | null; fromRelease: string | null; toRelease: string | null; toSha: string | null; requestedBy: string; requestedAt: string; startedAt: string | null; finishedAt: string | null; reason: E.UpgradeFailureReason | null; message: string | null; log: string[]; backups: string[]; cameBackVersion: string | null; drainedRuns: number | null; announcedAt: string | null }

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
  /** `rolled_back` is a failure whose target is not the release now executing. */
  outcome: 'completed' | 'failed' | 'rolled_back';
  from: UpgradeRelease;
  to: UpgradeRelease;
  /** The release the daemon making the announcement is executing. */
  running: UpgradeRelease;
  startedAt: string | null;
  finishedAt: string | null;
  /** When the daemon making the announcement was serving again. */
  backUpAt: string;
  /** `drained`: runs waited out before the switch. `resumed`: wakes queued in this workspace now. */
  runs: { drained: number; resumed: number };
  /** Work that landed between the previous release being built and the new one being built. */
  tickets: Array<{ identifier: string; title: string; at: string }>;
  /** Migration files applied when this process opened the daemon and workspace databases. */
  migrations: string[];
  health: { ok: boolean; checks: UpgradeHealthCheck[] };
  failure: { reason: E.UpgradeFailureReason | null; message: string | null } | null;
}
/** One sub-step of a job: fixed for the job's kind, timed independently (VS-37, workspace-setup/setup-jobs). */
export interface JobStep { id: string; label: string; state: E.JobStepState; startedAt: string | null; endedAt: string | null }
/** One captured output line. `seq` is monotonic within the job, so a stream can be resumed after it. */
export interface JobLogLine { seq: number; step: string; stream: E.JobLogStream; text: string }
/** A long-running workspace-setup operation. Workspace-scoped, durable, readable after a restart. */
export interface Job { id: string; workspaceId: string; kind: E.JobKind; entityType: string; entityId: string; state: E.JobState; steps: JobStep[]; log: JobLogLine[]; logSeq: number; requestedBy: string; startedAt: string; finishedAt: string | null; failedStep: string | null; message: string | null }

/**
 * One entry in a workspace's changelog (PLAN §13.6). Derived from an `activity` row at read time, so
 * `summary` and `link` are rendered rather than stored — see `changelogEntry` in `@agent-conductor/render`.
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
