/**
 * A pull request's diff, per file (VS-107): the forge first, the daemon's own clone otherwise, cached
 * and parsed once per pull request and sliced per file from then on. No test calls GitHub or launches
 * a real coding CLI — the forge is a counting double, and the clone fallback runs against a real,
 * scratch git repository on disk.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { newId } from '@agent-conductor/db';
import type { ForgeAdapter, ForgePullRequest } from '@agent-conductor/plugin-sdk';
import { makeHarness, type TestHarness } from '../testing/context.js';
import { git } from '../util/git.js';
import { createPullRequestsService } from './index.js';
import type { CoreServices, MergeQueueView, PullRequestsService } from '../api.js';

const NOW = Date.parse('2026-09-07T12:00:00.000Z');

function pr(over: Partial<ForgePullRequest> & { number: number }): ForgePullRequest {
  return {
    title: `PR ${over.number}`, url: `https://github.com/acme/api/pull/${over.number}`, author: 'victornor',
    state: 'open', isDraft: false, headRefName: 'ac/tst-1-topic', baseRefName: 'main',
    createdAt: new Date(NOW).toISOString(), updatedAt: new Date(NOW).toISOString(), mergedAt: null, closedAt: null,
    additions: 1, deletions: 1, changedFiles: 1, checks: 'success', reviewDecision: null, mergeCommit: null,
    ...over,
  };
}

/** A forge whose `pullRequestDiff` is scripted; omit `diff` to make it `unsupported` for diffs, as `GhForge` never is but a third-party forge might be. */
function fakeForge(list: ForgePullRequest[], diff?: string | (() => Promise<string | null>)): ForgeAdapter & { diffCalls: number; listPullRequests: () => Promise<ForgePullRequest[]> } {
  const f = {
    id: 'github',
    diffCalls: 0,
    detect: async () => true,
    prState: async () => ({ state: 'open' as const }),
    mergePr: async () => ({}),
    listPullRequests: async () => list,
    pullRequest: async () => null,
    ...(diff !== undefined ? {
      pullRequestDiff: async (): Promise<string | null> => {
        f.diffCalls += 1;
        return typeof diff === 'function' ? diff() : diff;
      },
    } : {}),
  };
  return f;
}

async function initRepo(dir: string): Promise<void> {
  mkdirSync(dir, { recursive: true });
  await git(['init', '-b', 'main'], dir);
  await git(['config', 'user.email', 'test@example.com'], dir);
  await git(['config', 'user.name', 'Test'], dir);
}
async function commitFile(dir: string, name: string, content: string, message: string): Promise<void> {
  writeFileSync(`${dir}/${name}`, content, 'utf8');
  await git(['add', '.'], dir);
  await git(['commit', '-m', message], dir);
}

describe('pull request diffs', () => {
  let h: TestHarness;
  let service: PullRequestsService;
  let clonePath: string;

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    h = makeHarness();
    clonePath = h.db.get<{ clonePath: string }>('SELECT clone_path FROM projects WHERE id = ?', [h.projectId])!.clonePath;
    await initRepo(clonePath);
    h.services.projects = { get: (id: string) => h.db.get('SELECT * FROM projects WHERE id = ? OR slug = ?', [id, id]) } as unknown as CoreServices['projects'];
    const queue: MergeQueueView = { projectId: h.projectId, concurrency: 1, active: [], waiting: [], recent: [] };
    h.services.tickets = { mergeQueue: { forProject: () => queue } } as unknown as CoreServices['tickets'];
  });
  afterEach(() => { vi.useRealTimers(); h.cleanup(); });

  const DIFF = [
    'diff --git a/a.ts b/a.ts', 'index 1111111..2222222 100644', '--- a/a.ts', '+++ b/a.ts',
    '@@ -1,2 +1,2 @@', ' unchanged', '-old line', '+new line',
  ].join('\n');

  describe('served from the forge', () => {
    beforeEach(() => {
      h.ctx.registries.forges.set('github', fakeForge([pr({ number: 5 })], DIFF));
      service = createPullRequestsService(h.ctx, h.deps);
    });

    it('lists the manifest with no hunks', async () => {
      const out = await service.diffFiles(h.projectId, 5);
      expect(out).toMatchObject({ available: true, reason: null, files: [{ path: 'a.ts', status: 'modified', additions: 1, deletions: 1, binary: false, tooLarge: false }] });
      expect((out.files[0] as unknown as { hunks?: unknown }).hunks).toBeUndefined();
    });

    it('reads one file\'s hunks', async () => {
      const out = await service.diffFile(h.projectId, 5, 'a.ts');
      expect(out.available).toBe(true);
      expect(out.file?.hunks).toHaveLength(1);
      expect(out.file?.hunks[0]?.lines.map((l) => l.text)).toEqual(['unchanged', 'old line', 'new line']);
    });

    it('answers available with a null file for a path the diff does not have', async () => {
      const out = await service.diffFile(h.projectId, 5, 'never-changed.ts');
      expect(out).toMatchObject({ available: true, reason: null, file: null });
    });

    it('answers available with no files for a pull request number the forge does not list', async () => {
      const out = await service.diffFiles(h.projectId, 404);
      expect(out).toMatchObject({ available: true, files: [] });
    });

    it('reads the forge once and answers a second request from the cache', async () => {
      const forge = h.ctx.registries.forges.get('github') as ReturnType<typeof fakeForge>;
      await service.diffFiles(h.projectId, 5);
      await service.diffFile(h.projectId, 5, 'a.ts');
      expect(forge.diffCalls).toBe(1);
    });

    it('drops the cached diff on the same events that drop the pull request list', async () => {
      const forge = h.ctx.registries.forges.get('github') as ReturnType<typeof fakeForge>;
      const ticketId = newId();
      h.db.insert('tickets', {
        id: ticketId, workspaceId: h.workspaceId, projectId: h.projectId, number: 1, identifier: 'TST-1',
        kind: 'task', title: 'A ticket', status: 'in_review', createdByKind: 'agent', createdAt: 't0', updatedAt: 't0',
      });

      await service.diffFiles(h.projectId, 5);
      expect(forge.diffCalls).toBe(1);

      h.ctx.events.emit('ticket.merged', 'ticket', ticketId, { ticketId });
      await vi.advanceTimersByTimeAsync(0);

      await service.diffFiles(h.projectId, 5);
      expect(forge.diffCalls).toBe(2);
    });
  });

  it('falls back to the clone when the forge has no diff method, using the local worker branch', async () => {
    await commitFile(clonePath, 'a.ts', 'unchanged\nold line\n', 'first');
    await git(['checkout', '-b', 'ac/tst-1-topic'], clonePath);
    await commitFile(clonePath, 'a.ts', 'unchanged\nnew line\n', 'change');
    await git(['checkout', 'main'], clonePath);

    h.ctx.registries.forges.set('github', fakeForge([pr({ number: 9 })])); // no `diff` script: pullRequestDiff is absent
    service = createPullRequestsService(h.ctx, h.deps);

    const out = await service.diffFiles(h.projectId, 9);
    expect(out).toMatchObject({ available: true, reason: null });
    expect(out.files[0]).toMatchObject({ path: 'a.ts', status: 'modified' });
  });

  it('falls back to the clone when the forge throws, using the local worker branch', async () => {
    await commitFile(clonePath, 'a.ts', 'one\n', 'first');
    await git(['checkout', '-b', 'ac/tst-1-topic'], clonePath);
    await commitFile(clonePath, 'a.ts', 'two\n', 'change');
    await git(['checkout', 'main'], clonePath);

    h.ctx.registries.forges.set('github', fakeForge([pr({ number: 9 })], async () => { throw new Error('rate limited'); }));
    service = createPullRequestsService(h.ctx, h.deps);

    const out = await service.diffFiles(h.projectId, 9);
    expect(out.available).toBe(true);
    expect(out.files.map((f) => f.path)).toEqual(['a.ts']);
  });

  it('reports no_local_branch when neither the forge nor the clone can answer', async () => {
    h.ctx.registries.forges.set('github', fakeForge([pr({ number: 9, headRefName: 'never-fetched' })]));
    service = createPullRequestsService(h.ctx, h.deps);

    const out = await service.diffFiles(h.projectId, 9);
    expect(out).toMatchObject({ available: false, reason: 'no_local_branch' });
  });

  describe('expanding a collapsed region', () => {
    beforeEach(async () => {
      await commitFile(clonePath, 'a.ts', ['one', 'two', 'three', 'four', 'five', ''].join('\n'), 'first');
      h.ctx.registries.forges.set('github', fakeForge([pr({ number: 5, baseRefName: 'main' })], DIFF));
      service = createPullRequestsService(h.ctx, h.deps);
    });

    it('reads a mid-file range from the base revision', async () => {
      const out = await service.diffContext(h.projectId, 5, 'a.ts', 2, 4);
      expect(out).toMatchObject({ available: true, lines: ['two', 'three', 'four'] });
    });

    it('clamps a range past the end of the file', async () => {
      const out = await service.diffContext(h.projectId, 5, 'a.ts', 4, 100);
      expect(out).toMatchObject({ available: true, lines: ['four', 'five'] });
    });

    it('answers empty for a file the base revision does not have', async () => {
      const out = await service.diffContext(h.projectId, 5, 'never-existed.ts', 1, 10);
      expect(out).toMatchObject({ available: true, lines: [] });
    });
  });
});
