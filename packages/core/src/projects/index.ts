import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { newId, nowIso } from '@agent-conductor/db';
import { OcError, PROJECT_ADD_STEPS, ProjectConfigSchema, type Project, type ProjectAddStepId, type ProjectConfig } from '@agent-conductor/shared';
import type { WorkspaceContext } from '../context.js';
import type { Actor, CoreServices, ProjectsService } from '../api.js';
import { recordActivity } from '../events.js';
import { binaryExists, type OnLine } from '../util/exec.js';
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

  /** Returns false when the clone was already on disk — a retry after a later step failed. */
  async function clone(url: string, clonePath: string, onLine?: OnLine): Promise<boolean> {
    if (existsSync(join(clonePath, '.git'))) return false;
    mkdirSync(join(clonePath, '..'), { recursive: true });
    const source = looksLocal(url) ? resolve(url.replace(/^~/, process.env.HOME ?? '~')) : url;
    // `--progress`: git only writes its counters when stderr is a terminal, and the daemon's is not.
    const r = await git(['clone', '--progress', source, clonePath], ctx.paths.root, 900_000, undefined, onLine);
    if (!r.ok) throw new OcError('internal', `git clone failed: ${(r.stderr || r.stdout).trim().slice(0, 500)}`, { url });
    return true;
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
    if (!existsSync(file)) writeFileSync(file, projectKnowledgeSkeleton(slug, ctx.config.defaults.knowledgeBudgetTokens.project), 'utf8');
    try { deps().knowledge.reindex(); } catch { /* knowledge service may not be ready yet */ }
  }

  /** Returns false when there was nothing to adopt, so the job can report the sub-step as skipped. */
  async function bootstrapOpenSpec(project: Project, onLine?: OnLine): Promise<boolean> {
    if (!project.openspecEnabled) return false;
    if (existsSync(join(project.clonePath, 'openspec'))) return false;
    if (!(await binaryExists('openspec'))) { log.info({ project: project.slug }, 'openspec binary not found; skipping init'); return false; }
    const r = await git(['rev-parse', '--is-inside-work-tree'], project.clonePath, 10_000);
    if (!r.ok) return false;
    const { sh } = await import('../util/exec.js');
    const init = await sh('openspec', ['init', '--tools', project.runtimeId], {
      cwd: project.clonePath, timeoutMs: 120_000,
      env: { CI: '1', OPENSPEC_TELEMETRY: '0', OPENSPEC_NO_UPDATE_CHECK: '1', NO_COLOR: '1' },
      onLine,
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
        else if (commit.ok) {
          const push = await git(['push'], project.clonePath, 120_000, undefined, onLine);
          if (!push.ok) {
            // Never leave the primary clone ahead of origin (fetch could no longer fast-forward): undo the
            // commit, keep the files, and let the human commit the scaffold through their own flow.
            await git(['reset', '-q', '--mixed', 'HEAD~1'], project.clonePath, 30_000);
            log.warn({ project: project.slug, stderr: push.stderr.slice(0, 200) }, 'OpenSpec init could not be pushed; left uncommitted in the primary clone — commit `openspec/` (and the tool dirs) to the default branch yourself');
          }
        }
      }
    }
    return true;
  }

  function upsertConfigBlock(cfg: ProjectConfig): Promise<void> {
    const next = { ...ctx.config, projects: [...ctx.config.projects.filter((p) => p.id !== cfg.id), cfg] };
    return ctx.saveConfig(next);
  }

  /** How the pipeline talks to its job: sub-step transitions, and the output of the commands it runs. */
  interface StepReporter {
    begin(step: ProjectAddStepId): void;
    end(step: ProjectAddStepId, state?: 'done' | 'skipped'): void;
    onLine(step: ProjectAddStepId): OnLine;
    note(step: ProjectAddStepId, text: string): void;
  }

  function reporterFor(jobId: string): StepReporter {
    const jobs = deps().jobs;
    return {
      begin: (step) => jobs.step(jobId, step, 'running'),
      end: (step, state = 'done') => jobs.step(jobId, step, state),
      onLine: (step) => (stream, line) => jobs.line(jobId, step, stream, line),
      note: (step, text) => jobs.line(jobId, step, 'daemon', text),
    };
  }

  /** The declared config of a project, or one rebuilt from its row when the add failed before declaring it. */
  function configFor(project: Project): ProjectConfig {
    const declared = ctx.config.projects.find((p) => p.id === project.slug);
    if (declared) return declared;
    return ProjectConfigSchema.parse({
      id: project.slug, url: project.gitUrl, name: project.name, defaultBranch: project.defaultBranch,
      runtime: project.runtimeId, model: project.model, maxWorkers: project.maxWorkers,
      ...(project.setupCommand ? { setupCommand: project.setupCommand } : {}),
      worktrees: project.worktreeProvider, openspec: { enabled: project.openspecEnabled }, policies: project.policies,
    });
  }

  /** Validate, refuse a duplicate, insert the row in `cloning` and open the job that will report it. */
  function createRow(actor: Actor, rawCfg: ProjectConfig): { project: Project; cfg: ProjectConfig; jobId: string } {
    const parsed = ProjectConfigSchema.safeParse(rawCfg);
    if (!parsed.success) throw new OcError('validation', `invalid project config: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
    const cfg = parsed.data;
    if (ctx.db.get<{ id: string }>('SELECT id FROM projects WHERE workspace_id = ? AND slug = ?', [ctx.workspaceId, cfg.id])) {
      throw new OcError('conflict', `project ${cfg.id} already exists`);
    }
    const id = newId();
    const now = nowIso();
    ctx.db.insert('projects', {
      id, workspaceId: ctx.workspaceId, slug: cfg.id, name: cfg.name ?? cfg.id, gitUrl: cfg.url, defaultBranch: cfg.defaultBranch,
      clonePath: join(ctx.paths.projects, cfg.id), maxWorkers: cfg.maxWorkers, setupCommand: cfg.setupCommand ?? null, warmPathsJson: cfg.warmPaths,
      worktreeProvider: cfg.worktrees ?? ctx.config.defaults.worktrees, runtimeId: cfg.runtime ?? ctx.config.defaults.runtime,
      model: cfg.model ?? ctx.config.defaults.model, openspecEnabled: cfg.openspec.enabled, policiesJson: cfg.policies,
      status: 'cloning', createdAt: now, updatedAt: now,
    });
    const job = deps().jobs.start('project_add', { type: 'project', id }, actor);
    return { project: get(id), cfg, jobId: job.id };
  }

  /**
   * The pipeline itself, one sub-step at a time (PROJECT_ADD_STEPS). Every failure lands on both
   * records — the job names the sub-step, the project keeps the error text — and the project only
   * becomes `ready` once all of it has run.
   */
  async function runAdd(id: string, cfg: ProjectConfig, jobId: string, actor: Actor): Promise<void> {
    const report = reporterFor(jobId);
    const jobs = deps().jobs;
    const clonePath = join(ctx.paths.projects, cfg.id);
    let step: ProjectAddStepId = 'clone';
    try {
      report.begin('clone');
      const cloned = await clone(cfg.url, clonePath, report.onLine('clone'));
      if (!cloned) report.note('clone', `reusing the clone already at ${clonePath}`);
      report.end('clone');

      step = 'resolve_branch';
      report.begin('resolve_branch');
      const defaultBranch = await detectDefaultBranch(clonePath, cfg.defaultBranch);
      cfg.defaultBranch = defaultBranch;
      ctx.db.update('projects', id, { defaultBranch, lastFetchedAt: nowIso(), updatedAt: nowIso() });
      report.note('resolve_branch', `default branch: ${defaultBranch}`);
      report.end('resolve_branch');

      step = 'declare';
      report.begin('declare');
      await upsertConfigBlock(cfg);           // workspace.yaml + regenerated wt.toml (warm + setup pre-start hooks)
      report.end('declare');

      step = 'openspec';
      report.begin('openspec');
      const adopted = await bootstrapOpenSpec(get(id), report.onLine('openspec'));
      if (!adopted) report.note('openspec', 'nothing to adopt: OpenSpec is disabled, already present, or its CLI is not installed');
      report.end('openspec', adopted ? 'done' : 'skipped');

      step = 'knowledge';
      report.begin('knowledge');
      seedKnowledge(cfg.id);
      report.end('knowledge');

      step = 'ticket';
      report.begin('ticket');
      describeTicket(actor, id, cfg.id, report);
      report.end('ticket');
    } catch (e) {
      ctx.db.update('projects', id, { status: 'error', errorText: String(e).slice(0, 500), updatedAt: nowIso() });
      jobs.step(jobId, step, 'failed');
      jobs.finish(jobId, 'failed', { failedStep: step, message: String(e) });
      log.warn({ project: cfg.id, step, err: String(e) }, 'project add failed');
      throw e;
    }

    ctx.db.update('projects', id, { status: 'ready', errorText: null, updatedAt: nowIso() });
    const project = get(id);
    recordActivity(ctx.db, ctx.workspaceId, actor, 'project.add', 'project', id, { slug: cfg.id, url: cfg.url });
    ctx.events.emit('project.added', 'project', id, { slug: cfg.id, url: cfg.url, defaultBranch: project.defaultBranch });
    jobs.finish(jobId, 'done');
    log.info({ project: cfg.id, clonePath }, 'project added');
  }

  /** The scout ticket that seeds the project KB, and the wake that tells the conductor to staff it. */
  function describeTicket(actor: Actor, id: string, slug: string, report: StepReporter): void {
    try {
      deps().tickets.create(actor, {
        projectId: id, kind: 'scout', title: `Describe project ${slug}`,
        description: `Investigate the \`${slug}\` repository and write the project knowledge base: overview, stack and commands (run, test, lint, build), conventions the repo docs do not state, current focus, landmines. For each major subsystem, integration or runbook worth more than a few lines, write a linked knowledge document (ac_knowledge_doc_put) and link it from PROJECT.md's Documents section with [[slug]].\n\n## Acceptance criteria\n- \`knowledge/projects/${slug}/PROJECT.md\` filled in through \`ac_knowledge_note\`\n- a \`report\` document on this ticket summarising what you found`,
        priority: 'medium', originKind: 'project_describe', originFingerprint: `project_describe:${slug}`,
      });
      // A new project is news the conductor must act on now (hire a role, assign the scout), not at the next digest.
      try {
        const conductor = deps().workers.conductor();
        deps().wake.enqueue(conductor.id, {
          source: 'system', reason: `project ${slug} was added; its scout ticket is unassigned — hire a role for it or assign one`,
          payload: { kind: 'project_added', projectId: id, projectSlug: slug },
          idempotencyKey: `project_added:${id}`, requestedBy: { kind: 'system', id: null },
        });
      } catch (e) { log.debug({ err: String(e) }, 'conductor wake after project add skipped'); }
    } catch (e) {
      // Best effort, as before: a workspace without a conductor yet still gets its project.
      report.note('ticket', `could not create the description ticket: ${String(e)}`);
      log.warn({ err: String(e), project: slug }, 'could not create the project description ticket');
    }
  }

  const service: ProjectsService = {
    list(): Project[] { return ctx.db.all<Project>('SELECT * FROM projects WHERE workspace_id = ? ORDER BY created_at', [ctx.workspaceId]); },
    get,

    async add(actor: Actor, rawCfg: ProjectConfig): Promise<Project> {
      const { project, cfg, jobId } = createRow(actor, rawCfg);
      await runAdd(project.id, cfg, jobId, actor);
      return get(project.id);
    },

    /**
     * The same pipeline, answered before it runs (VS-37). The row and its job exist by the time this
     * returns, so the caller has something to watch; the outcome lands on both records.
     */
    startAdd(actor: Actor, rawCfg: ProjectConfig): { project: Project; jobId: string } {
      const { project, cfg, jobId } = createRow(actor, rawCfg);
      void runAdd(project.id, cfg, jobId, actor);
      return { project, jobId };
    },

    retryAdd(actor: Actor, id: string): { project: Project; jobId: string } {
      const project = get(id);
      if (project.status !== 'error') throw new OcError('conflict', `project ${project.slug} is ${project.status}, not error — there is nothing to retry`);
      if (deps().jobs.running(project.id)) throw new OcError('conflict', `project ${project.slug} already has a job running`);
      const cfg = configFor(project);
      ctx.db.update('projects', project.id, { status: 'cloning', errorText: null, updatedAt: nowIso() });
      const job = deps().jobs.start('project_add', { type: 'project', id: project.id }, actor);
      void runAdd(project.id, cfg, job.id, actor);
      return { project: get(project.id), jobId: job.id };
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
