import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { newId, nowIso } from '@weave-ai/db';
import { OcError, PROJECT_ADD_STEPS, ProjectConfigSchema, landingBranchOf, projectLabel, type Project, type ProjectAddStepId, type ProjectConfig, type ProjectPolicies, type ProjectSyncState } from '@weave-ai/shared';
import type { WorkspaceContext } from '../context.js';
import type { Actor, CommitDetail, CoreServices, HistoryPage, HistoryQuery, ProjectsService } from '../api.js';
import { recordActivity } from '../events.js';
import { binaryExists, type OnLine } from '../util/exec.js';
import { git, githubSshRemote, fetchOriginWithRetry } from '../util/git.js';
import type { Logger } from '../logger.js';
import { projectKnowledgeSkeleton } from '../workspace/loader.js';
import { startKnowledgeRepoSwitch } from '../knowledge/repoSwitch.js';
import { modelSettingFor, modelsFor } from '../models/resolve.js';
import { createHistoryReader } from './history.js';

/** VS-359: ask the forge whether a repository is public; `null` when it cannot say, never a throw. */
async function forgeInfo(ctx: WorkspaceContext, cwd: string, remote: string | undefined): Promise<{ private: boolean } | null> {
  const forge = ctx.registries.forges.get('github');
  if (!forge?.repoInfo) return null;
  try { return await forge.repoInfo(cwd, remote); } catch { return null; }
}

/**
 * VS-263 Decision 6: `policies_json` keeps writing the legacy `'conductor'` spelling for now, on the
 * same rollback-safety terms as `workspace.yaml`/`daemon.yaml`/role files — `proposalApproval`/
 * `taskApproval` are always schema-normalized to `'weaver'` in-process (`ProjectPoliciesSchema`), but
 * that is not what lands in the DB.
 */
function toLegacyPolicies(policies: ProjectPolicies): unknown {
  const revert = (v: ProjectPolicies['proposalApproval']): unknown => (v === 'weaver' ? 'conductor' : v);
  return {
    ...policies,
    ...(policies.proposalApproval !== undefined ? { proposalApproval: revert(policies.proposalApproval) } : {}),
    ...(policies.taskApproval !== undefined ? { taskApproval: revert(policies.taskApproval) } : {}),
  };
}

/**
 * The prefix `fetch()` and `checkSync()` share (VS-131): resolve the landing branch, then
 * `git fetch origin` so `origin/<landing>` is current. Kept as a helper rather than one function
 * with a `merge: boolean` flag — the merge/no-merge distinction is a safety property (a read-only
 * check must never `checkout`/`merge`), not an implementation detail, and stays visible at each
 * call site instead of threaded through a boolean.
 *
 * `retryTransient` (VS-717) defaults to off: a bounded retry is only safe for the one caller that
 * can afford to sit on a failing fetch for ~2 minutes (the curation freshness gate, which blocks a
 * single ticket either way). Every other caller of `fetch`/`checkSync` — `GET /:id/sync`,
 * `POST /:id/fetch`, the supervisor's serial `reconcilePass`, `archiveAfterMerge`, the knowledge
 * repo-switch fetch — must fail on the first attempt, or a GitHub outage turns into minutes of
 * added latency per project across all of them.
 */
async function fetchLanding(project: Project, log?: Logger, opts: { retryTransient?: boolean } = {}): Promise<string> {
  const landing = landingBranchOf(project);
  const { result: fetched, attempts } = await fetchOriginWithRetry(project.clonePath, 300_000, {
    attempts: opts.retryTransient ? undefined : 1,
    onAttempt: ({ attempt, attempts: total, stderr, willRetry }) => {
      log?.warn({ project: project.slug, attempt, attempts: total, stderr }, willRetry ? 'git fetch origin failed transiently; retrying (VS-717)' : 'git fetch origin failed');
    },
  });
  if (!fetched.ok) {
    const retried = attempts > 1 ? ` after ${attempts} attempts` : '';
    throw new OcError('internal', `git fetch failed${retried}: ${fetched.stderr.trim().slice(0, 300)}`, { project: project.slug, attempts });
  }
  return landing;
}

function looksLocal(url: string): boolean {
  if (/^[a-z+]+:\/\//i.test(url)) return false;
  if (/^[^@\s]+@[^:]+:/.test(url)) return false;   // scp-style git@host:owner/repo
  return isAbsolute(url) || url.startsWith('.') || url.startsWith('~') || existsSync(url);
}

export function createProjectsService(ctx: WorkspaceContext, deps: () => CoreServices): ProjectsService {
  const log = ctx.log('daemon');
  const historyReader = createHistoryReader(ctx.db);

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

  /** Check `url` has the project's default branch, then make it the clone's `origin` (fetch and push) and fetch it; roll `origin` back if that fails. */
  async function repointOrigin(project: Project, url: string): Promise<void> {
    if (project.status !== 'ready') throw new OcError('conflict', `project ${project.slug} is ${project.status}, not ready — its repo URL cannot change now`);
    if (deps().jobs.running(project.id)) throw new OcError('conflict', `project ${project.slug} already has a job running`);
    const source = looksLocal(url) ? resolve(url.replace(/^~/, process.env.HOME ?? '~')) : url;
    const probe = await git(['ls-remote', '--heads', source, `refs/heads/${project.defaultBranch}`], project.clonePath, 60_000);
    if (!probe.ok) throw new OcError('validation', `cannot reach ${url}: ${(probe.stderr || probe.stdout).trim().slice(0, 300)}`, { url });
    if (!probe.stdout.trim()) throw new OcError('validation', `default branch '${project.defaultBranch}' was not found on ${url}`, { url });
    const cwd = project.clonePath;
    const previous = await git(['remote', 'get-url', 'origin'], cwd, 15_000);
    // `set-url` moves the fetch URL only, and git pushes to `remote.origin.pushurl` when there is one (VS-827).
    const previousPush = await git(['config', '--get-all', 'remote.origin.pushurl'], cwd, 15_000);
    const rollback = async (): Promise<void> => {
      if (previous.ok) await git(['remote', 'set-url', 'origin', previous.stdout.trim()], cwd, 15_000);
      await git(['config', '--unset-all', 'remote.origin.pushurl'], cwd, 15_000);
      if (previousPush.ok) {
        for (const pushUrl of previousPush.stdout.split('\n').map((l) => l.trim()).filter(Boolean)) {
          await git(['config', '--add', 'remote.origin.pushurl', pushUrl], cwd, 15_000);
        }
      }
    };
    const set = await git(['remote', 'set-url', 'origin', source], cwd, 15_000);
    if (!set.ok) throw new OcError('internal', `git remote set-url failed: ${(set.stderr || set.stdout).trim().slice(0, 300)}`, { url });
    // Exit 5 means the key was absent, which is the normal case.
    const unset = await git(['config', '--unset-all', 'remote.origin.pushurl'], cwd, 15_000);
    if (!unset.ok && !/^\s*$/.test(unset.stderr + unset.stdout)) {
      await rollback();
      throw new OcError('internal', `could not clear remote.origin.pushurl: ${(unset.stderr || unset.stdout).trim().slice(0, 300)}`, { url });
    }
    const fetchUrl = await git(['remote', 'get-url', 'origin'], cwd, 15_000);
    const pushUrl = await git(['remote', 'get-url', '--push', 'origin'], cwd, 15_000);
    if (!fetchUrl.ok || !pushUrl.ok || fetchUrl.stdout.trim() !== source || pushUrl.stdout.trim() !== source) {
      await rollback();
      throw new OcError('internal', `re-point left origin on fetch ${fetchUrl.stdout.trim()} / push ${pushUrl.stdout.trim()}, expected ${source} for both`, { url });
    }
    const fetched = await git(['fetch', '--prune', 'origin'], cwd, 300_000);
    if (!fetched.ok) {
      await rollback();
      throw new OcError('validation', `fetching ${url} failed: ${(fetched.stderr || fetched.stdout).trim().slice(0, 300)}`, { url });
    }
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
    // The workers setting's runtime: openspec generates its skill files for the CLI that will read
    // them, and every worker in the workspace runs on that one (VS-77).
    const init = await sh('openspec', ['init', '--tools', modelSettingFor(modelsFor(ctx), 'worker').runtime], {
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
        const commit = await git(['-c', 'user.name=Weave AI', '-c', 'user.email=weave-ai@localhost', 'commit', '-q', '-m', 'chore: adopt OpenSpec'], project.clonePath, 30_000);
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
    const base = declared ?? ProjectConfigSchema.parse({
      id: project.slug, url: project.gitUrl, name: project.name, defaultBranch: project.defaultBranch,
      maxWorkers: project.maxWorkers,
      ...(project.setupCommand ? { setupCommand: project.setupCommand } : {}),
      ...(project.landingBranch ? { landingBranch: project.landingBranch } : {}),
      worktrees: project.worktreeProvider, openspec: { enabled: Boolean(project.openspecEnabled) },
      knowledgeRepo: { enabled: Boolean(project.knowledgeRepoEnabled) }, policies: project.policies,
    });
    return { ...base, url: githubSshRemote(base.url) };
  }

  /** Validate, refuse a duplicate, insert the row in `cloning` and open the job that will report it. */
  function createRow(actor: Actor, rawCfg: ProjectConfig): { project: Project; cfg: ProjectConfig; jobId: string } {
    const parsed = ProjectConfigSchema.safeParse(rawCfg);
    if (!parsed.success) throw new OcError('validation', `invalid project config: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
    const cfg = { ...parsed.data, url: githubSshRemote(parsed.data.url) };
    if (ctx.db.get<{ id: string }>('SELECT id FROM projects WHERE workspace_id = ? AND slug = ?', [ctx.workspaceId, cfg.id])) {
      throw new OcError('conflict', `project ${cfg.id} already exists`);
    }
    const id = newId();
    const now = nowIso();
    ctx.db.insert('projects', {
      id, workspaceId: ctx.workspaceId, slug: cfg.id, name: cfg.name ?? cfg.id, gitUrl: cfg.url, defaultBranch: cfg.defaultBranch,
      landingBranch: cfg.landingBranch ?? null,
      clonePath: join(ctx.paths.projects, cfg.id), maxWorkers: cfg.maxWorkers, setupCommand: cfg.setupCommand ?? null, warmPathsJson: cfg.warmPaths,
      worktreeProvider: cfg.worktrees ?? ctx.config.defaults.worktrees, openspecEnabled: cfg.openspec.enabled,
      knowledgeRepoEnabled: cfg.knowledgeRepo.enabled, policiesJson: toLegacyPolicies(cfg.policies),
      status: 'cloning', createdAt: now, updatedAt: now,
    });
    const job = deps().jobs.start('project_add', { type: 'project', id }, actor);
    return { project: get(id), cfg, jobId: job.id };
  }

  /**
   * `startAdd` and `retryAdd` answer before the pipeline finishes, so nothing awaits what `runAdd`
   * returns. By the time it rejects the failure is already on both records and in the log — its own
   * catch block does that before re-throwing, for the sake of `add`, which does await it — so all
   * that is left here is to absorb the rejection instead of letting it escape the process as an
   * unhandled one. Nothing is drained at shutdown: an add is minutes of cloning, and a daemon that
   * waited for it would hang; a job left running by a stopped daemon is settled at the next startup.
   */
  function detach(slug: string, p: Promise<void>): void {
    p.catch((e: unknown) => log.debug({ project: slug, err: String(e) }, 'detached project add failed'));
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
      describeTicket(actor, id, cfg.id, projectLabel({ name: cfg.name ?? '', slug: cfg.id }), report);
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
  function describeTicket(actor: Actor, id: string, slug: string, label: string, report: StepReporter): void {
    try {
      deps().tickets.create(actor, {
        projectId: id, kind: 'scout', title: `Describe project ${label}`,
        description: `Investigate the \`${slug}\` repository and write the project knowledge base: overview, stack and commands (run, test, lint, build), conventions the repo docs do not state, current focus, landmines. For each major subsystem, integration or runbook worth more than a few lines, write a linked knowledge document (weave_knowledge_doc_put) and link it from PROJECT.md's Documents section with [[slug]].\n\n## Acceptance criteria\n- \`knowledge/projects/${slug}/PROJECT.md\` filled in through \`weave_knowledge_note\`\n- a \`report\` document on this ticket summarising what you found`,
        priority: 'medium', originKind: 'project_describe', originFingerprint: `project_describe:${slug}`,
      });
      // A new project is news the conductor must act on now (hire a role, assign the scout), not at the next digest.
      try {
        const conductor = deps().workers.conductor();
        deps().wake.enqueue(conductor.id, {
          source: 'system', reason: `project ${label} was added; its scout ticket is unassigned — hire a role for it or assign one`,
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
      detach(cfg.id, runAdd(project.id, cfg, jobId, actor));
      return { project, jobId };
    },

    retryAdd(actor: Actor, id: string): { project: Project; jobId: string } {
      const project = get(id);
      if (project.status !== 'error') throw new OcError('conflict', `project ${project.slug} is ${project.status}, not error — there is nothing to retry`);
      if (deps().jobs.running(project.id)) throw new OcError('conflict', `project ${project.slug} already has a job running`);
      const cfg = configFor(project);
      ctx.db.update('projects', project.id, { status: 'cloning', errorText: null, gitUrl: cfg.url, updatedAt: nowIso() });
      const job = deps().jobs.start('project_add', { type: 'project', id: project.id }, actor);
      detach(cfg.id, runAdd(project.id, cfg, job.id, actor));
      return { project: get(project.id), jobId: job.id };
    },

    async update(actor: Actor, id: string, patch: Partial<ProjectConfig>): Promise<Project> {
      const project = get(id);
      // An empty string is the "clear the landing branch" sentinel (the schema field has no `null`
      // — it's `z.string().optional()`, matching every other optional string here); a non-empty
      // value is checked against the project's last-fetched remote state before it is accepted, so a
      // typo is rejected here rather than discovered when a ticket's merge fails to verify.
      if (typeof patch.landingBranch === 'string' && patch.landingBranch !== '') {
        const exists = await git(['rev-parse', '--verify', '--quiet', `origin/${patch.landingBranch}`], project.clonePath, 15_000);
        if (!exists.ok || !exists.stdout.trim()) {
          throw new OcError('validation', `branch '${patch.landingBranch}' was not found on origin as of ${project.slug}'s last fetch — fetch the project first if the branch was just created, then try again`);
        }
      }
      // Re-pointing (VS-811): verify the new remote and move the clone's `origin` before any row or
      // config write, so a refusal leaves everything as it was. The old remote is only ever read.
      const nextUrl = typeof patch.url === 'string' ? githubSshRemote(patch.url.trim()) : undefined;
      const repoint = nextUrl !== undefined && nextUrl !== '' && nextUrl !== project.gitUrl;
      if (repoint) await repointOrigin(project, nextUrl);
      const existing = ctx.config.projects.find((p) => p.id === project.slug);
      // A name that is empty once trimmed clears the display name (VS-330), the same empty-string
      // sentinel `landingBranch` uses; readers fall back to the slug. The row column is NOT NULL, so
      // "no name" is stored as the empty string.
      const clearingName = typeof patch.name === 'string' && patch.name.trim() === '';
      const trimmedName = typeof patch.name === 'string' ? patch.name.trim() : undefined;
      const patchForMerge: Partial<ProjectConfig> = { ...patch };
      if (repoint) patchForMerge.url = nextUrl;
      if (patch.landingBranch === '') patchForMerge.landingBranch = undefined;
      if (trimmedName !== undefined) patchForMerge.name = clearingName ? undefined : trimmedName;
      const merged = ProjectConfigSchema.parse({ ...(existing ?? { id: project.slug, url: project.gitUrl }), ...patchForMerge, id: project.slug });
      const nextName = clearingName ? '' : (merged.name ?? project.name);
      // VS-359: changing the knowledge-repo opt-in on a project that already has a clone is a
      // reviewed switch — one pull request whose merge flips the flag — never a direct write. A
      // project still being created has no knowledge to move, so its creation path is untouched.
      // `knowledgeRepoEnabled` is stored 0/1, so compare as booleans. Any explicit request while a
      // switch is already pending is itself a second switch request and is refused.
      const flagChanges = merged.knowledgeRepo.enabled !== Boolean(project.knowledgeRepoEnabled);
      const switchRelevant = patch.knowledgeRepo !== undefined && (flagChanges || project.knowledgeSwitch !== null);
      let knowledgeRepoEnabled = merged.knowledgeRepo.enabled;
      if (switchRelevant && project.status === 'ready' && existsSync(project.clonePath)) {
        if (project.knowledgeSwitch) {
          throw new OcError('conflict', `a knowledge-repo switch for ${project.slug} is already waiting on ${project.knowledgeSwitch.prUrl}; close that pull request to cancel it`);
        }
        const direction = merged.knowledgeRepo.enabled ? 'on' : 'off';
        const result = await startKnowledgeRepoSwitch(ctx, deps, project, direction);
        if (result.kind === 'direct') {
          await service.applyKnowledgeRepoSwitch(project, merged.knowledgeRepo.enabled);
        } else {
          knowledgeRepoEnabled = Boolean(project.knowledgeRepoEnabled); // the request started a switch; the flag flips when it merges
        }
      }
      ctx.db.update('projects', project.id, {
        name: nextName, ...(repoint ? { gitUrl: nextUrl } : {}), defaultBranch: merged.defaultBranch, landingBranch: merged.landingBranch ?? null, maxWorkers: merged.maxWorkers,
        setupCommand: merged.setupCommand ?? null, warmPathsJson: merged.warmPaths, worktreeProvider: merged.worktrees ?? project.worktreeProvider,
        openspecEnabled: merged.openspec.enabled,
        knowledgeRepoEnabled,
        policiesJson: toLegacyPolicies(merged.policies), updatedAt: nowIso(),
      });
      await upsertConfigBlock({ ...(nextName === '' ? { ...merged, name: undefined } : merged), knowledgeRepo: { enabled: knowledgeRepoEnabled } });
      recordActivity(ctx.db, ctx.workspaceId, actor, 'project.update', 'project', project.id, { patch: Object.keys(patch) });
      ctx.events.emit('project.updated', 'project', project.id, { slug: project.slug });
      // VS-578: turning OpenSpec on for an existing ready project whose repo never adopted it needs the
      // `openspec/` scaffold, or its change tickets would fail the proposed gate. Run the same
      // best-effort bootstrap the add pipeline uses; it must not block the PATCH or fail the request.
      if (merged.openspec.enabled && !Boolean(project.openspecEnabled) && project.status === 'ready' && existsSync(project.clonePath)) {
        const fresh = get(project.id);
        void bootstrapOpenSpec(fresh).catch((e: unknown) => log.warn({ err: String(e), project: fresh.slug }, 'OpenSpec bootstrap on enable failed'));
        recordActivity(ctx.db, ctx.workspaceId, actor, 'project.openspec_enabled', 'project', project.id, { bootstrap: 'started' });
      }
      return get(project.id);
    },

    async applyKnowledgeRepoSwitch(project: Project, enabled: boolean): Promise<void> {
      const fresh = get(project.id);
      const base = ctx.config.projects.find((p) => p.id === fresh.slug) ?? configFor(fresh);
      ctx.db.update('projects', fresh.id, { knowledgeRepoEnabled: enabled, knowledgeSwitchJson: null, updatedAt: nowIso() });
      await upsertConfigBlock({ ...base, knowledgeRepo: { enabled } });
      recordActivity(ctx.db, ctx.workspaceId, { kind: 'system', id: null }, 'project.update', 'project', fresh.id, { knowledgeRepoEnabled: enabled });
      ctx.events.emit('project.updated', 'project', fresh.id, { slug: fresh.slug, knowledgeRepoEnabled: enabled });
      log.info({ project: fresh.slug, enabled }, 'knowledge-repo switch applied');
    },

    async repoInfo(id: string): Promise<{ private: boolean } | null> {
      return forgeInfo(ctx, get(id).clonePath, undefined);
    },

    async repoInfoForUrl(url: string): Promise<{ private: boolean } | null> {
      return forgeInfo(ctx, ctx.paths.root, url);
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

    async fetch(id: string, opts: { retryTransient?: boolean } = {}): Promise<{ head: string; fastForwarded: boolean }> {
      const project = get(id);
      // Kept on the project's own landing branch (VS-119, project-level regardless of any one
      // ticket's override — see design.md), not just fast-forwarded: `git clone` may have left the
      // clone on the repository's actual default branch, which differs from the landing branch.
      const landing = await fetchLanding(project, log, opts);
      const before = await git(['rev-parse', 'HEAD'], project.clonePath, 15_000);
      const beforeHead = before.stdout.trim();
      await git(['checkout', landing], project.clonePath, 30_000);
      let merged = await git(['merge', '--ff-only', `origin/${landing}`], project.clonePath, 120_000);
      // VS-673: a fast-forward failure means the clone's branch is not an ancestor of the new
      // origin/<landing> tip — indistinguishable, by reachability alone, from "the remote was
      // rewritten" (disposable) or "something committed straight into the clone" (real, unpushed
      // work — see design.md Decision 2, confirmed for archiveAfterMerge's local-branch backfill).
      // The guard is provenance, not content: only self-heal when nothing has moved the clone's
      // branch since the last time this same function left it matching origin.
      let recovered = false;
      if (!merged.ok && project.primaryCloneSyncedHead && project.primaryCloneSyncedHead === beforeHead) {
        const reset = await git(['reset', '--hard', `origin/${landing}`], project.clonePath, 30_000);
        if (reset.ok) { merged = reset; recovered = true; }
      }
      const after = await git(['rev-parse', 'HEAD'], project.clonePath, 15_000);
      const head = after.ok ? after.stdout.trim() : beforeHead;
      const fastForwarded = merged.ok && beforeHead !== head;
      const syncState: ProjectSyncState = merged.ok ? 'in_sync' : 'diverged';
      ctx.db.update('projects', project.id, {
        syncState, lastFetchedAt: nowIso(), updatedAt: nowIso(),
        ...(merged.ok ? { primaryCloneSyncedHead: head } : {}),
      });
      ctx.events.emit('project.updated', 'project', project.id, { slug: project.slug, syncState });
      if (recovered) {
        log.info({ project: project.slug }, 'primary clone had diverged from a rewritten remote; reset to match it (VS-673)');
      } else if (!merged.ok) {
        log.warn({ project: project.slug, stderr: merged.stderr.trim().slice(0, 200) }, 'primary clone could not be safely brought in sync: it holds a commit not confirmed to be a stale copy of the remote, so it was left untouched');
      }
      if (fastForwarded) { try { await deps().specs.index(project.id); } catch (e) { log.debug({ err: String(e) }, 'spec reindex after fetch failed'); } }
      return { head, fastForwarded };
    },

    async checkSync(id: string): Promise<{ syncState: ProjectSyncState; behindBy: number | null }> {
      const project = get(id);
      const landing = await fetchLanding(project, log);
      const remote = `origin/${landing}`;
      const head = await git(['rev-parse', 'HEAD'], project.clonePath, 15_000);
      const remoteHead = await git(['rev-parse', remote], project.clonePath, 15_000);
      let syncState: ProjectSyncState;
      let behindBy: number | null = null;
      if (head.ok && remoteHead.ok && head.stdout.trim() === remoteHead.stdout.trim()) {
        syncState = 'in_sync';
      } else {
        const ancestor = await git(['merge-base', '--is-ancestor', 'HEAD', remote], project.clonePath, 15_000);
        if (ancestor.ok) {
          syncState = 'behind';
          const count = await git(['rev-list', '--count', `HEAD..${remote}`], project.clonePath, 15_000);
          behindBy = count.ok ? Number(count.stdout.trim()) || 0 : null;
        } else {
          syncState = 'diverged';
        }
      }
      ctx.db.update('projects', project.id, { syncState, updatedAt: nowIso() });
      ctx.events.emit('project.updated', 'project', project.id, { slug: project.slug, syncState });
      return { syncState, behindBy };
    },

    async history(id: string, query?: HistoryQuery): Promise<HistoryPage> {
      return historyReader.history(get(id), query);
    },

    async commit(id: string, sha: string): Promise<CommitDetail> {
      return historyReader.commit(get(id), sha);
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
