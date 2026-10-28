import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { newId, nowIso } from '@weave-ai/db';
import type { WorkerGitIdentity } from '@weave-ai/shared';
import { makeHarness, type TestHarness } from '../testing/context.js';
import { git } from '../util/git.js';
import { reportInheritedWorkerIdentities, workerIdentityWarningKey } from './identity.js';

describe('inherited worker identity warning (VS-874)', () => {
  let h: TestHarness;

  beforeEach(() => {
    h = makeHarness({ bare: true });
  });
  afterEach(() => h.cleanup());

  async function addProject(over: { workerIdentity?: WorkerGitIdentity | null; cloneEmail?: string | null } = {}): Promise<string> {
    const id = newId();
    const slug = 'web';
    const clonePath = join(h.ctx.paths.projects, slug);
    mkdirSync(clonePath, { recursive: true });
    await git(['init', '-b', 'main'], clonePath);
    if (over.cloneEmail !== null) {
      await git(['config', 'user.name', 'Victor Nor'], clonePath);
      await git(['config', 'user.email', over.cloneEmail ?? '1-1@hotmail.dk'], clonePath);
    }
    const now = nowIso();
    h.db.insert('projects', {
      id, workspaceId: h.workspaceId, slug, name: 'Web', gitUrl: 'git@github.com:acme/web.git', defaultBranch: 'main',
      clonePath, maxWorkers: 4, worktreeProvider: 'git', openspecEnabled: 1, policiesJson: {}, status: 'ready',
      ...(over.workerIdentity ? { workerIdentityJson: over.workerIdentity } : {}),
      createdAt: now, updatedAt: now,
    });
    return id;
  }

  it('reports a personal clone identity once and never again', async () => {
    const projectId = await addProject();

    const first = await reportInheritedWorkerIdentities(h.ctx);
    expect(first).toEqual([{ projectId, slug: 'web', cloneEmail: '1-1@hotmail.dk' }]);
    expect(h.db.get<{ value: string }>('SELECT value FROM meta WHERE key = ?', [workerIdentityWarningKey(projectId)])).toBeTruthy();

    expect(await reportInheritedWorkerIdentities(h.ctx)).toEqual([]);
  });

  it('is silent when the workspace configures a worker identity', async () => {
    await addProject();
    h.ctx.config = { ...h.ctx.config, defaults: { ...h.ctx.config.defaults, workerGitIdentity: { name: 'Acme Bot', email: 'bot@acme.test' } } };
    expect(await reportInheritedWorkerIdentities(h.ctx)).toEqual([]);
  });

  it("is silent when the project configures its own identity", async () => {
    await addProject({ workerIdentity: { name: 'Project Bot', email: 'project@acme.test' } });
    expect(await reportInheritedWorkerIdentities(h.ctx)).toEqual([]);
  });

  it('is silent when the clone already commits under a GitHub noreply address', async () => {
    await addProject({ cloneEmail: '8156679+victornor@users.noreply.github.com' });
    expect(await reportInheritedWorkerIdentities(h.ctx)).toEqual([]);
  });

  it('is silent when the clone has no identity at all', async () => {
    await addProject({ cloneEmail: null });
    expect(await reportInheritedWorkerIdentities(h.ctx)).toEqual([]);
  });
});
