/**
 * Test-only harness: a temp workspace directory, a migrated sqlite db, a WorkspaceContext and a
 * partial CoreServices bag whose unset members throw when touched. Not exported from the package index.
 */
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, newId, nowIso, type Db } from '@agent-conductor/db';
import { DaemonConfigSchema, WorkspaceConfigSchema, type WorkspaceConfig, type WorkspaceEvent } from '@agent-conductor/shared';
import { EventBus } from '../events.js';
import { createRegistries, workspacePaths, type WorkspaceContext } from '../context.js';
import { getLogger } from '../logger.js';
import type { CoreServices } from '../api.js';
import { createChangelogService } from '../changelog/index.js';
import { createModelsService } from '../models/index.js';
import { createSecretsService } from '../secrets/index.js';
import { createPullRequestsService } from '../pull-requests/index.js';

export interface TestHarness {
  ctx: WorkspaceContext;
  db: Db;
  root: string;
  workspaceId: string;
  projectId: string;
  projectSlug: string;
  roleId: string;
  conductorId: string;
  /** Fill in the services a module under test depends on; anything missing throws on access. */
  services: Partial<CoreServices>;
  deps: () => CoreServices;
  events: WorkspaceEvent[];
  addWorker(ticketId: string | null, over?: Record<string, unknown>): string;
  cleanup(): void;
}

export interface HarnessOptions {
  config?: Partial<WorkspaceConfig>;
  /** Skip creating a project + role (workspace-only tests). */
  bare?: boolean;
  /** VS-143: build the harness as an isolated daemon would see it. Default false. */
  isolated?: boolean;
}

export function makeHarness(opts: HarnessOptions = {}): TestHarness {
  const root = mkdtempSync(join(tmpdir(), 'ac-test-'));
  const paths = workspacePaths(root);
  for (const d of [paths.state, paths.knowledge, paths.weaver, paths.roles, paths.workers, paths.projects]) mkdirSync(d, { recursive: true });

  const config = WorkspaceConfigSchema.parse({
    version: 1,
    id: 'test',
    name: 'Test Workspace',
    ticketPrefix: 'TST',
    ...opts.config,
  });
  const daemon = DaemonConfigSchema.parse({});
  const db = openDb(join(paths.state, 'db.sqlite'));

  const workspaceId = newId();
  const now = nowIso();
  db.insert('workspaces', { id: workspaceId, slug: config.id, name: config.name, ticketPrefix: config.ticketPrefix, ticketCounter: 0, status: 'active', rootPath: root, settingsJson: {}, createdAt: now, updatedAt: now });

  let projectId = '';
  let projectSlug = 'api';
  let roleId = '';
  if (!opts.bare) {
    projectId = newId();
    db.insert('projects', {
      id: projectId, workspaceId, slug: projectSlug, name: 'API', gitUrl: 'git@example.com:acme/api.git', defaultBranch: 'main',
      clonePath: join(paths.projects, projectSlug), maxWorkers: 4, worktreeProvider: 'git',
      openspecEnabled: 1, policiesJson: {}, status: 'ready', createdAt: now, updatedAt: now,
    });
    roleId = newId();
    db.insert('roles', {
      id: roleId, workspaceId, projectId, slug: 'backend', name: 'Backend Engineer', charterSummary: 'Owns the api service.',
      scopeText: 'Backend work in the api repo.', sessionPolicy: 'per_ticket', maxWorkers: 2,
      status: 'active', specRevision: 1, createdBy: 'weaver', createdAt: now, updatedAt: now,
    });
  }

  const conductorId = newId();
  db.insert('agents', {
    id: conductorId, workspaceId, kind: 'weaver', name: 'Weaver', runtimeId: 'claude', status: 'active',
    homePath: paths.weaver, turnEpoch: 0, turnCount: 0, spawnedBy: 'system', briefRevision: 1, createdAt: now, updatedAt: now,
  });

  const events: WorkspaceEvent[] = [];
  const bus = new EventBus(db, workspaceId);
  bus.on((ev) => events.push(ev));

  const ctx: WorkspaceContext = {
    workspaceId, config, daemon, paths, db, events: bus, registries: createRegistries(),
    log: (domain) => getLogger(domain, { workspaceId }),
    loopbackUrl: 'http://127.0.0.1:7433',
    skillsDir: join(root, 'skills'),
    templatesDir: join(root, 'templates'),
    isolated: opts.isolated ?? false,
    daemonConfigDir: join(root, 'daemon-config'),
    // The real loader replaces `ctx.config` with what it validated, and code that changes a
    // setting then reads it back through the context — so the fake has to do the same.
    saveConfig: async (next) => { ctx.config = WorkspaceConfigSchema.parse(next); },
  };

  const services: Partial<CoreServices> = {};
  // Real, not a double: it is a read-only projection over this harness's own db, so every suite that
  // reaches it (and the proxy below would otherwise throw for) reads the activity its own calls wrote.
  services.changelog = createChangelogService(ctx, () => deps());
  // Real too: it reads and writes this harness's own config and db, and every suite that runs a turn
  // reaches it through the resolution path (VS-77).
  services.models = createModelsService(ctx, () => deps());
  // Real as well (VS-92): the harness root is a real temp directory, so the encrypted store writes
  // and reads exactly as it does in a workspace, and the run engine reaches it for a role's secrets.
  services.secrets = createSecretsService(ctx);
  // Real as well (VS-97): it reads this harness's own db and its own (empty) forge registry, so a
  // suite that has registered no forge gets the same `no_forge` answer a project without one gets.
  services.pullRequests = createPullRequestsService(ctx, () => deps());
  const deps = (): CoreServices =>
    new Proxy({} as CoreServices, {
      get: (_t, prop: string | symbol) => {
        const v = (services as Record<string | symbol, unknown>)[prop];
        if (v !== undefined) return v;
        throw new Error(`test harness: core service "${String(prop)}" was not provided`);
      },
    });

  const addWorker = (ticketId: string | null, over: Record<string, unknown> = {}): string => {
    const id = newId();
    const ts = nowIso();
    db.insert('agents', {
      id, workspaceId, kind: 'worker', projectId: projectId || null, roleId: roleId || null, roleRevision: 1, ticketId,
      name: 'Backend Engineer #1', runtimeId: 'claude', status: 'active', homePath: join(paths.workers, id),
      worktreePath: join(paths.workers, id, 'work'), branch: 'ac/test', turnEpoch: 0, turnCount: 0, spawnedBy: 'system',
      briefRevision: 1, createdAt: ts, updatedAt: ts, ...over,
    });
    if (ticketId) db.update('tickets', ticketId, { workerId: id, updatedAt: ts });
    return id;
  };

  return {
    ctx, db, root, workspaceId, projectId, projectSlug, roleId, conductorId, services, deps, events, addWorker,
    cleanup: () => { try { db.close(); } catch { /* already closed */ } rmSync(root, { recursive: true, force: true }); },
  };
}

/** Minimal specs service double: records every re-index. The ticket service schedules one after a
 *  merge, so any suite that merges needs this or the harness proxy throws inside a detached timer. */
export function fakeSpecs(): { index: (projectId: string) => Promise<{ capabilities: number; changes: number }>; calls: string[] } {
  const calls: string[] = [];
  return { calls, index: async (projectId) => { calls.push(projectId); return { capabilities: 0, changes: 0 }; } };
}

/** Minimal wake service double: records every enqueue. */
export function fakeWake(): { enqueue: (agentId: string, input: Record<string, unknown>) => Record<string, unknown>; calls: Array<{ agentId: string; input: Record<string, unknown> }>; listForAgent: () => never[]; cancelForAgent: () => number } {
  const calls: Array<{ agentId: string; input: Record<string, unknown> }> = [];
  return {
    calls,
    enqueue: (agentId, input) => { calls.push({ agentId, input }); return { id: newId(), agentId, ...input }; },
    listForAgent: () => [],
    cancelForAgent: () => 0,
  };
}
