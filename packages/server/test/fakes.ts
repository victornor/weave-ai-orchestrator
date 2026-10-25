/**
 * In-memory doubles for the app-level tests: a real sqlite db + EventBus (so SSE, channels and
 * push exercise real SQL) with hand-written service fakes in front of them.
 */
import { tmpdir } from 'node:os';
import { Db } from '@weave-ai/db';
import { EventBus, createChangelogService, createHistoryReader, createIncidentsService, createJobsService, createKnowledgeUsageService, createModelsService, createPromotionService, createPullRequestsService, createRegistries, createRoadmapService, createPlanningService, createRoutinesService, createPluginRegistry, getLogger, initLogger } from '@weave-ai/core';
import type { Actor, CoreServices, HistoryQuery, WorkspaceContext } from '@weave-ai/core';
import type { AuthService } from '@weave-ai/core';
import {
  DaemonConfigSchema, OcError, WorkspaceConfigSchema,
  type AccountSyncFailure, type AccountSyncThrottle, type Briefing, type Decision, type DecisionAnswerInputs, type Project, type RuntimeAccount, type RuntimeCredential, type Ticket, type TicketComment, type Wakeup,
} from '@weave-ai/shared';
import type { AppDeps, WorkspaceRuntime } from '../src/types.js';
import { createUpdateChecker } from '../src/release-info.js';
import { createUpgradeService, type UpgradeDeps } from '../src/upgrade.js';

initLogger(process.env.AC_LOG_LEVEL ?? 'silent');

export interface Call { service: string; method: string; args: unknown[] }

/** Any service method that a test has not stubbed fails loudly instead of returning undefined. */
function unimplemented<T extends object>(service: string, calls: Call[], impl: Partial<T> = {}): T {
  return new Proxy({} as T, {
    get(_t, prop: string | symbol) {
      if (typeof prop !== 'string') return undefined;
      if (prop in impl) {
        const fn = (impl as Record<string, unknown>)[prop];
        if (typeof fn !== 'function') return fn;
        return (...args: unknown[]) => { calls.push({ service, method: prop, args }); return (fn as (...a: unknown[]) => unknown)(...args); };
      }
      return (...args: unknown[]) => { calls.push({ service, method: prop, args }); throw new OcError('internal', `${service}.${prop} is not stubbed in this test`); };
    },
  });
}

export function ticket(over: Partial<Ticket> = {}): Ticket {
  return {
    id: 'tk_1', workspaceId: 'ws1', projectId: 'proj1', number: 42, identifier: 'ACME-42', kind: 'change',
    title: 'Add dark mode', description: '', summary: null, status: 'in_progress', priority: 'medium', autoMerge: false,
    assigneeRoleId: null, workerId: null, assigneeHuman: false, interactiveSession: false, landingBranch: null, workerModelId: null, parentId: null, createdByKind: 'human', createdById: null,
    originKind: null, originFingerprint: null, checkoutRunId: null, executionRunId: null, openspecChangeName: null,
    openspecState: null, delivery: null, unblock: null, blockedFromStatus: null, monitorNextCheckAt: null, blockedTransitionAt: null,
    mergeQueuedAt: null, mergeStartedAt: null,
    startedAt: null, completedAt: null, cancelledAt: null, createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z',
    ...over,
  };
}

/** One entry of a merge-queue view, shaped like core's MergeQueueEntry. */
function queueEntry(t: Ticket, position: number | null): Record<string, unknown> {
  return { ticketId: t.id, identifier: t.identifier, title: t.title, projectId: t.projectId, position, queuedAt: t.mergeQueuedAt, startedAt: t.mergeStartedAt, workerId: t.workerId };
}

export function decision(over: Partial<Decision> = {}): Decision {
  return {
    id: 'dec_1', workspaceId: 'ws1', ticketId: 'tk_1', projectId: 'pr_1', kind: 'question', owner: 'human', askedByAgentId: null, askedInRunId: null,
    title: 'CSS variables or Tailwind?', context: 'Dark mode needs a token strategy.', options: [{ key: 'vars', label: 'CSS variables', recommended: true }, { key: 'tw', label: 'Tailwind' }],
    inputs: [], allowFreeText: true, recommendation: 'CSS variables', status: 'open', answerKey: null, answerText: null, answerInputs: null, answeredByKind: null,
    answeredById: null, answeredAt: null, expiresAt: null, target: null, correlationKey: null, createdAt: '2026-09-01T00:00:00.000Z',
    weaverReviewStatus: 'unseen', weaverReviewedAt: null, weaverReviewNote: null, weaverReviewedByAgentId: null, weaverReviewedHeadSha: null, weaverReviewWaitingOn: null,
    answerAuthorKind: null, relayedFromMessageId: null,
    ...over,
  };
}

export function wakeup(over: Partial<Wakeup> = {}): Wakeup {
  return {
    id: 'wk_1', workspaceId: 'ws1', agentId: 'ag_1', source: 'human_message', reason: 'Add dark mode', payload: { threadId: 'th_1' },
    idempotencyKey: null, status: 'claimed', coalescedIntoId: null, skipReason: null, runId: 'run_1', requestedByKind: 'human',
    requestedById: null, notBefore: null, createdAt: '2026-09-01T00:00:00.000Z', claimedAt: null, finishedAt: null,
    ...over,
  };
}

export interface Harness {
  runtime: WorkspaceRuntime;
  deps: AppDeps;
  db: Db;
  bus: EventBus;
  calls: Call[];
  tickets: Map<string, Ticket>;
  comments: TicketComment[];
  /** Ticket documents keyed `<ticketId>\0<key>`; the value is every revision, oldest first. */
  documents: Map<string, string[]>;
  tokens: Map<string, { sessionId: string; operatorId: string; kind: 'web' | 'cli' | 'presenter' }>;
  /** Live method tables behind the service proxies: mutate to stub a method mid-test. */
  impls: Record<string, Record<string, unknown>>;
  /** Every `decisions.create` input verbatim, so a test can assert what `weave_ask` forwarded (VS-92). */
  decisionInputs: Array<Record<string, unknown>>;
  /** Registered secret names, by role, as `weave_role_set_secrets` set them. Never a value. */
  roleSecrets: Map<string, string[]>;
  /** Drains the real jobs service before closing the db: a pending log flush must not fire against it. */
  close(): Promise<void>;
}

export interface HarnessOptions {
  listener?: 'public' | 'loopback';
  workspaceId?: string;
  hasOperator?: boolean;
  /** Merged into `DaemonConfigSchema` for `deps.daemon`. */
  daemon?: Record<string, unknown>;
  /** The release directory the fake daemon reports running from. */
  releaseRoot?: string;
  /** Injected running version (defaults to the old test placeholder). */
  version?: string;
  resolveRemote?: (source: string, ref: string) => string;
  /** Seams handed to the upgrade service; the defaults refuse to touch the host. */
  upgrade?: Partial<UpgradeDeps>;
  /** Runtime account snapshots served by `GET /usage/accounts`. */
  accounts?: RuntimeAccount[];
  /** Runtime credential state served by `GET /usage/credentials` (VS-75). */
  credentials?: RuntimeCredential[];
  /** Injected Voxtype probe so tests never spawn the host binary. */
  voxtype?: import('../src/voxtype.js').VoxtypeProbe;
  /** Where PUT /api/daemon/transcription writes daemon.yaml. */
  daemonConfigDir?: string;
  /** Runtimes an on-demand sync reports as failed (VS-84). */
  syncFailed?: AccountSyncFailure[];
}

export function makeHarness(options: HarnessOptions = {}): Harness {
  const workspaceId = options.workspaceId ?? 'ws1';
  const daemonCfg = DaemonConfigSchema.parse(options.daemon ?? {});
  const calls: Call[] = [];
  /** Which runtimes this harness has already synced on demand, so a second sync is throttled. */
  const syncedRuntimes = new Set<string>();
  const db = new Db(':memory:');
  db.migrate();
  db.run('INSERT INTO workspaces (id, slug, name, ticket_prefix, status, root_path, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)',
    [workspaceId, workspaceId, 'Test workspace', 'ACME', 'active', '/tmp/ws', '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z']);
  db.insert('agents', {
    id: 'ag_conductor', workspaceId, kind: 'weaver', name: 'Weaver', runtimeId: 'claude', status: 'active',
    homePath: '/tmp/c', turnEpoch: 0, turnCount: 0, spawnedBy: 'system', briefRevision: 1,
    createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z',
  });
  const bus = new EventBus(db, workspaceId);

  const tickets = new Map<string, Ticket>([['tk_1', ticket()]]);
  /** What the merge queue reports as having recently left it; a test pushes what it wants to see. */
  const mergeOutcomes: Array<Record<string, unknown>> = [];
  const comments: TicketComment[] = [];
  /** `<ticketId>\0<key>` → the revisions written so far, oldest first. */
  const documents = new Map<string, string[]>();
  const decisions = new Map<string, Decision>([['dec_1', decision()]]);
  /** Registered secret names, never real values: this fake exists so a test can prove a name was recorded and a value was not. */
  const secretValues = new Map<string, string>();
  /** Every `decisions.create` input verbatim, so a tool test can assert what weave_ask forwarded. */
  const decisionInputs: Array<Record<string, unknown>> = [];
  const roleSecrets = new Map<string, string[]>();

  const getTicket = (id: string): Ticket => {
    const found = [...tickets.values()].find((t) => t.id === id || t.identifier === id);
    if (!found) throw new OcError('not_found', `ticket ${id} not found`);
    return found;
  };

  const impls: Record<string, Record<string, unknown>> = {};
  const impl = <T extends object>(name: string, methods: Partial<T>): T => { impls[name] = methods as Record<string, unknown>; return unimplemented<T>(name, calls, methods); };

  /** A row a test inserted with `h.db.run("INSERT INTO projects ...")`, else the same stub `projects.get` always returned. */
  const getProject = (id: string): Project =>
    db.get<Project>('SELECT * FROM projects WHERE id = ? OR slug = ?', [id, id])
    ?? ({ id, slug: id, name: id, gitUrl: '', defaultBranch: 'main', landingBranch: null, clonePath: tmpdir(), maxWorkers: 4, setupCommand: null, worktreeProvider: 'git', openspecEnabled: true, openspecVersion: null, policies: {}, status: 'ready', syncState: 'in_sync', lastFetchedAt: null, errorText: null } as Project);
  // Real, like the changelog: read-only over this fake's real db and a real git clone a test points `clonePath` at.
  const historyReader = createHistoryReader(db);

  const services = {
    tickets: impl('tickets', {
      stop: async () => {},
      get: getTicket,
      list: () => ({ items: [...tickets.values()], total: tickets.size }),
      blockers: () => [], children: () => [], workProducts: () => [], attachments: () => [], attachment: () => { throw new OcError('not_found', 'attachment not found'); }, artifacts: () => [],
      mergeQueue: {
        positionOf: (id: string) => (getTicket(id).status === 'merging' && !getTicket(id).mergeStartedAt ? 1 : null),
        limitFor: () => 1,
        recentOf: () => mergeOutcomes,
        forProject: (projectId: string) => ({
          projectId, concurrency: 1,
          active: [...tickets.values()].filter((t) => t.status === 'merging' && t.mergeStartedAt).map((t) => queueEntry(t, null)),
          waiting: [...tickets.values()].filter((t) => t.status === 'merging' && !t.mergeStartedAt).map((t, i) => queueEntry(t, i + 1)),
          recent: mergeOutcomes,
        }),
      },
      comments: () => comments,
      lastWorker: () => null,
      putDocument: (_actor: Actor, id: string, key: string, body: string) => {
        const docKey = `${getTicket(id).id}\0${key}`;
        const revisions = documents.get(docKey) ?? [];
        revisions.push(body);
        documents.set(docKey, revisions);
        return { documentId: docKey, revision: revisions.length };
      },
      getDocument: (id: string, key: string, revision?: number) => {
        const docKey = `${getTicket(id).id}\0${key}`;
        const revisions = documents.get(docKey);
        if (!revisions?.length) return null;
        const rev = revision ?? revisions.length;
        const body = revisions[rev - 1];
        if (body === undefined) return null;
        return { documentId: docKey, revision: rev, body, createdAt: '2026-09-01T00:00:00.000Z' };
      },
      // Same ownership rule as the real one: the id must name a document that belongs to this ticket.
      getDocumentById: (id: string, documentId: string, revision?: number) => {
        const entry = [...documents.entries()].find(([k]) => k === documentId);
        if (!entry || entry[0].split('\0')[0] !== getTicket(id).id || entry[1].length === 0) return null;
        const [docKey, revisions] = entry;
        const rev = revision ?? revisions.length;
        const body = revisions[rev - 1];
        if (body === undefined) return null;
        return { key: docKey.split('\0')[1]!, documentId: docKey, revision: rev, currentRevision: revisions.length, body, createdAt: '2026-09-01T00:00:00.000Z' };
      },
      documents: (id: string) => {
        const prefix = `${getTicket(id).id}\0`;
        return [...documents.entries()]
          .filter(([k]) => k.startsWith(prefix))
          .map(([k, revisions]) => ({ key: k.slice(prefix.length), revision: revisions.length, updatedAt: '2026-09-01T00:00:00.000Z' }));
      },
      create: (_actor: Actor, input: { title: string; kind: Ticket['kind']; projectId?: string | null; workerModelId?: string | null }) => {
        const created = ticket({ id: `tk_${tickets.size + 1}`, identifier: `ACME-${43 + tickets.size}`, title: input.title, kind: input.kind, projectId: input.projectId ?? null, workerModelId: input.workerModelId ?? null, status: 'backlog' });
        tickets.set(created.id, created);
        bus.emit('ticket.created', 'ticket', created.id, created);
        return created;
      },
      comment: (actor: Actor, id: string, body: string, kind = 'comment') => {
        const c: TicketComment = { id: `c_${comments.length + 1}`, ticketId: getTicket(id).id, authorKind: actor.kind, authorId: actor.id, runId: actor.runId ?? null, body, kind: kind as TicketComment['kind'], sourceTrust: 'agent', createdAt: new Date().toISOString() };
        comments.push(c);
        bus.emit('ticket.comment', 'ticket', c.ticketId, c);
        return c;
      },
      transition: (_actor: Actor, id: string, input: { to: Ticket['status'] }) => {
        const next = { ...getTicket(id), status: input.to };
        tickets.set(next.id, next);
        return next;
      },
    }),
    decisions: impl('decisions', {
      get: (id: string) => { const d = decisions.get(id); if (!d) throw new OcError('not_found', `decision ${id} not found`); return d; },
      list: () => [...decisions.values()],
      create: (_actor: Actor, input: { title: string; kind: Decision['kind']; owner?: Decision['owner']; projectId?: string | null; inputs?: Decision['inputs']; askedByAgentId?: string | null }) => {
        decisionInputs.push(input);
        const d = decision({
          id: `dec_${decisions.size + 1}`, title: input.title, kind: input.kind, owner: input.owner ?? 'human',
          projectId: input.projectId ?? null, inputs: input.inputs ?? [], askedByAgentId: input.askedByAgentId ?? null,
        });
        decisions.set(d.id, d);
        bus.emit('decision.created', 'decision', d.id, d);
        return d;
      },
      answer: (_actor: Actor, id: string, answer: { key?: string; text?: string; inputs?: DecisionAnswerInputs }) => {
        const current = decisions.get(id)!;
        const d = { ...current, status: 'answered' as const, answerKey: answer.key ?? null, answerText: answer.text ?? null, answerInputs: answer.inputs ?? null };
        decisions.set(id, d);
        if (current.askedByAgentId) {
          calls.push({ service: 'wake', method: 'enqueue', args: [current.askedByAgentId, { source: 'decision_answered', payload: { decisionId: id, answer: { key: answer.key, text: answer.text }, ...(answer.inputs ? { answerInputs: answer.inputs } : {}) } }] });
        }
        return d;
      },
      review: (_actor: Actor, id: string, input: { status: 'looked' | 'concerns'; note?: string; reviewedHead?: string | null; waitingOn?: string | null }) => {
        const cur = decisions.get(id);
        if (!cur) throw new OcError('not_found', `decision ${id} not found`);
        const d = {
          ...cur,
          weaverReviewStatus: input.status,
          weaverReviewedAt: new Date().toISOString(),
          // VS-234: both marks carry the note (the tool schema enforces its presence).
          weaverReviewNote: (input.note ?? '').trim() || null,
          weaverReviewedByAgentId: _actor.id,
          // VS-365: the head the review was made against, when the caller resolved one.
          weaverReviewedHeadSha: input.reviewedHead ?? null,
          // VS-481: an optional waiting statement; a later mark with none clears it.
          weaverReviewWaitingOn: (input.waitingOn ?? '').trim() || null,
        };
        decisions.set(id, d);
        return d;
      },
    }),
    wake: impl('wake', { listForAgent: () => [wakeup()], enqueue: (agentId: string, input: Record<string, unknown>) => wakeup({ agentId, ...input }) }),
    runs: impl('runs', { get: () => ({ wakeupIds: ['wk_1'] }), list: () => ({ items: [], total: 0 }), events: () => [], onEvent: () => () => undefined }),
    briefing: impl('briefing', { snapshot: (): Briefing => ({ needsYou: [], landed: [], underway: [], queued: [], warnings: [], generatedAt: '2026-09-01T00:00:00.000Z' }) }),
    workers: impl('workers', { list: () => [], conductor: () => ({ id: 'ag_conductor', kind: 'weaver' }), retirePlanner: async () => {}, startOrResumePlan: async () => { throw new Error('startOrResumePlan not stubbed for this test'); } }),
    dispatcher: impl('dispatcher', { start: () => undefined, stop: async () => true, running: () => 0, beginShutdown: () => undefined }),
    supervisor: impl('supervisor', { start: () => undefined, stop: () => undefined, running: () => true }),
    projects: impl('projects', {
      list: () => [], get: getProject,
      history: (id: string, query?: HistoryQuery) => historyReader.history(getProject(id), query),
      commit: (id: string, sha: string) => historyReader.commit(getProject(id), sha),
      checkSync: async () => ({ syncState: 'in_sync' as const, behindBy: null }),
      fetch: async () => ({ head: 'deadbeef', fastForwarded: false }),
      repoInfo: async () => null,
      repoInfoForUrl: async () => null,
      applyKnowledgeRepoSwitch: async () => {},
    }),
    roles: impl('roles', {
      list: () => [],
      setSecrets: async (_actor: Actor, id: string, names: string[]) => {
        const missing = names.filter((n) => !secretValues.has(n));
        if (missing.length) throw new OcError('not_found', `no secret registered under ${missing.map((n) => `"${n}"`).join(', ')}`);
        roleSecrets.set(id, names);
        return { id, secrets: names };
      },
    }),
    knowledge: impl('knowledge', {
      lint: () => [],
      health: (projectId?: string | null) => ({
        hubs: [{ path: projectId ? `projects/${projectId}/PROJECT.md` : 'workspace/WORKSPACE.md', scope: projectId ? 'project' : 'workspace', projectId: projectId ?? null, projectSlug: null, tokenEstimate: 0, budgetTokens: 10000, pct: 0, nearBudget: false, curationPending: false, lastCuratedAt: null }],
        orphans: [], stale: [], unresolvedLinks: [],
      }),
    }),
    specs: impl('specs', {}),
    openspec: impl('openspec', { statusFor: async () => null }),
    usage: impl('usage', {}),
    accounts: impl('accounts', {
      list: () => options.accounts ?? [], get: () => null, refresh: async () => [],
      // A stand-in for the real rate limit (VS-84), which lives in the core service and is tested
      // there: the first sync of a runtime probes, every later one in this process is throttled.
      sync: async (runtimeIds?: string[]) => {
        const ids = runtimeIds ?? (options.accounts ?? []).map((a) => a.runtimeId);
        const synced: string[] = [];
        const throttled: AccountSyncThrottle[] = [];
        for (const runtimeId of ids) {
          if (syncedRuntimes.has(runtimeId)) throttled.push({ runtimeId, nextSyncAt: '2026-09-07T10:00:30.000Z', retryAfterMs: 30_000 });
          else { syncedRuntimes.add(runtimeId); synced.push(runtimeId); }
        }
        return { accounts: (options.accounts ?? []).filter((a) => ids.includes(a.runtimeId)), synced, throttled, failed: options.syncFailed ?? [] };
      },
      credentials: () => options.credentials ?? [],
      credential: (runtimeId: string) => (options.credentials ?? []).find((c) => c.runtimeId === runtimeId)
        ?? { workspaceId: 'ws1', runtimeId, present: false, expiresAt: null, lastVerifiedAt: null, refreshFailedAt: null, needsLogin: false, detail: null, updatedAt: '2026-09-07T09:00:00.000Z' },
      gatedRuntimes: () => (options.credentials ?? []).filter((c) => c.needsLogin).map((c) => c.runtimeId),
      noteAuthFailure: (runtimeId: string) => ({ workspaceId: 'ws1', runtimeId, present: true, expiresAt: null, lastVerifiedAt: null, refreshFailedAt: '2026-09-07T09:07:00.000Z', needsLogin: true, detail: null, updatedAt: '2026-09-07T09:07:00.000Z' }),
      loginChangedSinceFailure: () => true,
      noteVerified: (runtimeId: string) => ({ workspaceId: 'ws1', runtimeId, present: true, expiresAt: null, lastVerifiedAt: '2026-09-07T10:00:00.000Z', refreshFailedAt: null, needsLogin: false, detail: null, updatedAt: '2026-09-07T10:00:00.000Z' }),
    }),
    threads: impl('threads', { list: () => [], primaryThread: () => null }),
    // A double, not the real store: no route or tool returns a secret value, so a route test never
    // needs one on disk — it needs to know a name was registered and that nothing leaked it.
    secrets: impl('secrets', {
      put: (_actor: Actor, i: { name: string; envVarName?: string }) => {
        secretValues.set(i.name, 'held');
        return { name: i.name, envVarName: i.envVarName ?? i.name, scope: 'workspace', scopeId: null, hasValue: true };
      },
      list: () => [...secretValues.keys()].map((name) => ({ name, envVarName: name, scope: 'workspace' as const, scopeId: null, hasValue: true })),
      has: (name: string) => secretValues.has(name),
      value: (name: string) => secretValues.get(name) ?? null,
      clear: (_actor: Actor, name: string) => { secretValues.delete(name); },
    }),
    // VS-328: the workers route reads the live activity summary; a test stubs it when it cares.
    activity: impl('activity', { summaryFor: () => null }),
  } as unknown as CoreServices;

  const ctx = {
    workspaceId,
    config: WorkspaceConfigSchema.parse({ version: 1, id: workspaceId, name: 'Test workspace', ticketPrefix: 'ACME' }),
    daemon: daemonCfg,
    // VS-258: a hand-built double, never routed through workspacePaths()/resolveWorkspaceStateDir() —
    // this literal does not track (and does not need to track) which name a real workspace resolves to.
    paths: { root: '/tmp/ws', state: '/tmp/ws/.agent-conductor', db: ':memory:', runs: '', conductor: '', roles: '', workers: '', archive: '', projects: '', knowledge: '', runtimesHome: '', wtConfig: '', secretsFile: '', secretsKey: '' },
    db, events: bus, registries: createRegistries(), plugins: createPluginRegistry(),
    log: (domain: Parameters<typeof getLogger>[0]) => getLogger(domain),
    loopbackUrl: 'http://127.0.0.1:0', skillsDir: '/tmp/skills', templatesDir: '/tmp/templates',
    isolated: false, daemonConfigDir: options.daemonConfigDir ?? '/tmp/daemon-config',
    saveConfig: async () => undefined,
  } as unknown as WorkspaceContext;

  // Jobs is real: the route tests exercise the record, its bounded tail and the replay-then-tail stream.
  (services as { jobs: CoreServices['jobs'] }).jobs = createJobsService(ctx, () => services);
  // So is the changelog: it is a read-only projection over this fake's real db, so a route test can
  // insert activity rows and assert on what the route serves rather than on a hand-written double.
  (services as { changelog: CoreServices['changelog'] }).changelog = createChangelogService(ctx, () => services);
  // And so are the model settings: `GET`/`PUT /models` is the whole of model selection, so a route
  // test asserts on what the service really stores rather than on a double (VS-77).
  (services as { models: CoreServices['models'] }).models = createModelsService(ctx, () => services);
  // And the pull requests (VS-97): a read-only join over this fake's own db and forge registry, so a
  // route test registers a fake forge to get a list and registers none to get the no-forge answer.
  (services as { pullRequests: CoreServices['pullRequests'] }).pullRequests = createPullRequestsService(ctx, () => services as unknown as CoreServices);
  (services as { promotion: CoreServices['promotion'] }).promotion = createPromotionService(ctx, () => services as unknown as CoreServices);
  // And knowledge usage (VS-110): a real read/write projection over this fake's own db, so a tool or
  // route test asserts on the rows it really wrote rather than on a hand-written double.
  (services as { knowledgeUsage: CoreServices['knowledgeUsage'] }).knowledgeUsage = createKnowledgeUsageService(ctx, () => services as unknown as CoreServices);
  (services as { routines: CoreServices['routines'] }).routines = createRoutinesService(ctx, () => services as unknown as CoreServices);
  // And the roadmap (VS-397): real over this fake's own db and its real projects/tickets doubles, so a
  // route test asserts on the rows it really wrote.
  (services as { roadmap: CoreServices['roadmap'] }).roadmap = createRoadmapService(ctx, () => services as unknown as CoreServices);
  // And planning (VS-398): real over this fake's own db, so a tool test asserts on the plan/draft
  // rows it really wrote rather than on a hand-written double.
  (services as { planning: CoreServices['planning'] }).planning = createPlanningService(ctx, () => services as unknown as CoreServices);

  const runtime: WorkspaceRuntime = { id: workspaceId, ctx, services, channels: null, webhooks: null, push: null };

  const expiresAt = new Date(Date.now() + 30 * 86_400_000).toISOString();
  const tokens = new Map<string, { sessionId: string; operatorId: string; kind: 'web' | 'cli' | 'presenter'; expiresAt: string }>([
    ['sess-token', { sessionId: 'sess1', operatorId: 'op1', kind: 'cli', expiresAt }],
    ['web-token', { sessionId: 'sess2', operatorId: 'op1', kind: 'web', expiresAt }],
  ]);
  const auth = unimplemented<AuthService>('auth', calls, {
    hasOperator: () => options.hasOperator ?? true,
    setPassword: async () => undefined,
    verify: (token: string) => tokens.get(token) ?? null,
    totpEnabled: () => false,
    sessions: () => [...tokens.values()].map((t) => ({ id: t.sessionId, kind: t.kind, deviceName: null, createdAt: '', lastSeenAt: '', expiresAt: '', ip: null, revokedAt: null })),
    logout: () => undefined,
  });

  const releaseRoot = options.releaseRoot ?? '/tmp/release/20260101-120000-aaaaaaaaaa';
  const version = options.version ?? '0.1.0-test';
  const updates = createUpdateChecker({
    daemon: daemonCfg, version, releaseRoot,
    resolveRemote: options.resolveRemote ?? (() => 'f'.repeat(40)),
  });
  const workspaceMap = new Map([[workspaceId, runtime]]);
  const upgrades = createUpgradeService({
    db, daemon: daemonCfg, configDir: '/tmp/config', workspaces: workspaceMap, updates, version, releaseRoot,
    // Nothing in an app-level test may clone, build, back up or restart anything.
    build: () => { throw new Error('build is not stubbed in this test'); },
    backup: () => [], switchTo: () => ({ previous: null }), prune: () => [], spawnRunner: () => undefined,
    ...options.upgrade,
  });
  const deps: AppDeps = {
    auth, daemon: daemonCfg, workspaces: workspaceMap,
    registries: createRegistries(), listener: options.listener ?? 'public',
    publicUrl: 'http://127.0.0.1:7433', version, uiDir: null,
    updates, upgrades, incidents: createIncidentsService(db),
    voxtype: options.voxtype, daemonConfigDir: options.daemonConfigDir,
    resolveReleaseRef: options.resolveRemote,
  };

  return { runtime, deps, db, bus, calls, tickets, mergeOutcomes, comments, documents, tokens, impls, decisionInputs, roleSecrets, close: async () => { await runtime.services.jobs.stop(); db.close(); } };
}

export const authed = (extra: Record<string, string> = {}): Record<string, string> => ({ authorization: 'Bearer sess-token', ...extra });
