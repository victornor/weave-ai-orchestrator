import { z } from 'zod';
import { DELIVERY_MODES, MERGE_METHODS, APPROVAL_OWNERS, SESSION_POLICIES, PERMISSION_MODES, WORKTREE_PROVIDERS } from './enums.js';

const slug = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/, 'kebab-case slug');
const envRef = z.string().regex(/^\$\{[A-Z0-9_]+\}$/, 'must be an ${ENV_VAR} reference, never a literal secret');

export const ProjectPoliciesSchema = z.object({
  proposalApproval: z.enum(APPROVAL_OWNERS).default('human'),
  mergeMethod: z.enum(MERGE_METHODS).default('squash'),
  deliveryMode: z.enum(DELIVERY_MODES).default('pr'),
  autoMergeDefault: z.boolean().default(false),
  taskApproval: z.enum(APPROVAL_OWNERS).default('none'),
  archiveCommit: z.enum(['push', 'pr', 'local']).default('push'),
  requireCi: z.boolean().default(true),
  /** How many of this project's tickets may be in the active merge step at once (PLAN §11.4). */
  mergeConcurrency: z.number().int().min(1).max(8).default(1),
  /** YOLO mode for this project, either way; unset inherits the workspace default (PLAN §15). */
  yolo: z.boolean(),
}).partial();
export type ProjectPolicies = z.infer<typeof ProjectPoliciesSchema>;

/** The default merge concurrency of a project that has not configured one: land one ticket at a time. */
export const DEFAULT_MERGE_CONCURRENCY = 1;

/**
 * How many tickets of a project may be in the active merge step at once. Policies reach core as an
 * untyped record, so an absent, malformed or out-of-range value falls back to the safe default.
 */
export function mergeConcurrencyOf(policies: Record<string, unknown> | null | undefined): number {
  const raw = (policies as { mergeConcurrency?: unknown } | null | undefined)?.mergeConcurrency;
  const parsed = ProjectPoliciesSchema.shape.mergeConcurrency.safeParse(raw);
  return parsed.success && parsed.data !== undefined ? parsed.data : DEFAULT_MERGE_CONCURRENCY;
}

/**
 * Whether YOLO mode — the daemon grants plan and merge approvals itself (PLAN §15) — is on here.
 * A project may override the workspace default in either direction; an absent or malformed project
 * value inherits, so a typo can never silently turn auto-approval on for a project that is off.
 */
export function yoloEnabled(policies: Record<string, unknown> | null | undefined, workspaceDefault: boolean): boolean {
  const raw = (policies as { yolo?: unknown } | null | undefined)?.yolo;
  if (raw === undefined || raw === null) return workspaceDefault;
  const parsed = ProjectPoliciesSchema.shape.yolo.safeParse(raw);
  return parsed.success && parsed.data !== undefined ? parsed.data : workspaceDefault;
}

export const ProjectConfigSchema = z.object({
  id: slug,
  url: z.string().min(1),
  name: z.string().optional(),
  defaultBranch: z.string().default('main'),
  /** Where this project's tickets' work actually lands, when it differs from `defaultBranch` (VS-119). */
  landingBranch: z.string().optional(),
  maxWorkers: z.number().int().min(1).max(32).default(4),
  setupCommand: z.string().optional(),
  warmPaths: z.array(z.string()).default([]),
  worktrees: z.enum(WORKTREE_PROVIDERS).optional(),
  openspec: z.object({ enabled: z.boolean().default(true) }).default({ enabled: true }),
  policies: ProjectPoliciesSchema.default({}),
});
export type ProjectConfig = z.infer<typeof ProjectConfigSchema>;

export const PresentationBlockSchema = z.object({
  surface: z.string().default('headless'),
  workspace: z.union([z.number(), z.string()]).optional(),
  layout: z.enum(['grid', 'per-project']).optional(),
  terminal: z.string().optional(),
  session: z.string().optional(),
  tabPerProject: z.boolean().optional(),
}).partial();
export type PresentationBlock = z.infer<typeof PresentationBlockSchema>;

/** The stored desired presentation: what `GET /presentation` returns and `PUT /presentation` accepts. */
export const PresentationConfigSchema = z.object({
  default: z.string().default('headless'),
  conductor: PresentationBlockSchema.optional(),
  workers: PresentationBlockSchema.optional(),
});
export type PresentationConfig = z.infer<typeof PresentationConfigSchema>;

/** Token budget per knowledge file (PLAN §13.1): one per hub file, one shared by every linked document. */
export const KnowledgeBudgetsSchema = z.object({
  workspace: z.number().int().min(500).default(10000),
  shared: z.number().int().min(500).default(2000),
  decisions: z.number().int().min(500).default(4000),
  project: z.number().int().min(500).default(10000),
  document: z.number().int().min(500).default(10000),
});
export type KnowledgeBudgets = z.infer<typeof KnowledgeBudgetsSchema>;
/** The budgets in force when no workspace config is in play (seeds, fallbacks, tests). */
export const DEFAULT_KNOWLEDGE_BUDGETS: KnowledgeBudgets = KnowledgeBudgetsSchema.parse({});

/**
 * One of the two model settings a workspace holds (VS-77, ADR 0011): what an agent of that kind is
 * launched with. `model: null` means the runtime picks; `effort` is optional and is the only place
 * it can still be set — the claude, codex and opencode adapters each turn it into a CLI flag.
 */
export const ModelSettingSchema = z.object({
  runtime: z.string().min(1).default('claude'),
  model: z.string().nullable().default(null),
  effort: z.string().optional(),
});
export type ModelSetting = z.infer<typeof ModelSettingSchema>;

/**
 * One named worker model a ticket may point at (VS-162, ADR 0012). `id` is the kebab slug the
 * conductor passes as `workerModelId`; `description` is the when-to-use note.
 */
export const WorkerModelOptionSchema = ModelSettingSchema.extend({
  id: slug,
  description: z.string().min(1).max(200),
});
export type WorkerModelOption = z.infer<typeof WorkerModelOptionSchema>;

const WorkerOptionsArraySchema = z.array(WorkerModelOptionSchema).max(16).superRefine((opts, ctx) => {
  const seen = new Set<string>();
  for (let i = 0; i < opts.length; i++) {
    const id = opts[i]?.id;
    if (!id) continue;
    if (seen.has(id)) {
      ctx.addIssue({ code: 'custom', message: `duplicate worker option id '${id}'`, path: [i, 'id'] });
    }
    seen.add(id);
  }
});

/** The whole of model selection for a workspace: two defaults, plus an optional worker-options catalog. */
export const WorkspaceModelsSchema = z.object({
  conductor: ModelSettingSchema.default({}),
  workers: ModelSettingSchema.default({}),
  workerOptions: WorkerOptionsArraySchema.default([]),
});
export type WorkspaceModels = z.infer<typeof WorkspaceModelsSchema>;

/**
 * `PUT /models` body: `workerOptions` omitted means keep the existing catalog; an explicit array
 * (including `[]`) replaces it. Conductor and workers are still required, matching the two-setting PUT.
 */
export const WorkspaceModelsPutSchema = z.object({
  conductor: ModelSettingSchema,
  workers: ModelSettingSchema,
  workerOptions: WorkerOptionsArraySchema.optional(),
});
export type WorkspaceModelsPut = z.infer<typeof WorkspaceModelsPutSchema>;

/** The two settings in force when no workspace config is in play (seeds, fallbacks, tests). */
export const DEFAULT_WORKSPACE_MODELS: WorkspaceModels = WorkspaceModelsSchema.parse({});

export const WorkspaceDefaultsSchema = z.object({
  proposalApproval: z.enum(APPROVAL_OWNERS).default('human'),
  hireApproval: z.enum(APPROVAL_OWNERS).default('human'),
  deliveryMode: z.enum(DELIVERY_MODES).default('pr'),
  autoMerge: z.boolean().default(false),
  /** YOLO mode: the daemon grants plan and merge approvals itself (PLAN §15). Off unless asked for. */
  yolo: z.boolean().default(false),
  worktrees: z.enum(WORKTREE_PROVIDERS).default('worktrunk'),
  maxConcurrentRuns: z.number().int().min(1).default(6),
  turnTimeoutSec: z.number().int().min(60).default(2700),
  silenceTimeoutSec: z.number().int().min(60).default(600),
  spawnWaitWarnSec: z.number().int().default(600),
  conductorDigestIntervalSec: z.number().int().default(120),
  sessionMaxIdleDays: z.number().int().default(14),
  /**
   * How long an interactive session's ticket (VS-101) may go with no human message and no turn
   * running before the daemon cancels its worker itself — always leaving the worktree kept, never
   * discarded. Named apart from `sessionMaxIdleDays`, which is unrelated: that one is a runtime
   * CLI's own resumable-session handle going stale, not a human's interactive session.
   */
  interactiveSessionIdleTimeoutMinutes: z.number().int().min(1).default(240),
  bootstrapBudgetTokens: z.number().int().default(16000),
  knowledgeBudgetTokens: KnowledgeBudgetsSchema.default({}),
  workerArchiveDays: z.number().int().default(30),
  runLogRetentionDays: z.number().int().default(30),
  permissionMode: z.enum(PERMISSION_MODES).default('auto'),
  /**
   * Whether a turn is spawned with its input channel open for the runtime's lifetime, when the
   * runtime supports it (VS-99) — what lets a human's message reach a running turn mid-turn rather
   * than only queuing for the next one. `false` returns every adapter to its pre-VS-99 spawn.
   */
  liveInput: z.boolean().default(true),
});

export const WorkspaceConfigSchema = z.object({
  version: z.literal(1),
  id: slug,
  name: z.string().min(1),
  ticketPrefix: z.string().regex(/^[A-Z][A-Z0-9]{1,9}$/),
  defaults: WorkspaceDefaultsSchema.default({}),
  /** Model selection, whole and entire: nothing else in this file names a runtime or a model. */
  models: WorkspaceModelsSchema.default({}),
  projects: z.array(ProjectConfigSchema).default([]),
  conductor: z.object({
    channels: z.array(z.string()).default(['web', 'cli']),
    heartbeatIntervalSec: z.number().int().optional(),
    humanName: z.string().optional(),
  }).default({}),
  presentation: PresentationConfigSchema.default({}),
  channels: z.record(z.string(), z.record(z.string(), z.unknown())).default({}),
  webhooks: z.array(z.object({ url: z.string().url(), events: z.array(z.string()).default(['*']), secret: envRef.optional() })).default([]),
  pricingOverrides: z.record(z.string(), z.object({ inputPerMTok: z.number(), outputPerMTok: z.number(), cachedInputPerMTok: z.number().optional() })).default({}),
  plugins: z.array(z.union([z.string(), z.object({ name: z.string(), config: z.record(z.string(), z.unknown()).optional() })])).default([]),
});
export type WorkspaceConfig = z.infer<typeof WorkspaceConfigSchema>;

export const RoleSpecSchema = z.object({
  id: slug,
  name: z.string().min(1),
  project: slug,
  title: z.string().optional(),
  icon: z.string().optional(),
  charterSummary: z.string().min(1),
  scope: z.string().min(1),
  responsibilities: z.array(z.string()).default([]),
  capabilities: z.array(z.string()).default([]),
  exclusions: z.array(z.string()).default([]),
  rules: z.array(z.string()).default([]),
  sessionPolicy: z.enum(SESSION_POLICIES).default('per_ticket'),
  maxWorkers: z.number().int().min(1).max(32).default(2),
  permission: z.object({ mode: z.enum(PERMISSION_MODES).default('auto'), allowed: z.array(z.string()).default([]), denied: z.array(z.string()).default([]) }).default({}),
  secrets: z.array(z.string()).default([]),
  notes: z.string().optional(),
  createdBy: z.enum(['human', 'conductor']).default('conductor'),
  createdAt: z.string().optional(),
});
export type RoleSpec = z.infer<typeof RoleSpecSchema>;

export const DaemonConfigSchema = z.object({
  version: z.literal(1).default(1),
  http: z.object({
    listen: z.string().default('127.0.0.1:7433'),
    publicUrl: z.string().optional(),
    trustProxy: z.boolean().default(false),
    tls: z.object({ mode: z.enum(['none', 'self-signed', 'acme', 'files']).default('none'), cert: z.string().optional(), key: z.string().optional(), acmeEmail: z.string().optional(), domains: z.array(z.string()).default([]) }).default({}),
  }).default({}),
  auth: z.object({
    loopbackTrusted: z.boolean().default(false),
    sessionDaysNamed: z.number().default(30),
    sessionHoursUnnamed: z.number().default(12),
    lockoutAttempts: z.number().int().default(5),
    lockoutMinutes: z.number().int().default(15),
  }).default({}),
  transcription: z.object({
    provider: z.enum(['none', 'command']).default('none'),
    command: z.string().optional(),
    /** Web composer dictation: Chrome / Web Speech (default) or Voxtype on the daemon host (VS-179). */
    backend: z.enum(['chrome', 'voxtype']).default('chrome'),
    /** Voxtype model id from `voxtype info models`. Ignored when backend is chrome. */
    model: z.string().optional(),
  }).default({}),
  /**
   * Web push. The browser cannot subscribe without the VAPID public key, so with no key configured
   * the web app says push is not configured on the daemon instead of failing with a DOMException.
   */
  push: z.object({ vapidPublicKey: z.string().optional() }).default({}),
  /** `conductor daemon upgrade`: where releases are built from and how many to keep (PLAN §20). */
  upgrade: z.object({
    /** Git URL or local path the release is cloned from. Required for `upgrade` unless `--from` is passed. */
    source: z.string().optional(),
    ref: z.string().default('main'),
    /** Releases older than the newest `keep` (never `current`/`previous`) are deleted after a switch. */
    keep: z.number().int().min(1).default(3),
    /**
     * Seconds to wait for running turns before restarting anyway. An agent turn can take many minutes,
     * so this bound only ever catches the fast case — nothing running, or a turn seconds from finishing
     * — before restarting regardless; whatever is still executing is interrupted by the restart and
     * resumes on its own, the same as any run a daemon restart interrupts.
     */
    drainTimeoutSec: z.number().int().min(0).default(30),
    /**
     * A deferred upgrade holds dispatch and waits for every running turn to finish, bounded by this so
     * one wedged run cannot hold every workspace's dispatch — including the conductor's own — silently
     * and forever. On expiry the upgrade proceeds to build anyway rather than failing: whatever is still
     * executing is ended and resumed by the restart that follows, exactly like any run a daemon restart
     * interrupts (VS-115).
     */
    waitForIdleSec: z.number().int().min(0).default(30),
    /** How long the "is the source ahead" answer is cached before the source is resolved again. */
    updateCheckIntervalSec: z.number().int().min(0).default(900),
  }).default({}),
  logLevel: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  otlpEndpoint: z.string().optional(),
});
export type DaemonConfig = z.infer<typeof DaemonConfigSchema>;

export const WorkspaceRegistrySchema = z.object({ workspaces: z.array(z.object({ id: slug, path: z.string() })).default([]) });
export type WorkspaceRegistry = z.infer<typeof WorkspaceRegistrySchema>;

export const ContextsFileSchema = z.object({
  current: z.string().optional(),
  contexts: z.record(z.string(), z.object({ url: z.string(), token: z.string(), workspace: z.string().optional(), certPin: z.string().optional() })).default({}),
});
export type ContextsFile = z.infer<typeof ContextsFileSchema>;
