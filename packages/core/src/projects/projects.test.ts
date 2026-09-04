import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Project, ProjectConfig, WorkspaceConfig } from '@agent-conductor/shared';
import { makeHarness, type TestHarness } from '../testing/context.js';
import { createProjectsService } from './index.js';
import { git } from '../util/git.js';
import type { Actor, ProjectsService } from '../api.js';

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
    projects = createProjectsService(h.ctx, h.deps);
  });
  afterEach(() => { h.cleanup(); while (tmps.length) rmSync(tmps.pop()!, { recursive: true, force: true }); });

  const cfg = (url: string, over: Partial<ProjectConfig> = {}): ProjectConfig => ({
    id: 'web', url, defaultBranch: 'main', maxWorkers: 4, warmPaths: [], openspec: { enabled: true }, policies: {}, ...over,
  } as ProjectConfig);

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
    expect(readFileSync(kb, 'utf8')).toContain('## Stack & commands');

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

  it('archives a project on remove and drops it from the declaration', async () => {
    const src = await sourceRepo();
    const project = await projects.add(HUMAN, cfg(src));
    await projects.remove(HUMAN, project.id);
    expect(h.db.get<Project>('SELECT * FROM projects WHERE id = ?', [project.id])!.status).toBe('archived');
    expect(saved.at(-1)!.projects).toEqual([]);
    expect(existsSync(project.clonePath)).toBe(true);   // the clone is never deleted
  });
});
