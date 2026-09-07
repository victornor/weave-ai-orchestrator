import type {
  ForgeAdapter, ForgeCheck, ForgeCheckState, ForgeChangedFile, ForgePullRequest, ForgePullRequestDetail,
} from '@agent-conductor/plugin-sdk';
import { OcError } from '@agent-conductor/shared';
import { sh } from '../util/exec.js';

interface GhCheck { name?: string; context?: string; workflowName?: string; state?: string; conclusion?: string; status?: string; detailsUrl?: string; targetUrl?: string }

interface GhPrView {
  state?: string;
  mergeCommit?: { oid?: string } | null;
  statusCheckRollup?: GhCheck[] | null;
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
const VIEW_FIELDS = `${LIST_FIELDS},body,files`;

/** `gh pr list` has no "updated since" filter, so the window is applied by the caller, not here. */
const DEFAULT_LIST_LIMIT = 60;

/** One check's own state, by the same precedence `rollupState` applies across all of them. */
function checkState(c: GhCheck): ForgeCheckState {
  const status = (c.status ?? '').toUpperCase();
  if (status && status !== 'COMPLETED') return 'pending';
  const s = (c.conclusion ?? c.state ?? '').toUpperCase();
  if (['FAILURE', 'ERROR', 'CANCELLED', 'TIMED_OUT', 'ACTION_REQUIRED'].includes(s)) return 'failure';
  if (['SUCCESS', 'NEUTRAL', 'SKIPPED'].includes(s)) return 'success';
  return 'pending';
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

/** Exported for the mapping tests, which run `gh`'s recorded JSON through it and never call GitHub. */
export function pullRequestFromGh(doc: GhPr): ForgePullRequest { return toPullRequest(doc); }
export function pullRequestDetailFromGh(doc: GhPr): ForgePullRequestDetail {
  return { ...toPullRequest(doc), body: doc.body ?? '', files: (doc.files ?? []).map(toFile), checkRuns: (doc.statusCheckRollup ?? []).map(toCheck) };
}

function rollupState(rollup: GhCheck[] | null | undefined): ForgeCheckState {
  if (!rollup || rollup.length === 0) return 'none';
  let pending = false;
  for (const c of rollup) {
    const s = (c.conclusion ?? c.state ?? '').toUpperCase();
    const status = (c.status ?? '').toUpperCase();
    if (status && status !== 'COMPLETED') { pending = true; continue; }
    if (['FAILURE', 'ERROR', 'CANCELLED', 'TIMED_OUT', 'ACTION_REQUIRED'].includes(s)) return 'failure';
    if (['PENDING', 'QUEUED', 'IN_PROGRESS', 'EXPECTED', ''].includes(s)) pending = true;
  }
  return pending ? 'pending' : 'success';
}

/** GitHub forge through the `gh` CLI (auth lives on the daemon host). */
export class GhForge implements ForgeAdapter {
  readonly id = 'github';

  async detect(cwd: string): Promise<boolean> {
    const r = await sh('gh', ['auth', 'status'], { cwd, timeoutMs: 20_000 });
    return r.ok;
  }

  async prState(cwd: string, url: string): Promise<{ state: 'open' | 'merged' | 'closed'; mergeCommit?: string; ciState?: 'pending' | 'success' | 'failure' | 'none' }> {
    const r = await sh('gh', ['pr', 'view', url, '--json', 'state,mergeCommit,statusCheckRollup'], { cwd, timeoutMs: 60_000, env: { NO_COLOR: '1' } });
    if (!r.ok) throw new OcError('internal', `gh pr view failed: ${r.stderr.trim().slice(0, 300)}`, { url });
    let doc: GhPrView;
    try { doc = JSON.parse(r.stdout) as GhPrView; } catch { throw new OcError('internal', 'gh pr view returned invalid JSON', { url }); }
    const raw = (doc.state ?? 'OPEN').toUpperCase();
    const state = raw === 'MERGED' ? 'merged' : raw === 'CLOSED' ? 'closed' : 'open';
    return { state, mergeCommit: doc.mergeCommit?.oid, ciState: rollupState(doc.statusCheckRollup) };
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
}
