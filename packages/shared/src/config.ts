import { z } from 'zod';
import { DELIVERY_MODES, MERGE_METHODS, APPROVAL_OWNERS, ARCHIVE_COMMITS, SESSION_POLICIES, PERMISSION_MODES, WORKTREE_PROVIDERS } from './enums.js';
import type { ModelSource } from './enums.js';

const slug = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/, 'kebab-case slug');
const envRef = z.string().regex(/^\$\{[A-Z0-9_]+\}$/, 'must be an ${ENV_VAR} reference, never a literal secret');

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/**
 * VS-263: lets an object schema accept a field under an old key name or a new one, resolving both to
 * the new name. Both keys present at once is a refused, loud ambiguity (`path-compatibility`/VS-258's
 * policy, extended to config keys) rather than a silent pick. Built from `superRefine` + `transform` +
 * `pipe`, not a throwing `preprocess` — a thrown error inside `preprocess` propagates past
 * `safeParse` uncaught, which would break every `if (!parsed.success) ...` call site silently.
 */
export function withKeyAlias<S extends z.ZodTypeAny>(schema: S, oldKey: string, newKey: string): z.ZodType<z.infer<S>, z.ZodTypeDef, unknown> {
  return z.any().superRefine((raw, ctx) => {
    if (isPlainObject(raw) && oldKey in raw && newKey in raw) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `both '${oldKey}' and '${newKey}' are present; keep only one` });
    }
  }).transform((raw) => {
    if (isPlainObject(raw) && oldKey in raw && !(newKey in raw)) {
      const { [oldKey]: v, ...rest } = raw;
      return { ...rest, [newKey]: v };
    }
    return raw;
  }).pipe(schema);
}

/**
 * VS-263: value-level aliases, for a field whose legacy spelling is a fixed value rather than a key
 * name (`createdBy`, `APPROVAL_OWNERS`) — a single field can't hold two values at once, so there is no
 * "both present" ambiguity to refuse, unlike `withKeyAlias`.
 */
const legacyApprovalOwner = z.preprocess((v) => (v === 'conductor' ? 'weaver' : v), z.enum(APPROVAL_OWNERS));
const legacyCreatedBy = z.preprocess((v) => (v === 'conductor' ? 'weaver' : v), z.enum(['human', 'weaver'] as const));

export const ProjectPoliciesSchema = z.object({
  proposalApproval: legacyApprovalOwner.default('human'),
  mergeMethod: z.enum(MERGE_METHODS).default('squash'),
  deliveryMode: z.enum(DELIVERY_MODES).default('pr'),
  autoMergeDefault: z.boolean().default(false),
  taskApproval: legacyApprovalOwner.default('none'),
  archiveCommit: z.enum(ARCHIVE_COMMITS).default('push'),
  requireCi: z.boolean().default(true),
  /** How many of this project's tickets may be in the active merge step at once (PLAN §11.4). */
  mergeConcurrency: z.number().int().min(1).max(8).default(1),
  /** YOLO mode for this project (PLAN §15, VS-382); off unless this project sets it true. */
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
 * Whether YOLO mode — the daemon grants plan and merge approvals itself (PLAN §15, VS-382) — is on
 * for a project. It is a per-project setting with no workspace default: only an explicit project
 * `yolo: true` turns it on, and an absent or malformed value is off, so a typo can never silently
 * turn auto-approval on.
 */
export function yoloEnabled(policies: Record<string, unknown> | null | undefined): boolean {
  const raw = (policies as { yolo?: unknown } | null | undefined)?.yolo;
  if (raw === undefined || raw === null) return false;
  const parsed = ProjectPoliciesSchema.shape.yolo.safeParse(raw);
  return parsed.success && parsed.data === true;
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
  /** VS-358: opt-in per project to also committing its knowledge into `.weave/knowledge/` in its own repo. Off unless a human turns it on. */
  knowledgeRepo: z.object({ enabled: z.boolean().default(false) }).default({ enabled: false }),
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
export const PresentationConfigSchema = withKeyAlias(z.object({
  default: z.string().default('headless'),
  weaver: PresentationBlockSchema.optional(),
  workers: PresentationBlockSchema.optional(),
}), 'conductor', 'weaver');
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
 * One named worker model a ticket may point at (VS-162, ADR 0012; VS-236, ADR 0019). `id` is the
 * kebab slug the conductor passes as `workerModelId`; `description` is the when-to-use note.
 * `runtime: null` means the option is not yet chosen — distinct from `model: null` (the runtime picks).
 */
export const WorkerModelOptionSchema = ModelSettingSchema.extend({
  id: slug,
  description: z.string().min(1).max(200),
  runtime: z.string().min(1).nullable().default(null),
});
export type WorkerModelOption = z.infer<typeof WorkerModelOptionSchema>;

/** A worker option whose adapter has been chosen and can be used to launch a worker (VS-236). */
export function isWorkerOptionConfigured(opt: WorkerModelOption): opt is WorkerModelOption & { runtime: string } {
  return opt.runtime != null;
}

/** The whole catalog as the daemon validates it — the editor validates against this too (VS-212). */
export const WorkerOptionsArraySchema = z.array(WorkerModelOptionSchema).max(16).superRefine((opts, ctx) => {
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

/**
 * The three daemon catalog tiers a missing `daemon.yaml` is seeded with (VS-236). Descriptions are
 * the when-to-use copy captain asked to keep verbatim. Not a schema default — existing installs
 * that omitted `models` must stay empty.
 */
export const DEFAULT_WORKER_TIERS: WorkerModelOption[] = WorkerOptionsArraySchema.parse([
  {
    id: 'quick',
    description: 'Fastest. The fix is already located and specified — a known one-liner, rename, or config value. No diagnosis, no design choice, nothing production-facing.',
    runtime: null,
    model: null,
  },
  {
    id: 'standard',
    description: 'Default for specified work: cause known, approach clear, but spans several files or needs judgement on tests and edge cases. Not for finding out why something broke.',
    runtime: null,
    model: null,
  },
  {
    id: 'deep',
    description: 'Cause unknown, a design decision is open, or it touches production or shared infrastructure. All scouts. "Find out why" belongs here however small the fix looks.',
    runtime: null,
    model: null,
  },
]);

/**
 * Optional per-control overlays on the daemon (VS-185, ADR 0013). Absent/null (and an empty
 * `workerOptions` list) means no overlay for that control; a present setting or a non-empty catalog
 * is filled and governs every workspace.
 */
export const DaemonModelsSchema = withKeyAlias(z.object({
  weaver: ModelSettingSchema.nullish(),
  workers: ModelSettingSchema.nullish(),
  workerOptions: WorkerOptionsArraySchema.nullish(),
}), 'conductor', 'weaver');
export type DaemonModels = z.infer<typeof DaemonModelsSchema>;

/** `PUT /api/daemon/models`: omitted key leaves that overlay; `null` (or `workerOptions: []`) clears. */
export const DaemonModelsPutSchema = withKeyAlias(z.object({
  weaver: ModelSettingSchema.nullable().optional(),
  workers: ModelSettingSchema.nullable().optional(),
  workerOptions: WorkerOptionsArraySchema.nullable().optional(),
}), 'conductor', 'weaver');
export type DaemonModelsPut = z.infer<typeof DaemonModelsPutSchema>;

/**
 * The whole of model selection **as a workspace stores it** (VS-284): `weaver`/`workers` are
 * optional — absent means the workspace has not configured that control at all, distinct from a
 * present `ModelSetting` (even one with `model: null`, which means "configured to let the runtime
 * pick"). This is `WorkspaceConfig['models']`'s type; it is not the fully-resolved value a turn
 * actually runs on — see `EffectiveModels` for that.
 */
export const WorkspaceModelsSchema = withKeyAlias(z.object({
  weaver: ModelSettingSchema.optional(),
  workers: ModelSettingSchema.optional(),
  workerOptions: WorkerOptionsArraySchema.default([]),
}), 'conductor', 'weaver');
export type WorkspaceModels = z.infer<typeof WorkspaceModelsSchema>;

/**
 * `PUT /models` body (VS-356): each control is independent. `undefined`/omitted leaves the stored
 * value; `null` clears it back to inherit; a value overrides it. `workerOptions` may be an array to
 * replace the catalog, `null` (or `[]`) to clear it to inherit the daemon catalog, or omitted to
 * keep it. An old body carrying both `weaver` and `workers` still writes both.
 */
export const WorkspaceModelsPutSchema = withKeyAlias(z.object({
  weaver: ModelSettingSchema.nullish(),
  workers: ModelSettingSchema.nullish(),
  workerOptions: WorkerOptionsArraySchema.nullish(),
}), 'conductor', 'weaver');
export type WorkspaceModelsPut = z.infer<typeof WorkspaceModelsPutSchema>;

/** The setting in force when nothing — neither a workspace nor a daemon overlay — has configured a control. */
export const DEFAULT_MODEL_SETTING: ModelSetting = ModelSettingSchema.parse({});

/**
 * A workspace's model selection **fully resolved**: what `effectiveModels()` returns, what a turn
 * actually runs on, and the `GET /models` wire shape. Always fully filled, unlike the stored
 * `WorkspaceModels` above, whose `weaver`/`workers` may be absent.
 */
export interface EffectiveModels {
  weaver: ModelSetting;
  workers: ModelSetting;
  workerOptions: WorkerModelOption[];
}

/** The two settings in force when no workspace or daemon config is in play (seeds, fallbacks, tests). */
export const DEFAULT_WORKSPACE_MODELS: EffectiveModels = {
  weaver: DEFAULT_MODEL_SETTING,
  workers: DEFAULT_MODEL_SETTING,
  workerOptions: [],
};

/** Where each effective control comes from (VS-356): `'workspace'` stored, `'daemon'` overlay, else `'default'`. */
export interface WorkspaceModelsSource {
  weaver: ModelSource;
  workers: ModelSource;
  workerOptions: ModelSource;
}

/**
 * The workspace models wire shape (VS-356): the effective values plus, additively, where each
 * control came from, so a client can tell an inherited value from a pinned one that happens to be
 * equal. `EffectiveModels` itself stays source-free — it is what a turn resolves on.
 */
export type WorkspaceModelsView = EffectiveModels & { source: WorkspaceModelsSource };

export const WorkspaceDefaultsSchema = withKeyAlias(z.object({
  proposalApproval: legacyApprovalOwner.default('human'),
  hireApproval: legacyApprovalOwner.default('human'),
  deliveryMode: z.enum(DELIVERY_MODES).default('pr'),
  autoMerge: z.boolean().default(false),
  worktrees: z.enum(WORKTREE_PROVIDERS).default('worktrunk'),
  maxConcurrentRuns: z.number().int().min(1).default(6),
  turnTimeoutSec: z.number().int().min(60).default(2700),
  silenceTimeoutSec: z.number().int().min(60).default(600),
  spawnWaitWarnSec: z.number().int().default(600),
  weaverDigestIntervalSec: z.number().int().default(120),
  sessionMaxIdleDays: z.number().int().default(14),
  /**
   * How long an interactive session's ticket (VS-101) may go with no human message and no turn
   * running before the daemon cancels its worker itself — always leaving the worktree kept, never
   * discarded. Named apart from `sessionMaxIdleDays`, which is unrelated: that one is a runtime
   * CLI's own resumable-session handle going stale, not a human's interactive session.
   */
  interactiveSessionIdleTimeoutMinutes: z.number().int().min(1).default(240),
  /**
   * VS-249: how long a human may hold a worker's session before the supervisor's abandonment sweep
   * is even willing to consider closing it. The sweep also requires `handoverQuietMinutes` of no
   * observed session activity on top of this — elapsed time alone never closes a hold still in use.
   */
  handoverAbandonTimeoutMinutes: z.number().int().min(1).default(120),
  /**
   * VS-249: how long a held session's activity signal (a cheap stat of the runtime's session file)
   * must go unchanged, once `handoverAbandonTimeoutMinutes` has passed, before the hold is closed
   * automatically. Shorter than the abandon timeout on purpose: once real activity has been seen at
   * least once, a normal pause (stepping away, waiting on hardware) should not need the full two
   * hours to be told apart from an abandonment.
   */
  handoverQuietMinutes: z.number().int().min(1).default(30),
  /**
   * VS-202: how long a worker's `last_run_at` may go stale, with its ticket still open, no open
   * decision, no queued/claimed wakeup and no run in flight, before the supervisor flags it as
   * stalled. Deliberately its own field rather than reusing `spawnWaitWarnSec`: the five other
   * conditions already rule out every legitimate reason a worker would be quiet, so this only needs
   * to absorb the ordinary latency between a run finishing and its follow-up wakeup landing — not
   * to distinguish a healthy wait from an unhealthy one. 300s is comfortably longer than that
   * latency and well under the 20 minutes the VS-199 incident sat unnoticed.
   */
  stalledWorkerTimeoutSec: z.number().int().min(60).default(300),
  /**
   * VS-467: how long a merge-slot holder may sit with unresolved checks before the supervisor raises
   * its weaver-visible alarm — and how often the alarm repeats while it stays unresolved. A run that
   * never starts, is cancelled and never re-runs, or belongs to a head the gate will not accept
   * would otherwise hold the serial merge queue with no signal at all.
   */
  mergeChecksAlarmSec: z.number().int().min(60).default(1200),
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
}).refine((d) => d.handoverQuietMinutes < d.handoverAbandonTimeoutMinutes, {
  message: 'handoverQuietMinutes must be smaller than handoverAbandonTimeoutMinutes',
  path: ['handoverQuietMinutes'],
}), 'conductorDigestIntervalSec', 'weaverDigestIntervalSec');

/** One `plugins:` list entry, shared by `daemon.yaml` and `workspace.yaml` (VS-334). */
export const PluginEntrySchema = z.union([z.string(), z.object({ name: z.string(), config: z.record(z.string(), z.unknown()).optional() })]);
export type PluginEntry = z.infer<typeof PluginEntrySchema>;

export const WorkspaceConfigSchema = withKeyAlias(z.object({
  version: z.literal(1),
  id: slug,
  name: z.string().min(1),
  ticketPrefix: z.string().regex(/^[A-Z][A-Z0-9]{1,9}$/),
  defaults: WorkspaceDefaultsSchema.default({}),
  /** Model selection, whole and entire: nothing else in this file names a runtime or a model. */
  models: WorkspaceModelsSchema.default({}),
  projects: z.array(ProjectConfigSchema).default([]),
  weaver: z.object({
    channels: z.array(z.string()).default(['web', 'cli']),
    heartbeatIntervalSec: z.number().int().optional(),
    humanName: z.string().optional(),
  }).default({}),
  presentation: PresentationConfigSchema.default({}),
  channels: z.record(z.string(), z.record(z.string(), z.unknown())).default({}),
  webhooks: z.array(z.object({ url: z.string().url(), events: z.array(z.string()).default(['*']), secret: envRef.optional() })).default([]),
  pricingOverrides: z.record(z.string(), z.object({ inputPerMTok: z.number(), outputPerMTok: z.number(), cachedInputPerMTok: z.number().optional() })).default({}),
  plugins: z.array(PluginEntrySchema).default([]),
}), 'conductor', 'weaver');
export type WorkspaceConfig = z.infer<typeof WorkspaceConfigSchema>;

/**
 * VS-263 Decision 6: the inverse of `withKeyAlias`'s read-side rename, applied only at the point a
 * `workspace.yaml` is actually serialized (`writeYamlFile`) — never to the in-memory config, and
 * never to a wire response. A rollback to a pre-VS-263 daemon reads back exactly the spelling it
 * always knew, so nothing here needs a corresponding change on the read side.
 */
export function toLegacySpelling(config: WorkspaceConfig): unknown {
  const { weaver, ...rest } = config;
  const { weaver: modelsWeaver, ...restModels } = config.models;
  const { weaverDigestIntervalSec, proposalApproval, hireApproval, ...restDefaults } = config.defaults;
  const { weaver: presentationWeaver, ...restPresentation } = config.presentation;
  return {
    ...rest,
    conductor: weaver,
    models: { ...restModels, conductor: modelsWeaver },
    defaults: {
      ...restDefaults,
      conductorDigestIntervalSec: weaverDigestIntervalSec,
      proposalApproval: proposalApproval === 'weaver' ? 'conductor' : proposalApproval,
      hireApproval: hireApproval === 'weaver' ? 'conductor' : hireApproval,
    },
    presentation: { ...restPresentation, conductor: presentationWeaver },
  };
}

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
  createdBy: legacyCreatedBy.default('weaver'),
  createdAt: z.string().optional(),
});
export type RoleSpec = z.infer<typeof RoleSpecSchema>;

/**
 * VS-263 Decision 6: `createdBy`'s counterpart to `toLegacySpelling` — a role file is a persisted
 * artifact a rolled-back pre-VS-263 daemon must still be able to parse. That daemon's `RoleSpecSchema`
 * only knows `z.enum(['human', 'conductor'])`; a stored `'weaver'` fails its `safeParse` and
 * `readRoleSpec` returns `null` there, which silently deletes the role rather than erroring.
 */
export function toLegacyRoleSpec(spec: RoleSpec): unknown {
  return { ...spec, createdBy: spec.createdBy === 'weaver' ? 'conductor' : spec.createdBy };
}

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
  /** `weave daemon upgrade`: where releases are built from and how many to keep (PLAN §20). */
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
  /**
   * Optional overlays for conductor, workers default, and the worker-options catalog (VS-185).
   * Empty (the default) leaves every workspace on its own `models` block.
   */
  models: DaemonModelsSchema.default({}),
  /**
   * Extra directories prepended to host tool resolution (`git`, `gh`, `openspec`, `wt`), for an
   * unusual layout the daemon user's login shell does not cover (VS-318). Empty is the normal case:
   * a deployment resolves its host tools with no configuration, from the user's login-shell PATH.
   */
  hostToolPaths: z.array(z.string()).default([]),
  logLevel: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  otlpEndpoint: z.string().optional(),
  /**
   * Loaded for every workspace this daemon serves, in addition to that workspace's own
   * `workspace.yaml` `plugins:` list (VS-334) — how a plugin like captain's Services page reaches
   * every workspace without editing each one's config.
   */
  plugins: z.array(PluginEntrySchema).default([]),
});
export type DaemonConfig = z.infer<typeof DaemonConfigSchema>;

/** VS-263 Decision 6: `toLegacySpelling`'s counterpart for `daemon.yaml`. */
export function daemonConfigToLegacySpelling(config: DaemonConfig): unknown {
  const { weaver, ...restModels } = config.models;
  return { ...config, models: { ...restModels, conductor: weaver } };
}

export const WorkspaceRegistrySchema = z.object({ workspaces: z.array(z.object({ id: slug, path: z.string() })).default([]) });
export type WorkspaceRegistry = z.infer<typeof WorkspaceRegistrySchema>;

export const ContextsFileSchema = z.object({
  current: z.string().optional(),
  contexts: z.record(z.string(), z.object({ url: z.string(), token: z.string(), workspace: z.string().optional(), certPin: z.string().optional() })).default({}),
});
export type ContextsFile = z.infer<typeof ContextsFileSchema>;
