import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Job, Project, ProjectConfig, WorkspaceConfig } from '@agent-conductor/shared';
import { makeHarness, type TestHarness } from '../testing/context.js';
import { createProjectsService } from './index.js';
import { createJobsService } from '../jobs/index.js';
import { createTicketsService } from '../tickets/service.js';
import { createWakeService } from '../wake/index.js';
import { createWorkersService } from '../workers/index.js';
import { createDispatcher, type CoreDispatcher } from '../runs/dispatcher.js';
import { git } from '../util/git.js';
import { PROJECT_SECTIONS, parseDoc } from '../knowledge/files.js';
import type { Actor, JobsService, ProjectsService } from '../api.js';

const HUMAN: Actor = { kind: 'human', id: 'victor' };
const tmps: string[] = [];

async function sourceRepo(): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), 'ac-src-'));
  tmps.push(dir);
  await git(['init', '-b', 'main'], dir);
  await git(['config', 'user.email', 'test@example.com'], dir);
  await git(['config', 'user.name', 'Test'], dir);
  writeFileSync(join(dir, 'README.md'), '# web\n', 'utf8');
  await git(['add', '.'], dir);
  await git(['commit', '-m', 'init'], dir);
  return dir;
}

describe('projects', () => {
  let h: TestHarness;
  let projects: ProjectsService;
  let saved: WorkspaceConfig[];

  beforeEach(() => {
    h = makeHarness({ bare: true });
    saved = [];
    h.ctx.saveConfig = async (next) => { saved.push(next); h.ctx.config = next; };
    h.services.tickets = { create: vi.fn(() => ({ id: 't1' })) } as never;
    h.services.jobs = createJobsService(h.ctx, h.deps);
    projects = createProjectsService(h.ctx, h.deps);
  });
  // The jobs service is real here and holds the log tail of every add between flushes: drain it
  // before `cleanup` closes the database, or the pending timer fires against a closed one.
  afterEach(async () => { await jobs().stop(); h.cleanup(); while (tmps.length) rmSync(tmps.pop()!, { recursive: true, force: true }); });

  const cfg = (url: string, over: Partial<ProjectConfig> = {}): ProjectConfig => ({
    id: 'web', url, defaultBranch: 'main', maxWorkers: 4, warmPaths: [], openspec: { enabled: true }, policies: {}, ...over,
  } as ProjectConfig);

  /** OpenSpec adoption shells out and is exercised on its own; the rest of the pipeline runs without it. */
  const quick = (url: string, over: Partial<ProjectConfig> = {}): ProjectConfig => cfg(url, { openspec: { enabled: false }, ...over });
  const jobs = (): JobsService => h.services.jobs!;
  const settled = async (jobId: string): Promise<Job> => {
    for (let i = 0; i < 400; i++) {
      const job = jobs().get(jobId);
      if (job.state !== 'running') return job;
      await new Promise((r) => setTimeout(r, 25));
    }
    throw new Error('job never finished');
  };

  it('clones a local repo, records it, declares it and seeds its knowledge base', async () => {
    const src = await sourceRepo();
    const project = await projects.add(HUMAN, cfg(src, { setupCommand: 'pnpm install' }));

    expect(project.status).toBe('ready');
    expect(project.defaultBranch).toBe('main');
    expect(project.clonePath).toBe(join(h.ctx.paths.projects, 'web'));
    expect(existsSync(join(project.clonePath, 'README.md'))).toBe(true);

    expect(saved).toHaveLength(1);
    expect(saved[0]!.projects.map((p) => p.id)).toEqual(['web']);
    expect(saved[0]!.projects[0]!.setupCommand).toBe('pnpm install');

    const kb = join(h.ctx.paths.knowledge, 'projects', 'web', 'PROJECT.md');
    expect(existsSync(kb)).toBe(true);
    const headings = parseDoc(readFileSync(kb, 'utf8')).sections.map((s) => s.name);
    expect(headings).toEqual([...PROJECT_SECTIONS]);

    expect(h.services.tickets!.create).toHaveBeenCalledWith(HUMAN, expect.objectContaining({ kind: 'scout', originKind: 'project_describe', title: 'Describe project web' }));
    expect(projects.list()).toHaveLength(1);
    expect(projects.get('web').id).toBe(project.id);
  });

  it('declares a landing branch distinct from the default branch, and persists it through an update (VS-119)', async () => {
    const src = await sourceRepo();
    const project = await projects.add(HUMAN, cfg(src, { landingBranch: 'edge' }));
    expect(project.landingBranch).toBe('edge');
    expect(saved[0]!.projects[0]!.landingBranch).toBe('edge');

    const updated = await projects.update(HUMAN, project.id, { maxWorkers: 8 });
    expect(updated.landingBranch).toBe('edge');
    expect(updated.maxWorkers).toBe(8);
  });

  it('leaves landingBranch unset when a project declares none', async () => {
    const src = await sourceRepo();
    const project = await projects.add(HUMAN, cfg(src));
    expect(project.landingBranch).toBeNull();
  });

  it('persists autoMergeDefault on add (VS-153)', async () => {
    const src = await sourceRepo();
    const on = await projects.add(HUMAN, cfg(src, { policies: { autoMergeDefault: true } }));
    expect(on.policies.autoMergeDefault).toBe(true);
  });

  it('does not store autoMergeDefault true when omitted (VS-153)', async () => {
    const src = await sourceRepo();
    const project = await projects.add(HUMAN, cfg(src));
    expect(project.policies.autoMergeDefault).not.toBe(true);
  });

  it('stores proposalApproval/taskApproval under the legacy spelling, on add and on update (VS-263 Decision 6)', async () => {
    const src = await sourceRepo();
    const project = await projects.add(HUMAN, cfg(src, { policies: { proposalApproval: 'weaver', taskApproval: 'weaver' } }));
    expect(project.policies.proposalApproval).toBe('conductor');
    expect(project.policies.taskApproval).toBe('conductor');

    const updated = await projects.update(HUMAN, project.id, { policies: { proposalApproval: 'weaver', taskApproval: 'human' } });
    expect(updated.policies.proposalApproval).toBe('conductor');
    expect(updated.policies.taskApproval).toBe('human');
  });

  it('sets, changes and clears a landing branch after creation (VS-122)', async () => {
    const src = await sourceRepo();
    await git(['checkout', '-b', 'edge'], src);
    writeFileSync(join(src, 'edge-only.txt'), 'edge work', 'utf8');
    await git(['add', '.'], src);
    await git(['commit', '-m', 'edge: work'], src);
    await git(['checkout', '-b', 'staging'], src);
    await git(['checkout', 'main'], src);

    const project = await projects.add(HUMAN, cfg(src));
    expect(project.landingBranch).toBeNull();

    const set = await projects.update(HUMAN, project.id, { landingBranch: 'edge' });
    expect(set.landingBranch).toBe('edge');
    expect(saved.at(-1)!.projects[0]!.landingBranch).toBe('edge');

    const changed = await projects.update(HUMAN, project.id, { landingBranch: 'staging' });
    expect(changed.landingBranch).toBe('staging');
    expect(saved.at(-1)!.projects[0]!.landingBranch).toBe('staging');

    const cleared = await projects.update(HUMAN, project.id, { landingBranch: '' });
    expect(cleared.landingBranch).toBeNull();
    expect(saved.at(-1)!.projects[0]!.landingBranch).toBeUndefined();
  });

  it('rejects a landing branch absent from the remote, at the point of setting (VS-122)', async () => {
    const src = await sourceRepo();
    const project = await projects.add(HUMAN, cfg(src));

    await expect(projects.update(HUMAN, project.id, { landingBranch: 'does-not-exist' })).rejects.toMatchObject({
      code: 'validation',
      message: expect.stringContaining('does-not-exist'),
    });
    expect(projects.get(project.id).landingBranch).toBeNull();
  });

  it('picks up a changed landing branch on the next read with no restart (VS-122)', async () => {
    const src = await sourceRepo();
    await git(['checkout', '-b', 'edge'], src);
    writeFileSync(join(src, 'edge-only.txt'), 'edge work', 'utf8');
    await git(['add', '.'], src);
    await git(['commit', '-m', 'edge: work'], src);
    await git(['checkout', 'main'], src);

    const project = await projects.add(HUMAN, cfg(src));
    await projects.update(HUMAN, project.id, { landingBranch: 'edge' });
    // No restart, no re-instantiation of the service — the very next read reflects it.
    expect(projects.get(project.id).landingBranch).toBe('edge');
  });

  it('refuses a duplicate slug and reports a clone failure on the row', async () => {
    const src = await sourceRepo();
    await projects.add(HUMAN, cfg(src));
    await expect(projects.add(HUMAN, cfg(src))).rejects.toMatchObject({ code: 'conflict' });

    await expect(projects.add(HUMAN, cfg('/definitely/not/a/repo', { id: 'ghost' }))).rejects.toThrow();
    const ghost = h.db.get<Project>('SELECT * FROM projects WHERE slug = ?', ['ghost'])!;
    expect(ghost.status).toBe('error');
    expect(ghost.errorText).toBeTruthy();
  });

  it('detects the real default branch when the declared one does not exist', async () => {
    const src = mkdtempSync(join(tmpdir(), 'ac-src-'));
    tmps.push(src);
    await git(['init', '-b', 'trunk'], src);
    await git(['config', 'user.email', 't@e.com'], src);
    await git(['config', 'user.name', 'T'], src);
    writeFileSync(join(src, 'a.txt'), 'a', 'utf8');
    await git(['add', '.'], src);
    await git(['commit', '-m', 'init'], src);
    const project = await projects.add(HUMAN, cfg(src));
    expect(project.defaultBranch).toBe('trunk');
  });

  it('fast-forwards the primary clone on fetch', async () => {
    const src = await sourceRepo();
    const project = await projects.add(HUMAN, cfg(src));
    writeFileSync(join(src, 'second.txt'), 'more', 'utf8');
    await git(['add', '.'], src);
    await git(['commit', '-m', 'second'], src);

    const result = await projects.fetch(project.id);
    expect(result.fastForwarded).toBe(true);
    expect(existsSync(join(project.clonePath, 'second.txt'))).toBe(true);
    expect(h.db.get<Project>('SELECT * FROM projects WHERE id = ?', [project.id])!.lastFetchedAt).toBeTruthy();

    const again = await projects.fetch(project.id);
    expect(again.fastForwarded).toBe(false);
  });

  it('keeps the primary clone on the declared landing branch, not the default branch (VS-119)', async () => {
    const src = await sourceRepo();
    await git(['checkout', '-b', 'edge'], src);
    writeFileSync(join(src, 'edge-only.txt'), 'edge work', 'utf8');
    await git(['add', '.'], src);
    await git(['commit', '-m', 'edge: work'], src);
    await git(['checkout', 'main'], src);

    const project = await projects.add(HUMAN, cfg(src));
    h.db.update('projects', project.id, { landingBranch: 'edge' });

    const result = await projects.fetch(project.id);
    expect(result.fastForwarded).toBe(true);
    expect((await git(['rev-parse', '--abbrev-ref', 'HEAD'], project.clonePath)).stdout.trim()).toBe('edge');
    expect(existsSync(join(project.clonePath, 'edge-only.txt'))).toBe(true);
  });

  it('marks the clone diverged, not just failed, when it cannot be fast-forwarded (VS-131)', async () => {
    const src = await sourceRepo();
    const project = await projects.add(HUMAN, cfg(src));
    // Rewrite the remote's tip in place (an amend) rather than adding on top of it: the clone's HEAD
    // is then not an ancestor of the new tip at all, the same shape a force-push leaves behind.
    writeFileSync(join(src, 'README.md'), '# web (rewritten)\n', 'utf8');
    await git(['add', '.'], src);
    await git(['commit', '--amend', '-m', 'init (rewritten)'], src);

    const before = (await git(['rev-parse', 'HEAD'], project.clonePath)).stdout.trim();
    const result = await projects.fetch(project.id);
    expect(result.fastForwarded).toBe(false);
    expect((await git(['rev-parse', 'HEAD'], project.clonePath)).stdout.trim()).toBe(before);
    expect(h.db.get<Project>('SELECT * FROM projects WHERE id = ?', [project.id])!.syncState).toBe('diverged');
    expect(h.events.some((e) => e.type === 'project.updated' && (e.payload as { syncState?: string }).syncState === 'diverged')).toBe(true);
  });

  it('marks the clone in_sync once fetch fast-forwards it', async () => {
    const src = await sourceRepo();
    const project = await projects.add(HUMAN, cfg(src));
    expect(h.db.get<Project>('SELECT * FROM projects WHERE id = ?', [project.id])!.syncState).toBe('in_sync');
    writeFileSync(join(src, 'second.txt'), 'more', 'utf8');
    await git(['add', '.'], src);
    await git(['commit', '-m', 'second'], src);

    await projects.fetch(project.id);
    expect(h.db.get<Project>('SELECT * FROM projects WHERE id = ?', [project.id])!.syncState).toBe('in_sync');
    expect(h.events.some((e) => e.type === 'project.updated' && (e.payload as { syncState?: string }).syncState === 'in_sync')).toBe(true);
  });

  describe('checkSync (VS-131)', () => {
    it('reports in_sync without touching the clone', async () => {
      const src = await sourceRepo();
      const project = await projects.add(HUMAN, cfg(src));
      const before = (await git(['rev-parse', 'HEAD'], project.clonePath)).stdout.trim();

      const result = await projects.checkSync(project.id);
      expect(result).toEqual({ syncState: 'in_sync', behindBy: null });
      expect((await git(['rev-parse', 'HEAD'], project.clonePath)).stdout.trim()).toBe(before);
      expect(h.db.get<Project>('SELECT * FROM projects WHERE id = ?', [project.id])!.syncState).toBe('in_sync');
    });

    it('reports behind with a commit count, and never fast-forwards the clone itself', async () => {
      const src = await sourceRepo();
      const project = await projects.add(HUMAN, cfg(src));
      const before = (await git(['rev-parse', 'HEAD'], project.clonePath)).stdout.trim();
      writeFileSync(join(src, 'second.txt'), 'more', 'utf8');
      await git(['add', '.'], src);
      await git(['commit', '-m', 'second'], src);
      writeFileSync(join(src, 'third.txt'), 'more still', 'utf8');
      await git(['add', '.'], src);
      await git(['commit', '-m', 'third'], src);

      const result = await projects.checkSync(project.id);
      expect(result).toEqual({ syncState: 'behind', behindBy: 2 });
      // Read-only: HEAD and the working tree are unchanged, unlike fetch()'s merge --ff-only.
      expect((await git(['rev-parse', 'HEAD'], project.clonePath)).stdout.trim()).toBe(before);
      expect(existsSync(join(project.clonePath, 'second.txt'))).toBe(false);
      expect(h.db.get<Project>('SELECT * FROM projects WHERE id = ?', [project.id])!.syncState).toBe('behind');
    });

    it('reports diverged and discards nothing when the remote was rewritten', async () => {
      const src = await sourceRepo();
      const project = await projects.add(HUMAN, cfg(src));
      const before = (await git(['rev-parse', 'HEAD'], project.clonePath)).stdout.trim();
      writeFileSync(join(src, 'README.md'), '# web (rewritten)\n', 'utf8');
      await git(['add', '.'], src);
      await git(['commit', '--amend', '-m', 'init (rewritten)'], src);

      const result = await projects.checkSync(project.id);
      expect(result).toEqual({ syncState: 'diverged', behindBy: null });
      expect((await git(['rev-parse', 'HEAD'], project.clonePath)).stdout.trim()).toBe(before);
      expect((await git(['cat-file', '-e', before], project.clonePath)).ok).toBe(true);
      expect(h.db.get<Project>('SELECT * FROM projects WHERE id = ?', [project.id])!.syncState).toBe('diverged');
    });
  });

  it('reconcile creates rows for declared projects and leaves orphans alone', async () => {
    const src = await sourceRepo();
    h.ctx.config = { ...h.ctx.config, projects: [cfg(src)] };
    await projects.reconcile();
    expect(projects.list().map((p) => p.slug)).toEqual(['web']);

    // an undeclared row is flagged, never deleted
    h.ctx.config = { ...h.ctx.config, projects: [] };
    await projects.reconcile();
    expect(projects.list()).toHaveLength(1);
  });

  it('re-clones a declared project whose clone vanished', async () => {
    const src = await sourceRepo();
    const project = await projects.add(HUMAN, cfg(src));
    rmSync(project.clonePath, { recursive: true, force: true });
    await projects.reconcile();
    expect(existsSync(join(project.clonePath, 'README.md'))).toBe(true);
  });

  it('reports every sub-step of a successful add, skipping the one that does not apply', async () => {
    const src = await sourceRepo();
    const { project, jobId } = projects.startAdd(HUMAN, quick(src));
    expect(project.status).toBe('cloning');

    const job = await settled(jobId);
    expect(job.state).toBe('done');
    expect(job.steps.map((s) => [s.id, s.state])).toEqual([
      ['clone', 'done'], ['resolve_branch', 'done'], ['declare', 'done'],
      ['openspec', 'skipped'], ['knowledge', 'done'], ['ticket', 'done'],
    ]);
    expect(job.steps.every((s) => s.startedAt !== null && s.endedAt !== null)).toBe(true);
    expect(projects.get(project.id).status).toBe('ready');
    expect(projects.get(project.id).defaultBranch).toBe('main');
  });

  it('captures the clone output on the job', async () => {
    const src = await sourceRepo();
    const { jobId } = projects.startAdd(HUMAN, quick(src));
    const job = await settled(jobId);
    expect(job.log.some((l) => l.step === 'clone' && /Cloning into/.test(l.text))).toBe(true);
    expect(job.log.some((l) => l.step === 'resolve_branch' && l.text === 'default branch: main')).toBe(true);
  });

  it('stores a GitHub HTTPS url as SSH on the row before clone runs (VS-183)', async () => {
    const { project, jobId } = projects.startAdd(HUMAN, quick('https://github.com/acme/api.git', { id: 'api' }));
    expect(project.gitUrl).toBe('git@github.com:acme/api.git');
    await settled(jobId);
  });

  it('rewrites a stored GitHub HTTPS url to SSH when a failed add is retried (VS-183)', async () => {
    const { project, jobId } = projects.startAdd(HUMAN, quick('/definitely/not/a/repo', { id: 'ghost' }));
    await settled(jobId);
    expect(projects.get(project.id).status).toBe('error');
    h.db.update('projects', project.id, { gitUrl: 'https://github.com/acme/api.git' });

    const { project: retried, jobId: retryId } = projects.retryAdd(HUMAN, project.id);
    expect(retried.gitUrl).toBe('git@github.com:acme/api.git');
    await settled(retryId);
  });

  it('fails the job at the failing sub-step and leaves the later ones pending', async () => {
    const { project, jobId } = projects.startAdd(HUMAN, quick('/definitely/not/a/repo', { id: 'ghost' }));
    const job = await settled(jobId);
    expect(job.state).toBe('failed');
    expect(job.failedStep).toBe('clone');
    expect(job.message).toMatch(/git clone failed/);
    expect(job.steps.filter((s) => s.state === 'pending').map((s) => s.id)).toEqual(['resolve_branch', 'declare', 'openspec', 'knowledge', 'ticket']);
    const row = projects.get(project.id);
    expect(row.status).toBe('error');
    expect(row.errorText).toBeTruthy();
  });

  it('contains a detached add that fails instead of raising it out of the process', async () => {
    // `startAdd` answers before the pipeline runs, so nothing awaits the promise: an add that fails
    // has to end on the records and in the log, never as an unhandled rejection (VS-53).
    const escaped: unknown[] = [];
    const onUnhandled = (reason: unknown): void => { escaped.push(reason); };
    process.on('unhandledRejection', onUnhandled);
    try {
      const { project, jobId } = projects.startAdd(HUMAN, quick('/definitely/not/a/repo', { id: 'ghost' }));
      const job = await settled(jobId);
      // Node reports an unhandled rejection at the end of the turn it went unhandled in; give it two.
      await new Promise((r) => setImmediate(r));
      await new Promise((r) => setImmediate(r));

      expect(escaped).toEqual([]);
      expect(job.state).toBe('failed');
      expect(job.message).toMatch(/git clone failed/);
      expect(projects.get(project.id).status).toBe('error');
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });

  it('retries a failed add against the clone already on disk', async () => {
    const src = await sourceRepo();
    const first = await settled(projects.startAdd(HUMAN, quick(src)).jobId);
    expect(first.state).toBe('done');
    // As if the add had failed after the clone: the clone is there, the row is not.
    const project = projects.get('web');
    h.db.update('projects', project.id, { status: 'error', errorText: 'boom' });

    const { project: retried, jobId } = projects.retryAdd(HUMAN, project.id);
    expect(retried.status).toBe('cloning');
    const job = await settled(jobId);
    expect(job.state).toBe('done');
    expect(job.steps.find((s) => s.id === 'clone')!.state).toBe('done');
    expect(job.log.some((l) => l.step === 'clone' && /reusing the clone/.test(l.text))).toBe(true);
    expect(projects.get(project.id).status).toBe('ready');
  });

  it('refuses to retry a project that is not in error, or one with a job already running', async () => {
    const src = await sourceRepo();
    const { project, jobId } = projects.startAdd(HUMAN, quick(src));
    // `cloning`: there is nothing to retry yet.
    expect(() => projects.retryAdd(HUMAN, project.id)).toThrow(expect.objectContaining({ code: 'conflict' }));
    // `error` but the first job is still going: a double-clicked Retry must not run two pipelines over one clone.
    h.db.update('projects', project.id, { status: 'error', errorText: 'boom' });
    expect(jobs().running(project.id)?.id).toBe(jobId);
    expect(() => projects.retryAdd(HUMAN, project.id)).toThrow(expect.objectContaining({ code: 'conflict' }));

    await settled(jobId);
    expect(projects.get(project.id).status).toBe('ready');
    expect(() => projects.retryAdd(HUMAN, project.id)).toThrow(expect.objectContaining({ code: 'conflict' }));
    expect(jobs().list({ entityId: project.id })).toHaveLength(1);
  });

  it('archives a project on remove and drops it from the declaration', async () => {
    const src = await sourceRepo();
    const project = await projects.add(HUMAN, cfg(src));
    await projects.remove(HUMAN, project.id);
    expect(h.db.get<Project>('SELECT * FROM projects WHERE id = ?', [project.id])!.status).toBe('archived');
    expect(saved.at(-1)!.projects).toEqual([]);
    expect(existsSync(project.clonePath)).toBe(true);   // the clone is never deleted
  });
});

describe('adding a project to an isolated daemon (VS-143, daemon-isolation/dispatch-gate)', () => {
  let h: TestHarness;
  let projects: ProjectsService;
  let dispatcher: CoreDispatcher;

  beforeEach(() => {
    h = makeHarness({ bare: true, isolated: true });
    h.ctx.saveConfig = async (next) => { h.ctx.config = next; };
    h.services.jobs = createJobsService(h.ctx, h.deps);
    h.services.tickets = createTicketsService(h.ctx, h.deps);
    h.services.wake = createWakeService(h.ctx, h.deps);
    h.services.workers = createWorkersService(h.ctx, h.deps);
    dispatcher = createDispatcher(h.ctx, h.deps);
    h.services.dispatcher = dispatcher;
    projects = createProjectsService(h.ctx, h.deps);
  });
  afterEach(async () => { await jobs().stop(); h.cleanup(); while (tmps.length) rmSync(tmps.pop()!, { recursive: true, force: true }); });
  const jobs = (): JobsService => h.services.jobs!;
  const quick = (url: string): ProjectConfig => ({
    id: 'web', url, defaultBranch: 'main', maxWorkers: 4, warmPaths: [], openspec: { enabled: false }, policies: {},
  } as ProjectConfig);

  it('creates the scout ticket and the conductor wake as usual, but dispatches neither', async () => {
    const src = await sourceRepo();
    await projects.add(HUMAN, quick(src));

    // The scout ticket is created exactly as it is in a non-isolated daemon.
    const scout = h.db.get<{ kind: string; originKind: string }>("SELECT kind, origin_kind as originKind FROM tickets WHERE kind = 'scout'");
    expect(scout).toMatchObject({ kind: 'scout', originKind: 'project_describe' });

    // So is the conductor's wake about it — nobody skipped enqueueing it.
    const queued = h.services.wake!.listForAgent(h.services.workers!.conductor().id, ['queued']);
    expect(queued).toHaveLength(1);
    expect(queued[0]!.payload).toMatchObject({ kind: 'project_added' });

    // But nobody asked for a turn: the dispatcher leaves it queued rather than spawning one.
    await dispatcher.tick();
    await dispatcher.drain();
    expect(h.db.all('SELECT id FROM runs')).toHaveLength(0);
    expect(h.services.wake!.listForAgent(h.services.workers!.conductor().id, ['queued'])).toHaveLength(1);
  });
});
