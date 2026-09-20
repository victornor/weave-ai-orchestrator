import { z } from 'zod';
import { DELIVERY_MODES, MERGE_METHODS, PROMOTION_MODES, APPROVAL_OWNERS, ARCHIVE_COMMITS, SESSION_POLICIES, PERMISSION_MODES, WORKTREE_PROVIDERS } from './enums.js';
import type { ModelSource, PromotionMode } from './enums.js';

const slug = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/, 'kebab-case slug');
const envRef = z.string().regex(/^\$\{[A-Z0-9_]+\}$/, 'must be an ${ENV_VAR} reference, never a literal secret');

/**
 * VS-579: a worker's memory limit in MB, a floor so a worker always has usable room and a ceiling
 * that is only a sanity bound (the real upper bound is the machine, checked when it is resolved).
 * `null` means "not configured" — derive it from the machine, never "no limit".
 */
export const WORKER_MEMORY_MIN_MB = 1024;
export const WORKER_MEMORY_MAX_MB = 1_048_576;

/** How much of the machine the simultaneous workers may take before the daemon and the OS need room. */
export const WORKER_MEMORY_SHARE = 0.8;

/** The derived default: a share of the base memory split across the runs that may go at once, floored. */
export function deriveWorkerMemoryMb(baseMemoryMb: number, maxConcurrentRuns: number): number {
  const runs = Math.max(1, Math.floor(maxConcurrentRuns));
  return Math.max(WORKER_MEMORY_MIN_MB, Math.floor((baseMemoryMb * WORKER_MEMORY_SHARE) / runs));
}

export interface WorkerMemoryResolution {
  mb: number;
  source: 'role' | 'workspace' | 'derived';
}

/**
 * VS-579: the limit in force for a worker — the role's override, else the workspace default, else
 * the machine-derived value. A caller passes the base memory it wants the derivation to use (the
 * host's total, or the daemon's own cgroup ceiling when it runs inside a container).
 */
export function resolveWorkerMemoryMb(input: {
  roleMb?: number | null; workspaceMb?: number | null; baseMemoryMb: number; maxConcurrentRuns: number;
}): WorkerMemoryResolution {
  if (input.roleMb != null) return { mb: input.roleMb, source: 'role' };
  if (input.workspaceMb != null) return { mb: input.workspaceMb, source: 'workspace' };
  return { mb: deriveWorkerMemoryMb(input.baseMemoryMb, input.maxConcurrentRuns), source: 'derived' };
}

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
  /**
   * What going live does, shown verbatim on the promotion card and carried into the promotion pull
   * request's body when landing differs from default (VS-568, VS-584).
   */
  promotionNotes: z.array(z.string().min(1).max(300)).max(12),
  /**
   * VS-584: how this project promotes landing to default. `auto` (the default) promotes by pull request
   * wherever a forge that can open one is available, and by fast-forward direct push only when it is not.
   * `direct-push` is an explicit opt-in for a project whose repository allows it.
   */
  promotionMode: z.enum(PROMOTION_MODES).default('auto'),
  /** VS-584: the promotion pull request's title; generated from the branches when unset. */
  promotionPrTitle: z.string().min(1).max(120),
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

/** The promotion mode of a project that has not configured one: derive it from the forge, safely. */
export const DEFAULT_PROMOTION_MODE: PromotionMode = 'auto';

/**
 * VS-584: a project's promotion mode. Policies reach core as an untyped record, so an absent, malformed
 * or out-of-range value falls back to `auto` — never to `direct-push`, which is what a bad value would
 * otherwise turn into.
 */
export function promotionModeOf(policies: Record<string, unknown> | null | undefined): PromotionMode {
  const raw = (policies as { promotionMode?: unknown } | null | undefined)?.promotionMode;
  const parsed = ProjectPoliciesSchema.shape.promotionMode.safeParse(raw);
  return parsed.success && parsed.data !== undefined ? parsed.data : DEFAULT_PROMOTION_MODE;
}

/**
 * VS-584: the resolved promotion strategy. `auto` promotes by pull request whenever a forge that can
 * open one is available, and only falls back to a fast-forward direct push when it is not — so a
 * repository whose protections require a pull request is never bypassed by default.
 */
export function promotionStrategyOf(
  policies: Record<string, unknown> | null | undefined,
  forgeCanOpenPullRequests: boolean,
): 'pull-request' | 'direct-push' {
  const mode = promotionModeOf(policies);
  if (mode === 'pull-request') return 'pull-request';
  if (mode === 'direct-push') return 'direct-push';
  return forgeCanOpenPullRequests ? 'pull-request' : 'direct-push';
}

/** VS-584: a project's promotion pull-request title, or null when it has not declared one. */
export function promotionPrTitleOf(policies: Record<string, unknown> | null | undefined): string | null {
  const raw = (policies as { promotionPrTitle?: unknown } | null | undefined)?.promotionPrTitle;
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return trimmed ? trimmed : null;
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
/** How a session is compacted automatically: never, at a percentage of the model window, or at an absolute size. */
export const COMPACTION_MODES = ['off', 'percent', 'tokens'] as const;
export const ModelCompactionSchema = z.object({
  mode: z.enum(COMPACTION_MODES).default('off'),
  /**
   * `percent`: 1–99 of the model's context window; `tokens`: an absolute request size. Mutually
   * exclusive by `mode` and unused when it is `off`. Read against the last turn's own context size.
   */
  value: z.number().positive().optional(),
});
export type ModelCompaction = z.infer<typeof ModelCompactionSchema>;

/**
 * The request size at which a policy compacts, or null when it is off or cannot be computed (a
 * percentage with no known window). `windowTokens` is the model's own context window; a percentage
 * is clamped to 1–99 so a policy can never mean "never" or "always".
 */
export function compactionThreshold(compaction: ModelCompaction | undefined, windowTokens: number | null | undefined): number | null {
  if (!compaction || compaction.mode === 'off' || compaction.value === undefined || compaction.value <= 0) return null;
  if (compaction.mode === 'tokens') return Math.round(compaction.value);
  if (!windowTokens || windowTokens <= 0) return null;
  return Math.round(windowTokens * Math.min(99, Math.max(1, compaction.value)) / 100);
}

/** An option value: the scalar shapes an adapter's `configSchema()` declares, plus string lists (extra args). */
export const RuntimeOptionValueSchema = z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]);
export type RuntimeOptionValue = z.infer<typeof RuntimeOptionValueSchema>;

export const ModelSettingSchema = z.object({
  runtime: z.string().min(1).default('claude'),
  model: z.string().nullable().default(null),
  effort: z.string().optional(),
  /** Automatic compaction for an agent on this setting, on top of whatever the CLI does by itself. */
  compaction: ModelCompactionSchema.optional(),
  /**
   * Per-runtime options, validated against the adapter's own `configSchema()` (see
   * `validateRuntimeOptions`). This is where compaction (`compactionPercent`,
   * `autoCompactTokenLimit`, `contextWindowTokens`), `toolOutputTokenLimit`, `extraArgs` and every
   * other adapter setting live. Omitted when nothing is set, so an untouched setting stays exactly
   * the runtime's own defaults.
   */
  options: z.record(RuntimeOptionValueSchema).optional(),
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
  /**
   * VS-579: a worker turn's memory limit in MB. `null` means derive it from the machine and
   * `maxConcurrentRuns` (see `deriveWorkerMemoryMb`); a role may override this per role.
   */
  workerMemoryMb: z.number().int().min(WORKER_MEMORY_MIN_MB).max(WORKER_MEMORY_MAX_MB).nullable().default(null),
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
   * VS-498: how many times the supervisor automatically wakes a detected-stalled worker to continue
   * its own ticket before giving up and raising a weaver-owned `gate_finding` instead. Independent of
   * `stalledWorkerTimeoutSec`: that governs how long a gap must be before a stall is even considered;
   * this governs how many times a genuine stall is nudged before it stops being treated as
   * self-recoverable. 2 gives a worker that stopped once at an unlucky but clean point a real second
   * chance without letting a systematically-stuck worker cycle through detection and recovery
   * indefinitely — each attempt still costs a full `stalledWorkerTimeoutSec` wait to re-detect, so a
   * larger cap directly trades a slower escalation for more automatic attempts.
   */
  stalledWorkerMaxAutoRecoverAttempts: z.number().int().min(0).default(2),
  /**
   * VS-467: how long a merge-slot holder may sit with unresolved checks before the supervisor raises
   * its weaver-visible alarm — and how often the alarm repeats while it stays unresolved. A run that
   * never starts, is cancelled and never re-runs, or belongs to a head the gate will not accept
   * would otherwise hold the serial merge queue with no signal at all.
   */
  mergeChecksAlarmSec: z.number().int().min(60).default(1200),
  bootstrapBudgetTokens: z.number().int().default(16000),
  /**
   * How much of the shared + project knowledge a worker's AGENTS.md inlines. Only the hub's
   * Overview / Current focus / Landmines ride in the always-sent prompt; the rest stays one
   * `weave_knowledge_get` away. This is what a worker's file_only runtime reads on every request, so
   * it is the per-turn bill — `bootstrapBudgetTokens` bounds only the first-turn digest beside it.
   */
  inlineKnowledgeBudgetTokens: z.number().int().default(4000),
  knowledgeBudgetTokens: KnowledgeBudgetsSchema.default({}),
  /**
   * VS-492: how long a linked document may go with no recorded read before it is treated as a
   * never-read document — a curation condition and a health measure. 90 days deliberately matches
   * `DOCUMENT_STALE_MS` (a season of silence), so "nobody has read it in a season" is judged on the
   * same horizon as "nobody has written it in a season" and the two signals stay comparable; a
   * shorter window would flag documents between ordinary curation cycles, a much longer one would let
   * an obsolete document sit for most of a year.
   */
  knowledgeNeverReadDays: z.number().int().min(1).default(90),
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

/**
 * VS-607: a model provider for the built-in `weave` runtime — any OpenAI-compatible Chat
 * Completions endpoint. The API key is a workspace secret named by `apiKeySecret`, never a value in
 * this file. `auth` is `bearer`, `none`, or `header:<Name>` for a provider that wants the key in a
 * named header. `models` carries what the endpoint does not say itself.
 */
/**
 * VS-609: request parameters, settable at every layer (provider, model, role or worker option).
 * A parameter nobody sets is never sent. `extraBody` is a JSON object written as a string and
 * `extraHeaders` a list of `Name: value` lines, because a runtime option cannot hold an object.
 */
export const ProviderParamsSchema = z.object({
  temperature: z.number().min(0).max(2).optional(),
  topP: z.number().min(0).max(1).optional(),
  frequencyPenalty: z.number().min(-2).max(2).optional(),
  presencePenalty: z.number().min(-2).max(2).optional(),
  maxOutputTokens: z.number().int().positive().optional(),
  seed: z.number().int().optional(),
  stop: z.array(z.string()).optional(),
  toolChoice: z.enum(['auto', 'required', 'none']).optional(),
  parallelToolCalls: z.boolean().optional(),
  responseFormat: z.enum(['text', 'json_object']).optional(),
  extraBody: z.string().optional(),
  extraHeaders: z.array(z.string()).optional(),
});
export type ProviderParams = z.infer<typeof ProviderParamsSchema>;

/** What one endpoint or model accepts and how it words things. Every field is optional: the codec fills the defaults. */
export const ProviderCompatSchema = z.object({
  maxTokensParam: z.enum(['max_completion_tokens', 'max_tokens']).optional(),
  streamUsage: z.enum(['stream_options', 'always', 'never']).optional(),
  systemRole: z.enum(['system', 'developer']).optional(),
  /** Wire body keys this endpoint rejects or ignores: never sent, even through `extraBody`. */
  omitParams: z.array(z.string()).optional(),
  reasoning: z.object({
    field: z.enum(['auto', 'reasoning_content', 'reasoning', 'reasoning_details', 'think_tags', 'none']).optional(),
    passBack: z.enum(['none', 'reasoning_content', 'all']).optional(),
    effortParam: z.enum(['reasoning_effort', 'reasoning.effort', 'none']).optional(),
    effortMap: z.record(z.string(), z.string()).optional(),
    effortLevels: z.array(z.string()).optional(),
  }).optional(),
  tools: z.object({
    supported: z.boolean().optional(),
    parallel: z.boolean().optional(),
    choice: z.array(z.enum(['auto', 'required', 'none', 'named'])).optional(),
    strict: z.boolean().optional(),
    idFormat: z.enum(['any', 'alnum9', 'safe64']).optional(),
  }).optional(),
  strictAlternation: z.boolean().optional(),
  emptyContent: z.enum(['null', 'empty']).optional(),
  /** How a model takes images: not at all, lifted into a user message (the default), or inside the tool message. */
  image: z.object({ input: z.enum(['none', 'user', 'user_and_tool']).optional() }).optional(),
  responseFormat: z.array(z.enum(['json_object', 'json_schema'])).optional(),
  seedParam: z.string().optional(),
  stopMax: z.number().int().positive().optional(),
  modelsPath: z.string().optional(),
  contextField: z.string().optional(),
  /** How the request helps the provider cache the prompt prefix: nothing, a `prompt_cache_key`, or Anthropic-style `cache_control` markers. */
  promptCache: z.enum(['none', 'key', 'anthropic']).optional(),
  /** Dotted path in `usage` to the cached prompt tokens; the standard `prompt_tokens_details.cached_tokens` and DeepSeek's `prompt_cache_hit_tokens` are always read too. */
  cachedTokensField: z.string().optional(),
});
export type ProviderCompat = z.infer<typeof ProviderCompatSchema>;

export const ProviderModelSchema = z.object({
  contextWindow: z.number().int().positive().optional(),
  maxOutputTokens: z.number().int().positive().optional(),
  compat: ProviderCompatSchema.optional(),
  params: ProviderParamsSchema.optional(),
});
export const ProviderProfileSchema = z.object({
  /** A built-in preset (`packages/agent/presets`) supplying base flags; omit for the generic OpenAI-compatible one. */
  preset: z.string().optional(),
  baseUrl: z.string().url(),
  apiKeySecret: z.string().regex(/^[A-Z][A-Z0-9_]*$/).optional(),
  auth: z.string().regex(/^(bearer|none|header:[A-Za-z0-9-]+)$/).default('bearer'),
  headers: z.record(z.string(), z.string()).default({}),
  /** Query parameters added to every request (Azure's `api-version`). */
  query: z.record(z.string(), z.string()).optional(),
  /** Ask `GET {baseUrl}{modelsPath}` for models (default true); the static `models` always apply. */
  discover: z.boolean().optional(),
  /** At most this many concurrent runs on this provider; further runs wait. */
  maxConcurrentRuns: z.number().int().positive().optional(),
  timeouts: z.object({ connectMs: z.number().int().positive().optional(), idleMs: z.number().int().positive().optional(), requestMs: z.number().int().positive().optional() }).optional(),
  compat: ProviderCompatSchema.optional(),
  params: ProviderParamsSchema.optional(),
  models: z.record(z.string(), ProviderModelSchema).default({}),
});
export type ProviderProfile = z.infer<typeof ProviderProfileSchema>;

/**
 * VS-621: an MCP server for the built-in `weave` runtime. A secret value is never here — a value in
 * `env` or `headers` may carry a `${SECRET_NAME}` reference resolved from the workspace secret store
 * when a run is built, so the config file, a backup of it, and every response stay value-free.
 * `readOnly` is the human's declaration that a stdio/HTTP server only reads (see the `restricted`
 * permission mode); MCP's own `readOnlyHint` annotation is advisory and not trusted for it.
 */
export const MCP_SERVER_RESERVED_NAME = 'weave-ai';
const MCP_SERVER_NAME = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const SECRET_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;

/** Every `${NAME}` in a value must name a valid workspace secret; a literal (no `${…}`) is allowed. */
export function validSecretRefs(value: string): boolean {
  const re = /\$\{([^}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(value)) !== null) if (!SECRET_NAME.test(m[1] ?? '')) return false;
  return true;
}

const secretRefValue = z.string().refine(validSecretRefs, 'every ${NAME} must name a workspace secret ([A-Za-z_][A-Za-z0-9_]*)');

export const McpServerSchema = z.object({
  /** `http` talks streamable HTTP; `stdio` spawns `command` with `args` and `env`. */
  type: z.enum(['http', 'stdio']),
  url: z.string().url().optional(),
  headers: z.record(z.string(), secretRefValue).default({}),
  command: z.string().min(1).optional(),
  args: z.array(z.string()).default([]),
  /** Environment variable name → its literal value or a `${SECRET_NAME}` reference. */
  env: z.record(z.string(), secretRefValue).default({}),
  listTimeoutMs: z.number().int().positive().default(30_000),
  callTimeoutMs: z.number().int().positive().default(60_000),
  readOnly: z.boolean().default(false),
}).strict().superRefine((s, ctx) => {
  if (s.type === 'stdio' && !s.command) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['command'], message: 'a stdio server needs a command' });
  if (s.type === 'http' && !s.url) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['url'], message: 'an http server needs a url' });
});
export type McpServer = z.infer<typeof McpServerSchema>;

export const McpServersSchema = z
  .record(z.string().regex(MCP_SERVER_NAME, 'kebab-case server name'), McpServerSchema)
  .refine((m) => !(MCP_SERVER_RESERVED_NAME in m), `"${MCP_SERVER_RESERVED_NAME}" is the run-scoped server's name and cannot be redefined`)
  .default({});

export const WorkspaceConfigSchema = withKeyAlias(z.object({
  version: z.literal(1),
  id: slug,
  name: z.string().min(1),
  ticketPrefix: z.string().regex(/^[A-Z][A-Z0-9]{1,9}$/),
  defaults: WorkspaceDefaultsSchema.default({}),
  /** Model selection, whole and entire: nothing else in this file names a runtime or a model. */
  models: WorkspaceModelsSchema.default({}),
  /** Model providers for the `weave` runtime, by provider id. */
  providers: z.record(z.string().regex(/^[a-z][a-z0-9-]*$/), ProviderProfileSchema).default({}),
  /** User-configured MCP servers for the built-in `weave` runtime (VS-621), by server name. */
  mcpServers: McpServersSchema,
  projects: z.array(ProjectConfigSchema).default([]),
  weaver: z.object({
    channels: z.array(z.string()).default(['web', 'cli']),
    heartbeatIntervalSec: z.number().int().optional(),
    humanName: z.string().optional(),
    /** VS-621: the MCP servers the weaver may use; the weaver has no role, so its allow list lives here. Default none. */
    mcpServers: z.array(z.string()).default([]),
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
  /** VS-579: this role's worker memory limit in MB, or `null` to inherit the workspace default. */
  memoryLimitMb: z.number().int().min(WORKER_MEMORY_MIN_MB).max(WORKER_MEMORY_MAX_MB).nullable().default(null),
  permission: z.object({ mode: z.enum(PERMISSION_MODES).default('auto'), allowed: z.array(z.string()).default([]), denied: z.array(z.string()).default([]), bashDeny: z.array(z.string()).default([]) }).default({}),
  secrets: z.array(z.string()).default([]),
  /** VS-621: the workspace MCP servers this role's `weave` runs may use. Default none. */
  mcpServers: z.array(z.string()).default([]),
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
