import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { newId, nowIso } from '@agent-conductor/db';
import { OcError, ProjectConfigSchema, type Project, type ProjectConfig } from '@agent-conductor/shared';
import type { WorkspaceContext } from '../context.js';
import type { Actor, CoreServices, ProjectsService } from '../api.js';
import { recordActivity } from '../events.js';
import { binaryExists } from '../util/exec.js';
import { git } from '../util/git.js';
import { projectKnowledgeSkeleton } from '../workspace/loader.js';

function looksLocal(url: string): boolean {
  if (/^[a-z+]+:\/\//i.test(url)) return false;
  if (/^[^@\s]+@[^:]+:/.test(url)) return false;   // scp-style git@host:owner/repo
  return isAbsolute(url) || url.startsWith('.') || url.startsWith('~') || existsSync(url);
}

export function createProjectsService(ctx: WorkspaceContext, deps: () => CoreServices): ProjectsService {
  const log = ctx.log('daemon');

  const get = (id: string): Project => {
    const p = ctx.db.get<Project>('SELECT * FROM projects WHERE workspace_id = ? AND (id = ? OR slug = ?)', [ctx.workspaceId, id, id]);
    if (!p) throw new OcError('not_found', `project ${id} not found`);
    return p;
  };

  async function clone(url: string, clonePath: string): Promise<void> {
    if (existsSync(join(clonePath, '.git'))) return;
    mkdirSync(join(clonePath, '..'), { recursive: true });
    const source = looksLocal(url) ? resolve(url.replace(/^~/, process.env.HOME ?? '~')) : url;
    const r = await git(['clone', source, clonePath], ctx.paths.root, 900_000);
    if (!r.ok) throw new OcError('internal', `git clone failed: ${(r.stderr || r.stdout).trim().slice(0, 500)}`, { url });
  }

  async function detectDefaultBranch(clonePath: string, declared: string): Promise<string> {
    const head = await git(['symbolic-ref', '--short', 'HEAD'], clonePath, 15_000);
    const actual = head.ok ? head.stdout.trim() : '';
    if (!actual || actual === declared) return declared;
    const declaredExists = await git(['rev-parse', '--verify', '--quiet', declared], clonePath, 15_000);
    return declaredExists.ok && declaredExists.stdout.trim() ? declared : actual;
  }

  function seedKnowledge(slug: string): void {
    const dir = join(ctx.paths.knowledge, 'projects', slug);
    mkdirSync(join(dir, 'archive'), { recursive: true });
    const file = join(dir, 'PROJECT.md');
    if (!existsSync(file)) writeFileSync(file, projectKnowledgeSkeleton(slug), 'utf8');
    try { deps().knowledge.reindex(); } catch { /* knowledge service may not be ready yet */ }
  }

  async function bootstrapOpenSpec(project: Project): Promise<void> {
    if (!project.openspecEnabled) return;
    if (existsSync(join(project.clonePath, 'openspec'))) return;
    if (!(await binaryExists('openspec'))) { log.info({ project: project.slug }, 'openspec binary not found; skipping init'); return; }
    const r = await git(['rev-parse', '--is-inside-work-tree'], project.clonePath, 10_000);
    if (!r.ok) return;
    const { sh } = await import('../util/exec.js');
    const init = await sh('openspec', ['init', '--tools', project.runtimeId], {
      cwd: project.clonePath, timeoutMs: 120_000,
      env: { CI: '1', OPENSPEC_TELEMETRY: '0', OPENSPEC_NO_UPDATE_CHECK: '1', NO_COLOR: '1' },
    });
    if (!init.ok) log.warn({ project: project.slug, stderr: init.stderr.slice(0, 300) }, 'openspec init failed (best effort)');
    else {
      log.info({ project: project.slug }, 'openspec initialised in the primary clone');
      // Commit the generated files on the default branch so worktrees branch from a clean tree and merges never hit untracked files.
      const generated = ['openspec', '.claude', '.agents', '.opencode', '.gemini', '.codex'].filter((d) => existsSync(join(project.clonePath, d)));
      const add = await git(['add', '-A', '--', ...generated], project.clonePath, 30_000);
      if (!add.ok) log.warn({ project: project.slug, stderr: add.stderr.slice(0, 200) }, 'could not stage the OpenSpec init');
      else {
        const commit = await git(['-c', 'user.name=AgentConductor', '-c', 'user.email=agent-conductor@localhost', 'commit', '-q', '-m', 'chore: adopt OpenSpec'], project.clonePath, 30_000);
        if (!commit.ok && !/nothing to commit/.test(commit.stderr + commit.stdout)) log.warn({ project: project.slug, stderr: commit.stderr.slice(0, 200) }, 'could not commit the OpenSpec init');
        else if (commit.ok) { const push = await git(['push'], project.clonePath, 120_000); if (!push.ok) log.info({ project: project.slug }, 'OpenSpec init committed locally (push skipped or refused)'); }
      }
    }
  }

  function upsertConfigBlock(cfg: ProjectConfig): Promise<void> {
    const next = { ...ctx.config, projects: [...ctx.config.projects.filter((p) => p.id !== cfg.id), cfg] };
    return ctx.saveConfig(next);
  }

  const service: ProjectsService = {
    list(): Project[] { return ctx.db.all<Project>('SELECT * FROM projects WHERE workspace_id = ? ORDER BY created_at', [ctx.workspaceId]); },
    get,

    async add(actor: Actor, rawCfg: ProjectConfig): Promise<Project> {
      const parsed = ProjectConfigSchema.safeParse(rawCfg);
      if (!parsed.success) throw new OcError('validation', `invalid project config: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
      const cfg = parsed.data;
      if (ctx.db.get<{ id: string }>('SELECT id FROM projects WHERE workspace_id = ? AND slug = ?', [ctx.workspaceId, cfg.id])) {
        throw new OcError('conflict', `project ${cfg.id} already exists`);
      }
      const id = newId();
      const clonePath = join(ctx.paths.projects, cfg.id);
      const now = nowIso();
      const runtimeId = cfg.runtime ?? ctx.config.defaults.runtime;
      ctx.db.insert('projects', {
        id, workspaceId: ctx.workspaceId, slug: cfg.id, name: cfg.name ?? cfg.id, gitUrl: cfg.url, defaultBranch: cfg.defaultBranch,
        clonePath, maxWorkers: cfg.maxWorkers, setupCommand: cfg.setupCommand ?? null, warmPathsJson: cfg.warmPaths,
        worktreeProvider: cfg.worktrees ?? ctx.config.defaults.worktrees, runtimeId, model: cfg.model ?? ctx.config.defaults.model,
        openspecEnabled: cfg.openspec.enabled, policiesJson: cfg.policies, status: 'cloning', createdAt: now, updatedAt: now,
      });

      try {
        await clone(cfg.url, clonePath);
        const defaultBranch = await detectDefaultBranch(clonePath, cfg.defaultBranch);
        ctx.db.update('projects', id, { defaultBranch, status: 'ready', lastFetchedAt: now, updatedAt: nowIso() });
        cfg.defaultBranch = defaultBranch;
      } catch (e) {
        ctx.db.update('projects', id, { status: 'error', errorText: String(e).slice(0, 500), updatedAt: nowIso() });
        throw e;
      }

      await upsertConfigBlock(cfg);           // workspace.yaml + regenerated wt.toml (warm + setup pre-start hooks)
      const project = get(id);
      await bootstrapOpenSpec(project);
      seedKnowledge(cfg.id);

      try {
        deps().tickets.create(actor, {
          projectId: id, kind: 'scout', title: `Describe project ${cfg.id}`,
          description: `Investigate the \`${cfg.id}\` repository and write the project knowledge base: overview, stack and commands (run, test, lint, build), conventions the repo docs do not state, current focus, landmines.\n\n## Acceptance criteria\n- \`knowledge/projects/${cfg.id}/PROJECT.md\` filled in through \`ac_knowledge_note\`\n- a \`report\` document on this ticket summarising what you found`,
          priority: 'medium', originKind: 'project_describe', originFingerprint: `project_describe:${cfg.id}`,
        });
      } catch (e) { log.warn({ err: String(e), project: cfg.id }, 'could not create the project description ticket'); }

      recordActivity(ctx.db, ctx.workspaceId, actor, 'project.add', 'project', id, { slug: cfg.id, url: cfg.url });
      ctx.events.emit('project.added', 'project', id, { slug: cfg.id, url: cfg.url, defaultBranch: project.defaultBranch });
      log.info({ project: cfg.id, clonePath }, 'project added');
      return get(id);
    },

    async update(actor: Actor, id: string, patch: Partial<ProjectConfig>): Promise<Project> {
      const project = get(id);
      const existing = ctx.config.projects.find((p) => p.id === project.slug);
      const merged = ProjectConfigSchema.parse({ ...(existing ?? { id: project.slug, url: project.gitUrl }), ...patch, id: project.slug });
      ctx.db.update('projects', project.id, {
        name: merged.name ?? project.name, defaultBranch: merged.defaultBranch, maxWorkers: merged.maxWorkers,
        setupCommand: merged.setupCommand ?? null, warmPathsJson: merged.warmPaths, worktreeProvider: merged.worktrees ?? project.worktreeProvider,
        runtimeId: merged.runtime ?? project.runtimeId, model: merged.model ?? project.model, openspecEnabled: merged.openspec.enabled,
        policiesJson: merged.policies, updatedAt: nowIso(),
      });
      await upsertConfigBlock(merged);
      recordActivity(ctx.db, ctx.workspaceId, actor, 'project.update', 'project', project.id, { patch: Object.keys(patch) });
      ctx.events.emit('project.updated', 'project', project.id, { slug: project.slug });
      return get(project.id);
    },

    async remove(actor: Actor, id: string): Promise<void> {
      const project = get(id);
      const live = ctx.db.get<{ n: number }>("SELECT COUNT(*) n FROM agents WHERE project_id = ? AND status NOT IN ('retired','done')", [project.id])?.n ?? 0;
      if (live > 0) throw new OcError('conflict', `project ${project.slug} still has ${live} live worker(s)`);
      ctx.db.update('projects', project.id, { status: 'archived', updatedAt: nowIso() });
      await ctx.saveConfig({ ...ctx.config, projects: ctx.config.projects.filter((p) => p.id !== project.slug) });
      recordActivity(ctx.db, ctx.workspaceId, actor, 'project.remove', 'project', project.id, { slug: project.slug });
      ctx.events.emit('project.removed', 'project', project.id, { slug: project.slug });
      log.info({ project: project.slug }, 'project archived (clone left on disk)');
    },

    async fetch(id: string): Promise<{ head: string; fastForwarded: boolean }> {
      const project = get(id);
      const fetched = await git(['fetch', 'origin'], project.clonePath, 300_000);
      if (!fetched.ok) throw new OcError('internal', `git fetch failed: ${fetched.stderr.trim().slice(0, 300)}`, { project: project.slug });
      const before = await git(['rev-parse', 'HEAD'], project.clonePath, 15_000);
      const merged = await git(['merge', '--ff-only', `origin/${project.defaultBranch}`], project.clonePath, 120_000);
      const after = await git(['rev-parse', 'HEAD'], project.clonePath, 15_000);
      const head = after.ok ? after.stdout.trim() : before.stdout.trim();
      const fastForwarded = merged.ok && before.stdout.trim() !== head;
      ctx.db.update('projects', project.id, { lastFetchedAt: nowIso(), updatedAt: nowIso() });
      if (!merged.ok) log.warn({ project: project.slug, stderr: merged.stderr.trim().slice(0, 200) }, 'primary clone could not be fast-forwarded');
      if (fastForwarded) { try { await deps().specs.index(project.id); } catch (e) { log.debug({ err: String(e) }, 'spec reindex after fetch failed'); } }
      return { head, fastForwarded };
    },

    async reconcile(): Promise<void> {
      const declared = ctx.config.projects;
      const rows = ctx.db.all<Project>('SELECT * FROM projects WHERE workspace_id = ?', [ctx.workspaceId]);
      for (const cfg of declared) {
        const row = rows.find((r) => r.slug === cfg.id);
        if (!row) {
          log.info({ project: cfg.id }, 'declared project missing from the database; creating it');
          try { await service.add({ kind: 'system', id: null }, cfg); } catch (e) { log.error({ project: cfg.id, err: String(e) }, 'reconcile: project add failed'); }
          continue;
        }
        if (!existsSync(join(row.clonePath, '.git'))) {
          log.warn({ project: cfg.id }, 'clone missing; re-cloning');
          try { await clone(cfg.url, row.clonePath); ctx.db.update('projects', row.id, { status: 'ready', errorText: null, updatedAt: nowIso() }); }
          catch (e) { ctx.db.update('projects', row.id, { status: 'error', errorText: String(e).slice(0, 300), updatedAt: nowIso() }); }
        }
        seedKnowledge(cfg.id);
      }
      for (const row of rows) {
        if (row.status === 'archived') continue;
        if (!declared.some((c) => c.id === row.slug)) {
          log.warn({ project: row.slug }, 'project row has no declaration in workspace.yaml (orphan; not deleted)');
        }
      }
    },
  };
  return service;
}
