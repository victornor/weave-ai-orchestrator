/**
 * The `gh` forge's pull-request listing (VS-97).
 *
 * Two halves. The mapping is tested against recorded `gh --json` output run through the exported
 * pure functions; the command paths are tested against a fake `gh` on PATH, so a non-zero exit and
 * a malformed body are real subprocess results and not a stubbed promise. Nothing here reaches
 * GitHub: the fake prints whatever the test wrote into a file next to it.
 */
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GhForge, checkTally, pullRequestDetailFromGh, pullRequestFromGh } from './gh.js';

let home: string;

/**
 * A `gh` that prints `stdout.txt` and exits with the contents of `exit.txt`. Its own arguments go to
 * `args.txt`, so a test can assert what was asked for without a process double.
 */
function fakeGh(stdout: string, exitCode = 0, stderr = ''): void {
  const dir = join(home, 'bin');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'stdout.txt'), stdout);
  writeFileSync(join(dir, 'stderr.txt'), stderr);
  const path = join(dir, 'gh');
  writeFileSync(path, `#!/bin/sh\nprintf '%s' "$@" > "${dir}/args.txt"\ncat "${dir}/stdout.txt"\ncat "${dir}/stderr.txt" >&2\nexit ${exitCode}\n`);
  chmodSync(path, 0o755);
  // Prepended, not replaced: the script itself needs `cat`, and this dir's `gh` still wins.
  vi.stubEnv('PATH', `${dir}${delimiter}${process.env['PATH'] ?? ''}`);
}

const args = (): string => readFileSync(join(home, 'bin', 'args.txt'), 'utf8');

/** One pull request as `gh pr list --json …` prints it, fields and all. */
const MERGED = {
  number: 77, title: 'Clicking a project opens its overview', url: 'https://github.com/acme/api/pull/77',
  author: { login: 'victornor' }, state: 'MERGED', isDraft: false,
  headRefName: 'ac/vs-95-clicking-a-project', baseRefName: 'main',
  createdAt: '2026-09-07T10:00:00Z', updatedAt: '2026-09-07T14:00:00Z',
  mergedAt: '2026-09-07T14:00:00Z', closedAt: '2026-09-07T14:00:00Z',
  additions: 900, deletions: 40, changedFiles: 21,
  statusCheckRollup: [
    { name: 'test', workflowName: 'ci', status: 'COMPLETED', conclusion: 'SUCCESS', detailsUrl: 'https://ci/1' },
    { name: 'lint', workflowName: 'ci', status: 'COMPLETED', conclusion: 'SKIPPED', detailsUrl: 'https://ci/2' },
  ],
  reviewDecision: 'APPROVED', mergeCommit: { oid: '6707e61abcdef' },
};

/** An open draft whose only check is a legacy commit status, and which nobody has reviewed. */
const DRAFT = {
  number: 78, title: 'Draft: the commit graph', url: 'https://github.com/acme/api/pull/78',
  author: { login: 'someone' }, state: 'OPEN', isDraft: true,
  headRefName: 'spike/graph', baseRefName: 'main',
  createdAt: '2026-09-07T11:00:00Z', updatedAt: '2026-09-07T11:30:00Z',
  mergedAt: null, closedAt: null,
  additions: 12, deletions: 3, changedFiles: 2,
  statusCheckRollup: [{ context: 'legacy/status', state: 'FAILURE', targetUrl: 'https://ci/3' }],
  reviewDecision: null, mergeCommit: null,
};

const GH_LIST = [MERGED, DRAFT];

beforeEach(() => { home = mkdtempSync(join(tmpdir(), 'ac-gh-')); });
afterEach(() => { vi.unstubAllEnvs(); rmSync(home, { recursive: true, force: true }); });

describe('mapping gh JSON to a pull request', () => {
  it('carries every field a list entry shows', () => {
    const pr = pullRequestFromGh(MERGED);
    expect(pr).toMatchObject({
      number: 77, title: 'Clicking a project opens its overview', author: 'victornor',
      state: 'merged', isDraft: false, headRefName: 'ac/vs-95-clicking-a-project', baseRefName: 'main',
      additions: 900, deletions: 40, changedFiles: 21,
      checks: 'success', reviewDecision: 'approved', mergeCommit: '6707e61abcdef',
      mergedAt: '2026-09-07T14:00:00Z',
    });
  });

  it('reads a draft, a failing legacy status context and an absent review', () => {
    const pr = pullRequestFromGh(DRAFT);
    expect(pr).toMatchObject({ number: 78, state: 'open', isDraft: true, checks: 'failure', reviewDecision: null, mergeCommit: null });
  });

  it('reports no checks when the forge reported none', () => {
    expect(pullRequestFromGh({ ...DRAFT, statusCheckRollup: [] }).checks).toBe('none');
    expect(pullRequestFromGh({ ...DRAFT, statusCheckRollup: null }).checks).toBe('none');
  });

  it('is pending while any check is still running', () => {
    const rollup = [{ name: 'a', status: 'COMPLETED', conclusion: 'SUCCESS' }, { name: 'b', status: 'IN_PROGRESS' }];
    expect(pullRequestFromGh({ ...DRAFT, statusCheckRollup: rollup }).checks).toBe('pending');
  });

  it('tallies the checks that passed out of those reported (VS-328)', () => {
    const rollup = [
      { name: 'a', status: 'COMPLETED', conclusion: 'SUCCESS' },
      { name: 'b', status: 'COMPLETED', conclusion: 'NEUTRAL' },
      { name: 'c', status: 'COMPLETED', conclusion: 'FAILURE' },
      { name: 'd', status: 'IN_PROGRESS' },
    ];
    expect(checkTally(rollup)).toEqual({ passed: 2, total: 4 });
    expect(checkTally([])).toBeUndefined();
    expect(checkTally(null)).toBeUndefined();
  });

  it('survives a pull request gh answered with almost nothing', () => {
    const pr = pullRequestFromGh({});
    expect(pr).toMatchObject({ number: 0, title: '', author: null, state: 'open', isDraft: false, additions: 0, checks: 'none' });
  });

  it('adds the description, the changed files and each check by name to a detail', () => {
    const detail = pullRequestDetailFromGh({
      ...MERGED,
      body: '## Why\n\nBecause.',
      files: [{ path: 'packages/ui/src/routes/project/ProjectOverview.tsx', additions: 120, deletions: 4 }, { path: 'README.md', additions: 1, deletions: 1 }],
    });
    expect(detail.body).toContain('Because.');
    expect(detail.files).toEqual([
      { path: 'packages/ui/src/routes/project/ProjectOverview.tsx', additions: 120, deletions: 4 },
      { path: 'README.md', additions: 1, deletions: 1 },
    ]);
    expect(detail.checkRuns).toEqual([
      { name: 'ci / test', state: 'success', url: 'https://ci/1' },
      { name: 'ci / lint', state: 'success', url: 'https://ci/2' },
    ]);
  });

  it('names a bare commit status by its context', () => {
    const detail = pullRequestDetailFromGh(DRAFT);
    expect(detail.checkRuns).toEqual([{ name: 'legacy/status', state: 'failure', url: 'https://ci/3' }]);
  });
});

describe('listPullRequests', () => {
  it('asks gh for every state and maps what it prints', async () => {
    fakeGh(JSON.stringify(GH_LIST));
    const prs = await new GhForge().listPullRequests(home, { limit: 60 });
    expect(prs.map((p) => p.number)).toEqual([77, 78]);
    expect(args()).toContain('--state');
    expect(args()).toContain('all');
    expect(args()).toContain('60');
  });

  it('throws when gh fails rather than reporting an empty repository', async () => {
    fakeGh('', 1, 'could not determine the current repository');
    await expect(new GhForge().listPullRequests(home)).rejects.toThrow(/gh pr list failed/);
  });

  it('throws when gh prints something that is not JSON', async () => {
    fakeGh('not json at all');
    await expect(new GhForge().listPullRequests(home)).rejects.toThrow(/invalid JSON/);
  });

  it('throws when gh prints JSON that is not a list', async () => {
    fakeGh('{"number":1}');
    await expect(new GhForge().listPullRequests(home)).rejects.toThrow(/did not return a list/);
  });
});

describe('pullRequest', () => {
  it('reads one pull request in full', async () => {
    fakeGh(JSON.stringify({ ...MERGED, body: 'hello', files: [{ path: 'a.ts', additions: 2, deletions: 1 }] }));
    const detail = await new GhForge().pullRequest(home, 77);
    expect(detail).toMatchObject({ number: 77, body: 'hello' });
    expect(detail?.files).toEqual([{ path: 'a.ts', additions: 2, deletions: 1 }]);
  });

  it('answers null for a number the repository does not have', async () => {
    fakeGh('', 1, 'no pull requests found for branch');
    await expect(new GhForge().pullRequest(home, 999)).resolves.toBeNull();
  });

  it('throws on any other gh failure', async () => {
    fakeGh('', 1, 'HTTP 500');
    await expect(new GhForge().pullRequest(home, 1)).rejects.toThrow(/gh pr view failed/);
  });

  it('throws when gh prints something that is not JSON', async () => {
    fakeGh('<html>');
    await expect(new GhForge().pullRequest(home, 1)).rejects.toThrow(/invalid JSON/);
  });
});

describe('pullRequestDiff', () => {
  it('returns the unified diff exactly as gh printed it', async () => {
    const diff = 'diff --git a/a.ts b/a.ts\nindex 1..2 100644\n--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-old\n+new';
    fakeGh(`${diff}\n`);
    const text = await new GhForge().pullRequestDiff(home, 77);
    expect(text).toBe(diff);
    expect(args()).toContain('diff');
    expect(args()).toContain('77');
  });

  it('answers null for a number the repository does not have', async () => {
    fakeGh('', 1, 'no pull requests found for branch');
    await expect(new GhForge().pullRequestDiff(home, 999)).resolves.toBeNull();
  });

  it('throws on any other gh failure', async () => {
    fakeGh('', 1, 'HTTP 500');
    await expect(new GhForge().pullRequestDiff(home, 1)).rejects.toThrow(/gh pr diff failed/);
  });
});
