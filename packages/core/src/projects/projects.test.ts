import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Job, Project, ProjectConfig, WorkspaceConfig } from '@agent-conductor/shared';
import { makeHarness, type TestHarness } from '../testing/context.js';
import { createProjectsService } from './index.js';
import { createJobsService } from '../jobs/index.js';
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
  afterEach(() => { h.cleanup(); while (tmps.length) rmSync(tmps.pop()!, { recursive: true, force: true }); });

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
