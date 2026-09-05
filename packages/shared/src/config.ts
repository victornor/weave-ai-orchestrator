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
  runtime: z.string().optional(),
  model: z.string().nullable().optional(),
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

export const WorkspaceDefaultsSchema = z.object({
  runtime: z.string().default('claude'),
  model: z.string().nullable().default(null),
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
  bootstrapBudgetTokens: z.number().int().default(16000),
  knowledgeBudgetTokens: KnowledgeBudgetsSchema.default({}),
  workerArchiveDays: z.number().int().default(30),
  runLogRetentionDays: z.number().int().default(30),
  permissionMode: z.enum(PERMISSION_MODES).default('auto'),
});

export const WorkspaceConfigSchema = z.object({
  version: z.literal(1),
  id: slug,
  name: z.string().min(1),
  ticketPrefix: z.string().regex(/^[A-Z][A-Z0-9]{1,9}$/),
  defaults: WorkspaceDefaultsSchema.default({}),
  projects: z.array(ProjectConfigSchema).default([]),
  conductor: z.object({
    runtime: z.string().default('claude'),
    model: z.string().nullable().default(null),
    effort: z.string().optional(),
    channels: z.array(z.string()).default(['web', 'cli']),
    heartbeatIntervalSec: z.number().int().optional(),
    humanName: z.string().optional(),
  }).default({}),
  presentation: z.object({
    default: z.string().default('headless'),
    conductor: PresentationBlockSchema.optional(),
    workers: PresentationBlockSchema.optional(),
  }).default({}),
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
  runtime: z.string(),
  model: z.string().nullable().default(null),
  effort: z.string().optional(),
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
  transcription: z.object({ provider: z.enum(['none', 'command']).default('none'), command: z.string().optional() }).default({}),
  /** `conductor daemon upgrade`: where releases are built from and how many to keep (PLAN §20). */
  upgrade: z.object({
    /** Git URL or local path the release is cloned from. Required for `upgrade` unless `--from` is passed. */
    source: z.string().optional(),
    ref: z.string().default('main'),
    /** Releases older than the newest `keep` (never `current`/`previous`) are deleted after a switch. */
    keep: z.number().int().min(1).default(3),
    /** Seconds to wait for running turns before restarting anyway. An agent turn can take many minutes. */
    drainTimeoutSec: z.number().int().min(0).default(900),
    /**
     * A deferred upgrade holds dispatch and waits for every running turn to finish. Bounded, because one
     * wedged run would otherwise hold every workspace's dispatch silently and forever; on expiry the
     * upgrade fails and dispatch resumes.
     */
    waitForIdleSec: z.number().int().min(0).default(3600),
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
