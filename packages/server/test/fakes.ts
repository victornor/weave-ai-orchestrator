/**
 * In-memory doubles for the app-level tests: a real sqlite db + EventBus (so SSE, channels and
 * push exercise real SQL) with hand-written service fakes in front of them.
 */
import { tmpdir } from 'node:os';
import { Db } from '@agent-conductor/db';
import { EventBus, createChangelogService, createHistoryReader, createJobsService, createKnowledgeUsageService, createModelsService, createPullRequestsService, createRegistries, getLogger, initLogger } from '@agent-conductor/core';
import type { Actor, CoreServices, HistoryQuery, WorkspaceContext } from '@agent-conductor/core';
import type { AuthService } from '@agent-conductor/core';
import {
  DaemonConfigSchema, OcError, WorkspaceConfigSchema,
  type AccountSyncFailure, type AccountSyncThrottle, type Briefing, type Decision, type Project, type RuntimeAccount, type RuntimeCredential, type Ticket, type TicketComment, type Wakeup,
} from '@agent-conductor/shared';
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
    title: 'Add dark mode', description: '', status: 'in_progress', priority: 'medium', autoMerge: false,
    assigneeRoleId: null, workerId: null, assigneeHuman: false, interactiveSession: false, parentId: null, createdByKind: 'human', createdById: null,
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
  /** Every `decisions.create` input verbatim, so a test can assert what `ac_ask` forwarded (VS-92). */
  decisionInputs: Array<Record<string, unknown>>;
  /** Registered secret names, by role, as `ac_role_set_secrets` set them. Never a value. */
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
  resolveRemote?: (source: string, ref: string) => string;
  /** Seams handed to the upgrade service; the defaults refuse to touch the host. */
  upgrade?: Partial<UpgradeDeps>;
  /** Runtime account snapshots served by `GET /usage/accounts`. */
  accounts?: RuntimeAccount[];
  /** Runtime credential state served by `GET /usage/credentials` (VS-75). */
  credentials?: RuntimeCredential[];
  /** Runtimes an on-demand sync reports as failed (VS-84). */
  syncFailed?: AccountSyncFailure[];
}

export function makeHarness(options: HarnessOptions = {}): Harness {
  const workspaceId = options.workspaceId ?? 'ws1';
  const calls: Call[] = [];
  /** Which runtimes this harness has already synced on demand, so a second sync is throttled. */
  const syncedRuntimes = new Set<string>();
  const db = new Db(':memory:');
  db.migrate();
  db.run('INSERT INTO workspaces (id, slug, name, ticket_prefix, status, root_path, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)',
    [workspaceId, workspaceId, 'Test workspace', 'ACME', 'active', '/tmp/ws', '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z']);
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
  /** Every `decisions.create` input verbatim, so a tool test can assert what ac_ask forwarded. */
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
    ?? ({ id, slug: id, name: id, gitUrl: '', defaultBranch: 'main', clonePath: tmpdir(), maxWorkers: 4, setupCommand: null, worktreeProvider: 'git', openspecEnabled: true, openspecVersion: null, policies: {}, status: 'ready', lastFetchedAt: null, errorText: null } as Project);
  // Real, like the changelog: read-only over this fake's real db and a real git clone a test points `clonePath` at.
  const historyReader = createHistoryReader(db);

  const services = {
    tickets: impl('tickets', {
      stop: async () => {},
      get: getTicket,
      list: () => ({ items: [...tickets.values()], total: tickets.size }),
      blockers: () => [], children: () => [], workProducts: () => [],
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
      documents: (id: string) => {
        const prefix = `${getTicket(id).id}\0`;
        return [...documents.entries()]
          .filter(([k]) => k.startsWith(prefix))
          .map(([k, revisions]) => ({ key: k.slice(prefix.length), revision: revisions.length, updatedAt: '2026-09-01T00:00:00.000Z' }));
      },
      create: (_actor: Actor, input: { title: string; kind: Ticket['kind']; projectId?: string | null }) => {
        const created = ticket({ id: `tk_${tickets.size + 1}`, identifier: `ACME-${43 + tickets.size}`, title: input.title, kind: input.kind, projectId: input.projectId ?? null, status: 'backlog' });
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
      create: (_actor: Actor, input: { title: string; kind: Decision['kind']; owner?: Decision['owner']; projectId?: string | null; inputs?: Decision['inputs'] }) => {
        decisionInputs.push(input);
        const d = decision({
          id: `dec_${decisions.size + 1}`, title: input.title, kind: input.kind, owner: input.owner ?? 'human',
          projectId: input.projectId ?? null, inputs: input.inputs ?? [],
        });
        decisions.set(d.id, d);
        bus.emit('decision.created', 'decision', d.id, d);
        return d;
      },
      answer: (_actor: Actor, id: string, answer: { key?: string; text?: string }) => {
        const d = { ...decisions.get(id)!, status: 'answered' as const, answerKey: answer.key ?? null, answerText: answer.text ?? null };
        decisions.set(id, d);
        return d;
      },
    }),
    wake: impl('wake', { listForAgent: () => [wakeup()] }),
    runs: impl('runs', { get: () => ({ wakeupIds: ['wk_1'] }), list: () => ({ items: [], total: 0 }), events: () => [], onEvent: () => () => undefined }),
    briefing: impl('briefing', { snapshot: (): Briefing => ({ needsYou: [], landed: [], underway: [], queued: [], warnings: [], generatedAt: '2026-09-01T00:00:00.000Z' }) }),
    workers: impl('workers', { list: () => [], conductor: () => ({ id: 'ag_conductor', kind: 'conductor' }) }),
    dispatcher: impl('dispatcher', { start: () => undefined, stop: async () => undefined, running: () => 0 }),
    supervisor: impl('supervisor', { start: () => undefined, stop: () => undefined, running: () => true }),
    projects: impl('projects', {
      list: () => [], get: getProject,
      history: (id: string, query?: HistoryQuery) => historyReader.history(getProject(id), query),
      commit: (id: string, sha: string) => historyReader.commit(getProject(id), sha),
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
    }),
  } as unknown as CoreServices;

  const ctx = {
    workspaceId,
    config: WorkspaceConfigSchema.parse({ version: 1, id: workspaceId, name: 'Test workspace', ticketPrefix: 'ACME' }),
    daemon: DaemonConfigSchema.parse({}),
    paths: { root: '/tmp/ws', state: '/tmp/ws/.agent-conductor', db: ':memory:', runs: '', conductor: '', roles: '', workers: '', archive: '', projects: '', knowledge: '', runtimesHome: '', wtConfig: '', secretsFile: '', secretsKey: '' },
    db, events: bus, registries: createRegistries(),
    log: (domain: Parameters<typeof getLogger>[0]) => getLogger(domain),
    loopbackUrl: 'http://127.0.0.1:0', skillsDir: '/tmp/skills', templatesDir: '/tmp/templates',
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
  // And knowledge usage (VS-110): a real read/write projection over this fake's own db, so a tool or
  // route test asserts on the rows it really wrote rather than on a hand-written double.
  (services as { knowledgeUsage: CoreServices['knowledgeUsage'] }).knowledgeUsage = createKnowledgeUsageService(ctx, () => services as unknown as CoreServices);

  const runtime: WorkspaceRuntime = { id: workspaceId, ctx, services, channels: null, webhooks: null };

  const tokens = new Map<string, { sessionId: string; operatorId: string; kind: 'web' | 'cli' | 'presenter' }>([
    ['sess-token', { sessionId: 'sess1', operatorId: 'op1', kind: 'cli' }],
  ]);
  const auth = unimplemented<AuthService>('auth', calls, {
    hasOperator: () => options.hasOperator ?? true,
    verify: (token: string) => tokens.get(token) ?? null,
    totpEnabled: () => false,
    sessions: () => [...tokens.values()].map((t) => ({ id: t.sessionId, kind: t.kind, deviceName: null, createdAt: '', lastSeenAt: '', expiresAt: '', ip: null, revokedAt: null })),
    logout: () => undefined,
  });

  const daemonCfg = DaemonConfigSchema.parse(options.daemon ?? {});
  const releaseRoot = options.releaseRoot ?? '/tmp/release/20260101-120000-aaaaaaaaaa';
  const updates = createUpdateChecker({
    daemon: daemonCfg, version: '0.1.0-test', releaseRoot,
    resolveRemote: options.resolveRemote ?? (() => 'f'.repeat(40)),
  });
  const workspaceMap = new Map([[workspaceId, runtime]]);
  const upgrades = createUpgradeService({
    db, daemon: daemonCfg, configDir: '/tmp/config', workspaces: workspaceMap, updates, version: '0.1.0-test', releaseRoot,
    // Nothing in an app-level test may clone, build, back up or restart anything.
    build: () => { throw new Error('build is not stubbed in this test'); },
    backup: () => [], switchTo: () => ({ previous: null }), prune: () => [], spawnRunner: () => undefined,
    ...options.upgrade,
  });
  const deps: AppDeps = {
    auth, daemon: daemonCfg, workspaces: workspaceMap,
    registries: createRegistries(), listener: options.listener ?? 'public',
    publicUrl: 'http://127.0.0.1:7433', version: '0.1.0-test', uiDir: null,
    updates, upgrades,
  };

  return { runtime, deps, db, bus, calls, tickets, mergeOutcomes, comments, documents, tokens, impls, decisionInputs, roleSecrets, close: async () => { await runtime.services.jobs.stop(); db.close(); } };
}

export const authed = (extra: Record<string, string> = {}): Record<string, string> => ({ authorization: 'Bearer sess-token', ...extra });
