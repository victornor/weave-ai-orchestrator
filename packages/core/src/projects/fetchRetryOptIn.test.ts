import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProjectConfig } from '@weave-ai/shared';
import { makeHarness, type TestHarness } from '../testing/context.js';
import { createProjectsService } from './index.js';
import { createJobsService } from '../jobs/index.js';
import type { ProjectsService } from '../api.js';
import { git } from '../util/git.js';

let fetchAttempts = 0;

// The bounded retry (VS-717) is opt-in: `fetchOriginWithRetry`'s `run`/`sleep` are overridden here so
// a transient failure is reproducible with no real network call and no real backoff delay, while
// every other git call (clone, checkout, rev-parse, ...) still runs for real against a local repo.
vi.mock('../util/git.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../util/git.js')>();
  return {
    ...actual,
    fetchOriginWithRetry: (cwd: string, timeoutMs: number, opts: Record<string, unknown> = {}) =>
      actual.fetchOriginWithRetry(cwd, timeoutMs, {
        ...opts,
        run: async () => {
          fetchAttempts++;
          return { ok: false, exitCode: 1, stdout: '', stderr: 'ssh: connect to host github.com port 22: Connection timed out', failed: true };
        },
        sleep: async () => {},
      }),
  };
});

async function sourceRepo(tmps: string[]): Promise<string> {
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

describe('fetchLanding retry is opt-in (VS-717 revision)', () => {
  const tmps: string[] = [];
  let h: TestHarness;
  let projects: ProjectsService;

  afterEach(async () => { await h.services.jobs?.stop(); h.cleanup(); while (tmps.length) rmSync(tmps.pop()!, { recursive: true, force: true }); });

  async function seededProject(): Promise<{ id: string }> {
    h = makeHarness({ bare: true });
    h.services.tickets = { create: vi.fn(() => ({ id: 't1' })) } as never;
    h.services.jobs = createJobsService(h.ctx, h.deps);
    projects = createProjectsService(h.ctx, h.deps);
    const src = await sourceRepo(tmps);
    const cfg = { id: 'web', url: src, defaultBranch: 'main', maxWorkers: 4, warmPaths: [], openspec: { enabled: false }, knowledgeRepo: { enabled: false }, policies: {} } as ProjectConfig;
    const project = await projects.add({ kind: 'human', id: 'victor' }, cfg);
    fetchAttempts = 0;
    return project;
  }

  it('checkSync makes exactly one fetch attempt on a transient error', async () => {
    const project = await seededProject();
    await expect(projects.checkSync(project.id)).rejects.toThrow(/git fetch failed/);
    expect(fetchAttempts).toBe(1);
  });

  it('a bare fetch() with no options makes exactly one fetch attempt on a transient error', async () => {
    const project = await seededProject();
    await expect(projects.fetch(project.id)).rejects.toThrow(/git fetch failed/);
    expect(fetchAttempts).toBe(1);
  });

  it('fetch(id, { retryTransient: true }) retries a transient error up to the bound', async () => {
    const project = await seededProject();
    await expect(projects.fetch(project.id, { retryTransient: true })).rejects.toThrow(/git fetch failed after 3 attempts/);
    expect(fetchAttempts).toBe(3);
  });
});
