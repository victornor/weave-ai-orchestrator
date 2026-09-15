import type {
  ForgeAdapter, ForgeCheck, ForgeCheckState, ForgeChangedFile, ForgeMergeState, ForgePullRequest, ForgePullRequestDetail,
} from '@weave-ai/plugin-sdk';
import { OcError } from '@weave-ai/shared';
import { sh } from '../util/exec.js';

interface GhCheck { name?: string; context?: string; workflowName?: string; state?: string; conclusion?: string; status?: string; detailsUrl?: string; targetUrl?: string }

interface GhPrView {
  state?: string;
  mergeCommit?: { oid?: string } | null;
  statusCheckRollup?: GhCheck[] | null;
  headRefOid?: string;
  mergeStateStatus?: string;
  isDraft?: boolean;
}

/** One pull request exactly as `gh pr list --json` / `gh pr view --json` spells it. */
interface GhPr {
  number?: number; title?: string; url?: string; body?: string;
  author?: { login?: string } | null;
  state?: string; isDraft?: boolean;
  headRefName?: string; baseRefName?: string;
  createdAt?: string; updatedAt?: string; mergedAt?: string | null; closedAt?: string | null;
  additions?: number; deletions?: number; changedFiles?: number;
  statusCheckRollup?: GhCheck[] | null;
  reviewDecision?: string | null;
  mergeCommit?: { oid?: string } | null;
  headRefOid?: string;
  files?: Array<{ path?: string; additions?: number; deletions?: number }> | null;
}

/**
 * What a list entry needs. `body` and `files` are deliberately absent: GitHub returns a full patch
 * summary per pull request for them, and a list of sixty would pay for sixty descriptions nobody is
 * reading yet. `pr view` asks for them for the one that was opened.
 */
const LIST_FIELDS = [
  'number', 'title', 'url', 'author', 'state', 'isDraft', 'headRefName', 'baseRefName',
  'createdAt', 'updatedAt', 'mergedAt', 'closedAt', 'additions', 'deletions', 'changedFiles',
  'statusCheckRollup', 'reviewDecision', 'mergeCommit',
].join(',');
const VIEW_FIELDS = `${LIST_FIELDS},body,files,headRefOid`;

/** `gh pr list` has no "updated since" filter, so the window is applied by the caller, not here. */
const DEFAULT_LIST_LIMIT = 60;

/**
 * VS-466: what one check run or commit status actually says. `success` is a completed `SUCCESS` and
 * nothing else — `SKIPPED`, `NEUTRAL`, `CANCELLED`, `STALE`, an unresolved status and a missing
 * conclusion are all not passed. `skipped` is returned separately because `rollupState` ignores it:
 * GitHub reports a draft run's skipped checks alongside the real run's checks for the same head
 * (PR #377 had twelve contexts where PR #380 had five), so counting skipped as a pass would accept
 * an all-skipped rollup and counting it as a failure would reject a genuinely green landing.
 */
function checkOutcome(c: GhCheck): ForgeCheckState | 'skipped' {
  const status = (c.status ?? '').toUpperCase();
  const s = (c.conclusion ?? c.state ?? '').toUpperCase();
  if (['FAILURE', 'ERROR', 'TIMED_OUT', 'ACTION_REQUIRED', 'STARTUP_FAILURE'].includes(s)) return 'failure';
  if (status && status !== 'COMPLETED') return 'pending';
  if (s === 'SUCCESS') return 'success';
  if (s === 'SKIPPED') return 'skipped';
  if (['PENDING', 'QUEUED', 'IN_PROGRESS', 'EXPECTED', ''].includes(s)) return 'pending';
  return 'none'; // NEUTRAL, CANCELLED, STALE: completed, but not a pass
}

/** One check's own state for the detail view; a skipped check shows as idle (`none`), never success. */
function checkState(c: GhCheck): ForgeCheckState {
  const o = checkOutcome(c);
  return o === 'skipped' ? 'none' : o;
}

/**
 * A rollup entry is either a check run (`name`, `detailsUrl`) or a commit status (`context`,
 * `targetUrl`); `gh` returns both shapes in the one array and neither field is always present.
 */
function toCheck(c: GhCheck): ForgeCheck {
  const name = c.name ?? c.context ?? c.workflowName ?? 'check';
  return { name: c.workflowName && c.name && c.workflowName !== c.name ? `${c.workflowName} / ${c.name}` : name, state: checkState(c), url: c.detailsUrl ?? c.targetUrl ?? null };
}

function toFile(f: { path?: string; additions?: number; deletions?: number }): ForgeChangedFile {
  return { path: f.path ?? '', additions: f.additions ?? 0, deletions: f.deletions ?? 0 };
}

/** `gh` state is `OPEN` | `MERGED` | `CLOSED`; anything unrecognised is treated as open, as `prState` does. */
function prStateOf(raw: string | undefined): 'open' | 'merged' | 'closed' {
  const s = (raw ?? 'OPEN').toUpperCase();
  return s === 'MERGED' ? 'merged' : s === 'CLOSED' ? 'closed' : 'open';
}

/** `mergeStateStatus` is an upper-case enum; the daemon reads it lowercased, and `undefined` when `gh` omits it. */
function mergeStateOf(raw: string | undefined): ForgeMergeState | undefined {
  return raw ? (raw.toLowerCase() as ForgeMergeState) : undefined;
}

function toPullRequest(doc: GhPr): ForgePullRequest {
  return {
    number: doc.number ?? 0,
    title: doc.title ?? '',
    url: doc.url ?? '',
    author: doc.author?.login ?? null,
    state: prStateOf(doc.state),
    isDraft: doc.isDraft === true,
    headRefName: doc.headRefName ?? '',
    baseRefName: doc.baseRefName ?? '',
    createdAt: doc.createdAt ?? '',
    updatedAt: doc.updatedAt ?? doc.createdAt ?? '',
    mergedAt: doc.mergedAt ?? null,
    closedAt: doc.closedAt ?? null,
    additions: doc.additions ?? 0,
    deletions: doc.deletions ?? 0,
    changedFiles: doc.changedFiles ?? 0,
    checks: rollupState(doc.statusCheckRollup),
    reviewDecision: doc.reviewDecision ? doc.reviewDecision.toLowerCase() : null,
    mergeCommit: doc.mergeCommit?.oid ?? null,
  };
}

/**
 * `gh pr create` prints only the new pull request's URL on stdout — the command has no `--json`
 * (VS-340). This is the one place that has to read a URL rather than a JSON document, so the parser
 * is pure and exported for the tests.
 */
export function parsePullRequestUrl(text: string): { url: string; number: number } | null {
  const m = /(https?:\/\/\S+?\/pull\/(\d+))/.exec(text);
  if (!m?.[1] || !m[2]) return null;
  return { url: m[1], number: Number(m[2]) };
}

/**
 * VS-359: `gh repo view --json visibility` → `{ private }`. `INTERNAL` is not public, so it counts
 * as private. Anything unrecognised or unparseable is `null` — "cannot tell", never a guess that
 * would show or suppress a warning falsely. Pure and exported so the mapping is tested without gh.
 */
export function repoVisibilityFromGh(stdout: string): { private: boolean } | null {
  let doc: { visibility?: string };
  try { doc = JSON.parse(stdout) as { visibility?: string }; } catch { return null; }
  const v = (doc.visibility ?? '').toUpperCase();
  if (v === 'PUBLIC') return { private: false };
  if (v === 'PRIVATE' || v === 'INTERNAL') return { private: true };
  return null;
}

/**
 * VS-393: `gh api repos/{owner}/{repo}/actions/workflows --jq .total_count` prints a bare count.
 * `0` means no CI workflows are configured; anything else (including a count we cannot parse) means
 * "there may be checks", and `null` on a non-number so the caller waits rather than assuming none.
 */
export function workflowCountFromGh(stdout: string): boolean | null {
  const text = stdout.trim();
  if (!text) return null;
  const n = Number(text);
  return Number.isInteger(n) && n >= 0 ? n > 0 : null;
}

/** Exported for the mapping tests, which run `gh`'s recorded JSON through it and never call GitHub. */
export function pullRequestFromGh(doc: GhPr): ForgePullRequest { return toPullRequest(doc); }export function pullRequestDetailFromGh(doc: GhPr): ForgePullRequestDetail {
  return { ...toPullRequest(doc), body: doc.body ?? '', files: (doc.files ?? []).map(toFile), checkRuns: (doc.statusCheckRollup ?? []).map(toCheck), headSha: doc.headRefOid ?? null };
}

/**
 * VS-466: the rolled-up state of a pull request's checks. `success` requires a completed `SUCCESS`
 * for every check a run reported; `SKIPPED` entries carry no signal and are ignored (see
 * `checkOutcome`), so an all-skipped draft run reads `none`, not `success`. A `failure` anywhere
 * wins; anything else unresolved (`pending`, `queued`, `neutral`, `cancelled`, `stale`, absent) is
 * `pending` — never a pass. Empty after ignored checks, or no rollup at all, is `none`.
 */
function rollupState(rollup: GhCheck[] | null | undefined): ForgeCheckState {
  if (!rollup || rollup.length === 0) return 'none';
  let pending = false;
  let real = 0;
  for (const c of rollup) {
    const o = checkOutcome(c);
    if (o === 'skipped') continue;
    real += 1;
    if (o === 'failure') return 'failure';
    if (o !== 'success') pending = true;
  }
  if (real === 0) return 'none';
  return pending ? 'pending' : 'success';
}

/** The checks that passed out of those reported, from the same rollup `rollupState` reads. */
export function checkTally(rollup: GhCheck[] | null | undefined): { passed: number; total: number } | undefined {
  if (!rollup || rollup.length === 0) return undefined;
  let passed = 0;
  for (const c of rollup) if (checkState(c) === 'success') passed += 1;
  return { passed, total: rollup.length };
}

/** GitHub forge through the `gh` CLI (auth lives on the daemon host). */
export class GhForge implements ForgeAdapter {
  readonly id = 'github';

  async detect(cwd: string): Promise<boolean> {
    const r = await sh('gh', ['auth', 'status'], { cwd, timeoutMs: 20_000 });
    return r.ok;
  }

  async prState(cwd: string, url: string): Promise<{ state: 'open' | 'merged' | 'closed'; mergeCommit?: string; ciState?: 'pending' | 'success' | 'failure' | 'none'; checks?: { passed: number; total: number }; headSha?: string; mergeState?: ForgeMergeState; isDraft?: boolean }> {
    const r = await sh('gh', ['pr', 'view', url, '--json', 'state,mergeCommit,statusCheckRollup,headRefOid,mergeStateStatus,isDraft'], { cwd, timeoutMs: 60_000, env: { NO_COLOR: '1' } });
    if (!r.ok) throw new OcError('internal', `gh pr view failed: ${r.stderr.trim().slice(0, 300)}`, { url });
    let doc: GhPrView;
    try { doc = JSON.parse(r.stdout) as GhPrView; } catch { throw new OcError('internal', 'gh pr view returned invalid JSON', { url }); }
    const raw = (doc.state ?? 'OPEN').toUpperCase();
    const state = raw === 'MERGED' ? 'merged' : raw === 'CLOSED' ? 'closed' : 'open';
    return { state, mergeCommit: doc.mergeCommit?.oid, ciState: rollupState(doc.statusCheckRollup), checks: checkTally(doc.statusCheckRollup), headSha: doc.headRefOid, mergeState: mergeStateOf(doc.mergeStateStatus), isDraft: doc.isDraft === true };
  }

  async mergePr(cwd: string, url: string, method: string): Promise<{ mergeCommit?: string }> {
    const flag = method === 'merge' ? '--merge' : method === 'rebase' ? '--rebase' : '--squash';
    const r = await sh('gh', ['pr', 'merge', url, flag], { cwd, timeoutMs: 300_000, env: { NO_COLOR: '1' } });
    if (!r.ok) throw new OcError('merge_unverified', `gh pr merge failed: ${(r.stderr || r.stdout).trim().slice(0, 300)}`, { url, method });
    const after = await this.prState(cwd, url).catch(() => null);
    return { mergeCommit: after?.mergeCommit };
  }

  /**
   * Every pull request `gh` will name, most recently updated first. `--state all` in one call rather
   * than open and closed in two: `gh` cannot filter by update time either way, so a second spawn buys
   * nothing, and the caller windows the result.
   */
  async listPullRequests(cwd: string, opts?: { limit?: number }): Promise<ForgePullRequest[]> {
    const limit = String(opts?.limit ?? DEFAULT_LIST_LIMIT);
    const r = await sh('gh', ['pr', 'list', '--state', 'all', '--limit', limit, '--json', LIST_FIELDS], { cwd, timeoutMs: 60_000, env: { NO_COLOR: '1' } });
    if (!r.ok) throw new OcError('internal', `gh pr list failed: ${r.stderr.trim().slice(0, 300)}`, { cwd });
    let docs: GhPr[];
    try { docs = JSON.parse(r.stdout) as GhPr[]; } catch { throw new OcError('internal', 'gh pr list returned invalid JSON', { cwd }); }
    if (!Array.isArray(docs)) throw new OcError('internal', 'gh pr list did not return a list', { cwd });
    return docs.map(toPullRequest);
  }

  /** One pull request in full. A number the repository does not have is `null`, not a throw. */
  async pullRequest(cwd: string, number: number): Promise<ForgePullRequestDetail | null> {
    const r = await sh('gh', ['pr', 'view', String(number), '--json', VIEW_FIELDS], { cwd, timeoutMs: 60_000, env: { NO_COLOR: '1' } });
    if (!r.ok) {
      if (/no pull requests found|could not resolve to a pullrequest/i.test(r.stderr)) return null;
      throw new OcError('internal', `gh pr view failed: ${r.stderr.trim().slice(0, 300)}`, { cwd, number });
    }
    let doc: GhPr;
    try { doc = JSON.parse(r.stdout) as GhPr; } catch { throw new OcError('internal', 'gh pr view returned invalid JSON', { cwd, number }); }
    return pullRequestDetailFromGh(doc);
  }

  /** Opens a PR from a branch already on the remote (VS-327 backfill; VS-340 args fix; VS-393 draft). */
  async createPullRequest(cwd: string, opts: { branch: string; base: string; title: string; body?: string; draft?: boolean }): Promise<{ url: string; number: number }> {
    // `gh pr create` has no `--json`: it prints the pull request's URL, and that is the result.
    const args = ['pr', 'create', '--base', opts.base, '--head', opts.branch, '--title', opts.title, '--body', opts.body ?? ''];
    if (opts.draft) args.push('--draft');
    const r = await sh('gh', args, { cwd, timeoutMs: 60_000, env: { NO_COLOR: '1' } });
    if (!r.ok) throw new OcError('internal', `gh pr create failed: ${(r.stderr || r.stdout).trim().slice(0, 300)}`, { branch: opts.branch, base: opts.base });
    const pr = parsePullRequestUrl(r.stdout);
    if (!pr) throw new OcError('internal', 'gh pr create did not print a pull request URL', { branch: opts.branch });
    return pr;
  }

  /**
   * VS-393: bring a draft pull request out of draft (`gh pr ready`) so the CI its transition triggers
   * runs on the head that will land. A pull request already out of draft resolves to `changed: false`
   * rather than an error — `gh` exits non-zero for it, and the landing path must be a no-op then.
   */
  async markPullRequestReady(cwd: string, url: string): Promise<{ changed: boolean }> {
    const r = await sh('gh', ['pr', 'ready', url], { cwd, timeoutMs: 60_000, env: { NO_COLOR: '1' } });
    if (r.ok) return { changed: true };
    const detail = `${r.stderr || r.stdout}`.trim();
    if (/already ready|already a?ready|not a draft/i.test(detail)) return { changed: false };
    throw new OcError('internal', `gh pr ready failed: ${detail.slice(0, 300)}`, { url });
  }

  /**
   * VS-393: does the repository have any Actions workflows? `gh api .../actions/workflows` with the
   * `{owner}`/`{repo}` placeholders resolves the current clone's remote. `null` on any failure or
   * unparseable count, so the caller falls back to its bounded wait rather than guessing "no CI".
   */
  async hasCiWorkflows(cwd: string): Promise<boolean | null> {
    const r = await sh('gh', ['api', 'repos/{owner}/{repo}/actions/workflows', '--jq', '.total_count'], { cwd, timeoutMs: 30_000, env: { NO_COLOR: '1' } });
    if (!r.ok) return null;
    return workflowCountFromGh(r.stdout);
  }

  /** The open pull request whose head is `branch`, if there is one (VS-340 backfill retry). */
  async pullRequestForBranch(cwd: string, branch: string): Promise<{ url: string; number: number } | null> {
    const r = await sh('gh', ['pr', 'list', '--head', branch, '--state', 'open', '--limit', '1', '--json', 'url,number'], { cwd, timeoutMs: 60_000, env: { NO_COLOR: '1' } });
    if (!r.ok) throw new OcError('internal', `gh pr list failed: ${(r.stderr || r.stdout).trim().slice(0, 300)}`, { cwd, branch });
    let docs: Array<{ url?: string; number?: number }>;
    try { docs = JSON.parse(r.stdout) as Array<{ url?: string; number?: number }>; } catch { throw new OcError('internal', 'gh pr list returned invalid JSON', { cwd, branch }); }
    if (!Array.isArray(docs)) throw new OcError('internal', 'gh pr list did not return a list', { cwd, branch });
    const first = docs[0];
    return first?.url && first.number != null ? { url: first.url, number: first.number } : null;
  }

  /** One pull request's unified diff, exactly as `git diff` would print it. `null` when it has none. */
  async pullRequestDiff(cwd: string, number: number): Promise<string | null> {
    const r = await sh('gh', ['pr', 'diff', String(number)], { cwd, timeoutMs: 60_000, env: { NO_COLOR: '1' } });
    if (!r.ok) {
      if (/no pull requests found|could not resolve to a pullrequest/i.test(r.stderr)) return null;
      throw new OcError('internal', `gh pr diff failed: ${r.stderr.trim().slice(0, 300)}`, { cwd, number });
    }
    return r.stdout;
  }

  /**
   * VS-359: whether the repository is public, read from `gh repo view --json visibility`. `remote`
   * defaults to `cwd`'s origin, and is given explicitly by the project-creation form, which asks
   * before any clone exists. `null` on any failure — an unreachable or unauthenticated gh must
   * suppress the warning, never raise one on a guess.
   */
  async repoInfo(cwd: string, remote?: string): Promise<{ private: boolean } | null> {
    const args = ['repo', 'view', ...(remote ? [remote] : []), '--json', 'visibility'];
    const r = await sh('gh', args, { cwd, timeoutMs: 30_000, env: { NO_COLOR: '1' } });
    if (!r.ok) return null;
    return repoVisibilityFromGh(r.stdout);
  }
}
