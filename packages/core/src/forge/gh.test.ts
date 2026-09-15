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
import { GhForge, checkTally, parsePullRequestUrl, pullRequestDetailFromGh, pullRequestFromGh, pullRequestRunsFromGh, repoVisibilityFromGh, runnerLabelsFromGh, workflowCountFromGh } from './gh.js';

let home: string;

/**
 * A `gh` that prints `stdout.txt` and exits with the contents of `exit.txt`. Its own arguments go to
 * `args.txt`, one per line, so a test can assert the exact argv without a process double.
 */
function fakeGh(stdout: string, exitCode = 0, stderr = ''): void {
  const dir = join(home, 'bin');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'stdout.txt'), stdout);
  writeFileSync(join(dir, 'stderr.txt'), stderr);
  const path = join(dir, 'gh');
  writeFileSync(path, `#!/bin/sh\nprintf '%s\\n' "$@" > "${dir}/args.txt"\ncat "${dir}/stdout.txt"\ncat "${dir}/stderr.txt" >&2\nexit ${exitCode}\n`);
  chmodSync(path, 0o755);
  // Prepended, not replaced: the script itself needs `cat`, and this dir's `gh` still wins.
  vi.stubEnv('PATH', `${dir}${delimiter}${process.env['PATH'] ?? ''}`);
}

const args = (): string => readFileSync(join(home, 'bin', 'args.txt'), 'utf8');
/** The exact argv the fake `gh` was handed, one argument per element. */
const argsList = (): string[] => args().trim().split('\n');

/**
 * A `gh` that answers each invocation with its own stdout/stderr/exit, so a multi-call method
 * (`rerunChecks`) can be driven through every step. Each call's argv is appended to `args.txt`
 * between `---call---` lines; `calls()` splits them back apart.
 */
function fakeGhSequence(calls: Array<{ stdout?: string; stderr?: string; exitCode?: number }>): void {
  const dir = join(home, 'bin');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'args.txt'), '');
  writeFileSync(join(dir, 'n'), '0');
  calls.forEach((c, i) => {
    writeFileSync(join(dir, `out-${i}`), c.stdout ?? '');
    writeFileSync(join(dir, `err-${i}`), c.stderr ?? '');
    writeFileSync(join(dir, `code-${i}`), String(c.exitCode ?? 0));
  });
  const path = join(dir, 'gh');
  writeFileSync(path, `#!/bin/sh
d="${dir}"
n=$(cat "$d/n" 2>/dev/null || echo 0)
printf '%s\\n' "$@" >> "$d/args.txt"
printf '%s\\n' '---call---' >> "$d/args.txt"
cat "$d/out-$n" 2>/dev/null
cat "$d/err-$n" 2>/dev/null >&2
echo $((n+1)) > "$d/n"
exit "$(cat "$d/code-$n" 2>/dev/null || echo 0)"
`);
  chmodSync(path, 0o755);
  vi.stubEnv('PATH', `${dir}${delimiter}${process.env['PATH'] ?? ''}`);
}

/** The argv of each invocation the sequence fake served, one flat argument list per call. */
const calls = (): string[][] =>
  readFileSync(join(home, 'bin', 'args.txt'), 'utf8')
    .split('---call---\n')
    .slice(0, -1)
    .map((chunk) => chunk.trim().split('\n'));

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
  headRefOid: 'abc123def456',
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

  // VS-466: the merge gate read an all-skipped draft run as a pass, so four landings reached main with
  // no CI. These are the real rollups `gh pr view --json statusCheckRollup` returned for the two heads.
  it('reads an all-skipped rollup as none, never a pass (VS-466)', () => {
    const rollup = ['lint', 'typecheck', 'test-core', 'test-ui', 'test-core (shard ${{ matrix.shard }}/4)']
      .map((name) => ({ name, workflowName: 'CI', status: 'COMPLETED', conclusion: 'SKIPPED' }));
    // PR #380 (VS-446), head 3996ecd96e: five completed/skipped runs, one skipped workflow run.
    expect(pullRequestFromGh({ ...DRAFT, statusCheckRollup: rollup }).checks).toBe('none');
  });

  it('accepts a rollup whose skipped duplicates sit beside a real success (VS-466)', () => {
    // PR #377 (VS-445), head 37de6fcf58: each name appears twice, once skipped (the draft run) and
    // once success (the run on the head that landed). The skipped copies must not reject it.
    const real = ['lint', 'typecheck', 'test-ui', 'test-core'].map((name) => ({ name, status: 'COMPLETED', conclusion: 'SUCCESS' }));
    const shards = [1, 2, 3, 4].map((n) => ({ name: `test-core (shard ${n}/4)`, status: 'COMPLETED', conclusion: 'SUCCESS' }));
    const skipped = ['lint', 'typecheck', 'test-ui', 'test-core', 'test-core (shard ${{ matrix.shard }}/4)']
      .map((name) => ({ name, status: 'COMPLETED', conclusion: 'SKIPPED' }));
    expect(pullRequestFromGh({ ...DRAFT, statusCheckRollup: [...skipped, ...real, ...shards] }).checks).toBe('success');
  });

  it('does not read a cancelled, neutral or in-progress check as a pass (VS-466)', () => {
    const pass = { name: 'lint', status: 'COMPLETED', conclusion: 'SUCCESS' };
    for (const conclusion of ['CANCELLED', 'NEUTRAL', 'STALE']) {
      const rollup = [pass, { name: 'typecheck', status: 'COMPLETED', conclusion }];
      expect(pullRequestFromGh({ ...DRAFT, statusCheckRollup: rollup }).checks).toBe('pending');
    }
    expect(pullRequestFromGh({ ...DRAFT, statusCheckRollup: [pass, { name: 'typecheck', status: 'IN_PROGRESS' }] }).checks).toBe('pending');
  });

  it('tallies the checks that passed out of those reported (VS-328, VS-466)', () => {
    const rollup = [
      { name: 'a', status: 'COMPLETED', conclusion: 'SUCCESS' },
      { name: 'b', status: 'COMPLETED', conclusion: 'NEUTRAL' },
      { name: 'c', status: 'COMPLETED', conclusion: 'FAILURE' },
      { name: 'd', status: 'IN_PROGRESS' },
    ];
    // VS-466: a neutral or skipped check is no longer counted as a pass; only a completed success is.
    expect(checkTally(rollup)).toEqual({ passed: 1, total: 4 });
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
    expect(detail.headSha).toBe('abc123def456');
    expect(detail.files).toEqual([
      { path: 'packages/ui/src/routes/project/ProjectOverview.tsx', additions: 120, deletions: 4 },
      { path: 'README.md', additions: 1, deletions: 1 },
    ]);
    expect(detail.checkRuns).toEqual([
      { name: 'ci / test', state: 'success', url: 'https://ci/1' },
      // VS-466: a skipped check is no longer shown as a success.
      { name: 'ci / lint', state: 'none', url: 'https://ci/2' },
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
    expect(detail).toMatchObject({ number: 77, body: 'hello', headSha: 'abc123def456' });
    expect(detail?.files).toEqual([{ path: 'a.ts', additions: 2, deletions: 1 }]);
    expect(args()).toContain('headRefOid');
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

describe('parsePullRequestUrl', () => {
  it('reads the number out of the URL gh pr create prints on its own', () => {
    expect(parsePullRequestUrl('https://github.com/acme/api/pull/283\n')).toEqual({ url: 'https://github.com/acme/api/pull/283', number: 283 });
  });

  it('finds the URL when gh prints it among other lines', () => {
    expect(parsePullRequestUrl('warning: something\nhttps://github.com/acme/api/pull/7\n')).toEqual({ url: 'https://github.com/acme/api/pull/7', number: 7 });
  });

  it('returns null when there is no pull request URL', () => {
    expect(parsePullRequestUrl('created pull request\n')).toBeNull();
    expect(parsePullRequestUrl('')).toBeNull();
  });
});

describe('createPullRequest', () => {
  it('passes only the flags gh pr create accepts and parses the URL it prints', async () => {
    fakeGh('https://github.com/acme/api/pull/283\n');
    const pr = await new GhForge().createPullRequest(home, { branch: 'ac/archive-x', base: 'main', title: 'chore(openspec): archive x', body: 'Backfill.' });
    expect(pr).toEqual({ url: 'https://github.com/acme/api/pull/283', number: 283 });
    expect(argsList()).toEqual(['pr', 'create', '--base', 'main', '--head', 'ac/archive-x', '--title', 'chore(openspec): archive x', '--body', 'Backfill.']);
    expect(argsList()).not.toContain('--json');
  });

  it('adds --draft only when a draft is asked for (VS-393)', async () => {
    fakeGh('https://github.com/acme/api/pull/283\n');
    await new GhForge().createPullRequest(home, { branch: 'b', base: 'main', title: 't', draft: true });
    expect(argsList()).toContain('--draft');
    fakeGh('https://github.com/acme/api/pull/284\n');
    await new GhForge().createPullRequest(home, { branch: 'b', base: 'main', title: 't' });
    expect(argsList()).not.toContain('--draft');
  });

  it('throws when gh fails', async () => {
    fakeGh('', 1, 'a pull request for branch already exists');
    await expect(new GhForge().createPullRequest(home, { branch: 'b', base: 'main', title: 't' })).rejects.toThrow(/gh pr create failed/);
  });

  it('throws when gh prints no usable pull request URL', async () => {
    fakeGh('something unexpected\n');
    await expect(new GhForge().createPullRequest(home, { branch: 'b', base: 'main', title: 't' })).rejects.toThrow(/did not print a pull request URL/);
  });
});

describe('markPullRequestReady', () => {
  it('runs gh pr ready and reports the draft was brought out of draft', async () => {
    fakeGh('✓ Pull request acme/api#283 is marked as "ready for review"\n');
    await expect(new GhForge().markPullRequestReady(home, 'https://github.com/acme/api/pull/283')).resolves.toEqual({ changed: true });
    expect(argsList()).toEqual(['pr', 'ready', 'https://github.com/acme/api/pull/283']);
  });

  it('treats an already-ready pull request as a no-op, not an error', async () => {
    fakeGh('', 1, '! Pull request acme/api#283 is already ready for review\n');
    await expect(new GhForge().markPullRequestReady(home, 'https://github.com/acme/api/pull/283')).resolves.toEqual({ changed: false });
  });

  it('throws when gh fails for a real reason', async () => {
    fakeGh('', 1, 'HTTP 500: Internal Server Error\n');
    await expect(new GhForge().markPullRequestReady(home, 'https://github.com/acme/api/pull/283')).rejects.toThrow(/gh pr ready failed/);
  });
});

describe('hasCiWorkflows (VS-393)', () => {
  it('reports false for a repository with no workflows and true for one with any', async () => {
    fakeGh('0');
    await expect(new GhForge().hasCiWorkflows(home)).resolves.toBe(false);
    expect(argsList()).toEqual(['api', 'repos/{owner}/{repo}/actions/workflows', '--jq', '.total_count']);
    fakeGh('3');
    await expect(new GhForge().hasCiWorkflows(home)).resolves.toBe(true);
  });

  it('answers null when gh fails or the count is not a number', async () => {
    fakeGh('', 1, 'HTTP 404');
    await expect(new GhForge().hasCiWorkflows(home)).resolves.toBeNull();
    fakeGh('not-a-number');
    await expect(new GhForge().hasCiWorkflows(home)).resolves.toBeNull();
  });

  it('maps a count without gh', () => {
    expect(workflowCountFromGh('0\n')).toBe(false);
    expect(workflowCountFromGh('12')).toBe(true);
    expect(workflowCountFromGh('')).toBeNull();
    expect(workflowCountFromGh('  ')).toBeNull();
  });
});

describe('pullRequestForBranch', () => {
  it('asks only for open pull requests on the branch, with the supported JSON flag', async () => {
    fakeGh(JSON.stringify([{ url: 'https://github.com/acme/api/pull/283', number: 283 }]));
    await expect(new GhForge().pullRequestForBranch(home, 'ac/archive-x')).resolves.toEqual({ url: 'https://github.com/acme/api/pull/283', number: 283 });
    expect(argsList()).toEqual(['pr', 'list', '--head', 'ac/archive-x', '--state', 'open', '--limit', '1', '--json', 'url,number']);
  });

  it('answers null when there is no open pull request on the branch', async () => {
    fakeGh('[]');
    await expect(new GhForge().pullRequestForBranch(home, 'ac/archive-x')).resolves.toBeNull();
  });

  it('throws when gh fails rather than reporting no pull request', async () => {
    fakeGh('', 1, 'HTTP 500');
    await expect(new GhForge().pullRequestForBranch(home, 'ac/archive-x')).rejects.toThrow(/gh pr list failed/);
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

describe('prState', () => {
  it('reports the pull request head when gh returns one (VS-365)', async () => {
    fakeGh(JSON.stringify({ state: 'OPEN', headRefOid: 'abc123def456' }));
    const state = await new GhForge().prState(home, 'https://github.com/acme/api/pull/77');
    expect(state).toMatchObject({ state: 'open', headSha: 'abc123def456' });
    expect(args()).toContain('headRefOid');
  });

  it('omits the head when the forge reports none', async () => {
    fakeGh(JSON.stringify({ state: 'OPEN' }));
    const state = await new GhForge().prState(home, 'https://github.com/acme/api/pull/77');
    expect(state.headSha).toBeUndefined();
  });

  it('maps mergeStateStatus and isDraft, and asks gh for them (VS-391)', async () => {
    fakeGh(JSON.stringify({ state: 'OPEN', mergeStateStatus: 'BLOCKED', isDraft: true }));
    const state = await new GhForge().prState(home, 'https://github.com/acme/api/pull/77');
    expect(state).toMatchObject({ mergeState: 'blocked', isDraft: true });
    expect(args()).toContain('mergeStateStatus');
    expect(args()).toContain('isDraft');
  });

  it('omits mergeState when gh reports none (VS-391)', async () => {
    fakeGh(JSON.stringify({ state: 'OPEN' }));
    const state = await new GhForge().prState(home, 'https://github.com/acme/api/pull/77');
    expect(state.mergeState).toBeUndefined();
    expect(state.isDraft).toBe(false);
  });

  it('names each reported check beside the rolled-up tally (VS-481)', async () => {
    fakeGh(JSON.stringify({
      state: 'OPEN',
      statusCheckRollup: [
        { name: 'build', status: 'COMPLETED', conclusion: 'SUCCESS' },
        { name: 'lint', status: 'IN_PROGRESS' },
        { name: 'typecheck', status: 'COMPLETED', conclusion: 'FAILURE' },
      ],
    }));
    const state = await new GhForge().prState(home, 'https://github.com/acme/api/pull/77');
    expect(state.ciState).toBe('failure');
    expect(state.checks).toEqual({ passed: 1, total: 3 });
    expect(state.checkDetails).toEqual([
      { name: 'build', state: 'success', url: null },
      { name: 'lint', state: 'pending', url: null },
      { name: 'typecheck', state: 'failure', url: null },
    ]);
  });

  it('reports no check detail when the forge reports no checks (VS-481)', async () => {
    fakeGh(JSON.stringify({ state: 'OPEN' }));
    const state = await new GhForge().prState(home, 'https://github.com/acme/api/pull/77');
    expect(state.checkDetails).toEqual([]);
  });
});

describe('repoInfo (VS-359)', () => {
  it('maps gh visibility PUBLIC to not private, PRIVATE and INTERNAL to private', () => {
    expect(repoVisibilityFromGh('{"visibility":"PUBLIC"}')).toEqual({ private: false });
    expect(repoVisibilityFromGh('{"visibility":"PRIVATE"}')).toEqual({ private: true });
    expect(repoVisibilityFromGh('{"visibility":"INTERNAL"}')).toEqual({ private: true });
  });

  it('answers null for an unparseable body or an unrecognised visibility', () => {
    expect(repoVisibilityFromGh('not json')).toBeNull();
    expect(repoVisibilityFromGh('{}')).toBeNull();
    expect(repoVisibilityFromGh('{"visibility":"SOMETHING"}')).toBeNull();
  });

  it('asks gh for the visibility of the cwd repository', async () => {
    fakeGh('{"visibility":"PUBLIC"}');
    await expect(new GhForge().repoInfo(home)).resolves.toEqual({ private: false });
    expect(argsList()).toEqual(['repo', 'view', '--json', 'visibility']);
  });

  it('names the remote when one is given, for a project that is not cloned yet', async () => {
    fakeGh('{"visibility":"PRIVATE"}');
    await expect(new GhForge().repoInfo(home, 'git@github.com:acme/api.git')).resolves.toEqual({ private: true });
    expect(argsList()).toEqual(['repo', 'view', 'git@github.com:acme/api.git', '--json', 'visibility']);
  });

  it('answers null when gh fails, so an unreachable forge shows no warning', async () => {
    fakeGh('', 1, 'gh: not logged in');
    await expect(new GhForge().repoInfo(home)).resolves.toBeNull();
  });
});

/**
 * VS-467: VS-466's audit found four heads that merged with only a failed `pull_request` run. These
 * are the real `statusCheckRollup` arrays `gh pr view <n> --json statusCheckRollup` returned for
 * each merged head on 2026-09-15 (workflow name and detailsUrl dropped; every field the mapping
 * reads is kept). Each must read `failure`, never a pass, so the gate can never merge it.
 */
describe('the four failure-only landings VS-466 audited (VS-467)', () => {
  const node = (name: string, conclusion: string) => ({ name, workflowName: 'CI', status: 'COMPLETED', conclusion });
  const LANDINGS = [
    { pr: 283, ticket: 'VS-340', head: 'c18a7e70e387', rollup: [node('lint', 'SUCCESS'), node('typecheck', 'SUCCESS'), node('test-core', 'FAILURE'), node('test-ui', 'SUCCESS')] },
    { pr: 300, ticket: 'VS-363', head: 'ac57b77e86ff', rollup: [node('lint', 'SUCCESS'), node('typecheck', 'SUCCESS'), node('test-core', 'FAILURE'), node('test-ui', 'SUCCESS')] },
    { pr: 302, ticket: 'VS-358', head: 'd2f3ae5cc1d9', rollup: [node('lint', 'SUCCESS'), node('typecheck', 'SUCCESS'), node('test-core', 'FAILURE'), node('test-ui', 'SUCCESS')] },
    { pr: 282, ticket: 'archive backfill', head: 'af0980c68825', rollup: [node('lint', 'SUCCESS'), node('typecheck', 'SUCCESS'), node('test-core (shard 1/4)', 'SUCCESS'), node('test-core (shard 2/4)', 'FAILURE'), node('test-core (shard 3/4)', 'SUCCESS'), node('test-core (shard 4/4)', 'SUCCESS')] },
  ];

  for (const { pr, ticket, head, rollup } of LANDINGS) {
    it(`PR #${pr} (${ticket}, ${head}) reads failure`, () => {
      expect(pullRequestFromGh({ ...DRAFT, statusCheckRollup: rollup }).checks).toBe('failure');
      expect(checkTally(rollup)).toEqual({ passed: rollup.filter((c) => c.conclusion === 'SUCCESS').length, total: rollup.length });
    });
  }
});

describe('hasUsableCheckRun (VS-467)', () => {
  const HEAD = JSON.stringify({ headRefOid: 'abc123' });
  const runs = (list: Array<{ id: number; event?: string; status?: string; conclusion?: string | null }>): string =>
    JSON.stringify({ total_count: list.length, workflow_runs: list.map((r) => ({ event: 'pull_request', ...r })) });

  it('is true while a pull_request run is still queued or running', async () => {
    for (const status of ['queued', 'in_progress']) {
      fakeGhSequence([{ stdout: HEAD }, { stdout: runs([{ id: 42, status, conclusion: null }]) }]);
      await expect(new GhForge().hasUsableCheckRun(home, 'https://github.com/acme/api/pull/7')).resolves.toBe(true);
    }
  });

  it('is true once a pull_request run has concluded success or failure', async () => {
    for (const conclusion of ['success', 'failure']) {
      fakeGhSequence([{ stdout: HEAD }, { stdout: runs([{ id: 42, status: 'completed', conclusion }]) }]);
      await expect(new GhForge().hasUsableCheckRun(home, 'https://github.com/acme/api/pull/7')).resolves.toBe(true);
    }
  });

  it('is false for no run at all, or only skipped/cancelled/startup_failure runs', async () => {
    fakeGhSequence([{ stdout: HEAD }, { stdout: runs([]) }]);
    await expect(new GhForge().hasUsableCheckRun(home, 'https://github.com/acme/api/pull/7')).resolves.toBe(false);
    // VS-453's real shapes: run 34920301125 concluded skipped, run 34920310370 concluded cancelled.
    for (const conclusion of ['skipped', 'cancelled', 'startup_failure']) {
      fakeGhSequence([{ stdout: HEAD }, { stdout: runs([{ id: 42, status: 'completed', conclusion }]) }]);
      await expect(new GhForge().hasUsableCheckRun(home, 'https://github.com/acme/api/pull/7')).resolves.toBe(false);
    }
  });

  it('ignores schedule and workflow_dispatch runs, and answers null when gh cannot tell', async () => {
    const body = JSON.stringify({ workflow_runs: [
      { id: 1, event: 'workflow_dispatch', status: 'completed', conclusion: 'success' },
      { id: 2, event: 'schedule', status: 'completed', conclusion: 'success' },
    ] });
    fakeGhSequence([{ stdout: HEAD }, { stdout: body }]);
    await expect(new GhForge().hasUsableCheckRun(home, 'https://github.com/acme/api/pull/7')).resolves.toBe(false);

    fakeGhSequence([{ stdout: HEAD }, { stdout: 'not json' }]);
    await expect(new GhForge().hasUsableCheckRun(home, 'https://github.com/acme/api/pull/7')).resolves.toBeNull();

    fakeGhSequence([{ stdout: '' , stderr: 'HTTP 500', exitCode: 1 }]);
    await expect(new GhForge().hasUsableCheckRun(home, 'https://github.com/acme/api/pull/7')).resolves.toBeNull();

    fakeGhSequence([{ stdout: JSON.stringify({}) }]);
    await expect(new GhForge().hasUsableCheckRun(home, 'https://github.com/acme/api/pull/7')).resolves.toBeNull();
  });
});

describe('runnerStatus (VS-467)', () => {
  it('maps the labels an online runner serves, ignoring offline runners', () => {
    const body = JSON.stringify({ total_count: 2, runners: [
      { name: 'weave-ci-01', status: 'online', labels: [{ name: 'self-hosted' }, { name: 'weave-ci' }] },
      { name: 'offline-box', status: 'offline', labels: [{ name: 'nightly' }] },
    ] });
    expect(runnerLabelsFromGh(body)).toEqual({ onlineLabels: ['self-hosted', 'weave-ci'] });
  });

  it('answers null when the body is not the runners document', () => {
    expect(runnerLabelsFromGh('not json')).toBeNull();
    expect(runnerLabelsFromGh('{"total_count":0}')).toBeNull();
    expect(runnerLabelsFromGh('{"runners":[]}')).toEqual({ onlineLabels: [] });
  });

  it('asks gh for the runners and answers null when it fails', async () => {
    fakeGh(JSON.stringify({ runners: [{ status: 'online', labels: [{ name: 'weave-ci' }] }] }));
    await expect(new GhForge().runnerStatus(home)).resolves.toEqual({ onlineLabels: ['weave-ci'] });
    expect(args()).toContain('actions/runners');
    fakeGh('', 1, 'HTTP 403');
    await expect(new GhForge().runnerStatus(home)).resolves.toBeNull();
  });
});

describe('the pull_request-run mapping (VS-467)', () => {
  it('keeps only pull_request runs with an id, newest first as gh lists them', () => {
    const body = JSON.stringify({ workflow_runs: [
      { id: 3, event: 'schedule', status: 'completed', conclusion: 'success' },
      { id: 2, event: 'pull_request', status: 'completed', conclusion: 'cancelled' },
      { event: 'pull_request', status: 'completed', conclusion: 'success' },
    ] });
    expect(pullRequestRunsFromGh(body)).toEqual([{ id: 2, status: 'completed', conclusion: 'cancelled' }]);
    expect(pullRequestRunsFromGh('not json')).toEqual([]);
  });

  // VS-467 item 3: the unstick route must produce a rollup the gate reads as a pass. A
  // `workflow_dispatch` run's checks are on the commit (REST `commits/{sha}/check-runs`) but are NOT
  // in the pull request's `statusCheckRollup` — verified on PR #400, where the head's rollup held only
  // the 5 skipped `pull_request` checks while an in-progress `workflow_dispatch` run existed. So the
  // route is a `synchronize` push, whose `pull_request` run's checks do appear. This is the real
  // rollup of VS-466's own PR #396 (head 6a65f911ff36), a green `pull_request` run: it reads success.
  it('reads a real green pull_request rollup from PR #396 as success', () => {
    const rollup = ['lint', 'typecheck', 'test-core (shard 1/4)', 'test-core (shard 2/4)', 'test-core (shard 3/4)', 'test-core (shard 4/4)', 'test-ui', 'test-core']
      .map((name) => ({ name, workflowName: 'CI', status: 'COMPLETED', conclusion: 'SUCCESS' }));
    expect(pullRequestFromGh({ ...DRAFT, statusCheckRollup: rollup }).checks).toBe('success');
  });
});
