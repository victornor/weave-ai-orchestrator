/**
 * Retained worker copies (VS-955, `worker-retained-copies`).
 *
 * The landed-work check rightly refuses to remove a worker's checkout while it holds unlanded work, and
 * VS-859's sweep reclaims only provably landed, clean homes. Everything else stayed on disk with nothing
 * ageing it or surfacing it: 224 copies, 255 GB, until the host's filesystem filled on 2026-11-02.
 *
 * This module measures and reports those copies, and offers — never takes — their reclaim:
 *
 * - `scan()` reads each non-live `workers/<dir>/work` checkout (git state and `du`), classifies it and
 *   replaces the `retained_copies` table. It runs off the supervisor tick, one copy at a time, and
 *   changes nothing on disk.
 * - `offer()` raises human-owned `discard_approval` cards. A copy with unpushed commits, commits only
 *   it holds, or unreadable state gets its own card; the rest may share one.
 * - `reclaim()` runs only from an `approve` answer on such a card. It re-reads each copy, refuses any
 *   that changed since the card, and removes the checkout and home while keeping the branch.
 */
import { existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import { lstat, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { nowIso } from '@weave-ai/db';
import { formatBytes } from '@weave-ai/render';
import {
  NAMED_CARD_OPTION_KEYS, RETAINED_COPY_CLASSES, RETAINED_RECLAIM_TARGET_KIND, TERMINAL_TICKET_STATUSES, landingBranchOf,
  type Agent, type Decision, type Project, type RetainedCopiesReport, type RetainedCopy, type RetainedCopyClass,
  type RetainedCopyReason, type RetainedReclaimOffer, type Ticket,
} from '@weave-ai/shared';
import type { WorktreeProvider } from '@weave-ai/plugin-sdk';
import type { WorkspaceContext } from '../context.js';
import type { Actor, CoreServices } from '../api.js';
import { recordActivity } from '../events.js';
import { recordedLandingProof, worktreeChanges, type RecordedLandingProof } from '../worktrees/landed.js';
import { git, resolveBaseRef } from '../util/git.js';
import { sh } from '../util/exec.js';

const DAY_MS = 86_400_000;
/** An agent in one of these is working or about to; its checkout is never a retained copy. */
const LIVE_STATUSES = new Set(['provisioning', 'active', 'running', 'paused']);
const DU_TIMEOUT_MS = 120_000;
const GIT_TIMEOUT_MS = 15_000;
export const RECLAIM_TARGET_KIND = RETAINED_RECLAIM_TARGET_KIND;

/** What a reclaim card states about one copy; the reclaim refuses the copy when any of it changed. */
export interface ReclaimSnapshot {
  directory: string;
  workerId: string | null;
  ticketIdentifier: string | null;
  branch: string | null;
  headSha: string | null;
  uncommitted: { tracked: number; untracked: number } | null;
  commitsOnNoRemote: number | null;
  commitsOnlyHere: number | null;
  bytes: number | null;
}

export interface ReclaimTarget { kind: typeof RECLAIM_TARGET_KIND; copies: ReclaimSnapshot[] }

export function isReclaimTarget(target: Record<string, unknown> | null | undefined): target is ReclaimTarget & Record<string, unknown> {
  return Boolean(target && target.kind === RECLAIM_TARGET_KIND && Array.isArray(target.copies));
}

const snapshotOf = (c: RetainedCopy): ReclaimSnapshot => ({
  directory: c.directory, workerId: c.workerId, ticketIdentifier: c.ticketIdentifier, branch: c.branch, headSha: c.headSha,
  uncommitted: c.uncommitted, commitsOnNoRemote: c.commitsOnNoRemote, commitsOnlyHere: c.commitsOnlyHere, bytes: c.bytes,
});

/** Why a copy no longer matches its card, or null when it still does. Its size alone never refuses. */
export function snapshotDrift(card: ReclaimSnapshot, now: RetainedCopy): string | null {
  if (now.workerStatus && LIVE_STATUSES.has(now.workerStatus)) return `its worker is ${now.workerStatus} again`;
  if (card.headSha !== now.headSha) return 'its head moved since the card was raised';
  if (card.branch !== now.branch) return 'its branch changed since the card was raised';
  if (JSON.stringify(card.uncommitted) !== JSON.stringify(now.uncommitted)) return 'its uncommitted files changed since the card was raised';
  if (card.commitsOnNoRemote !== now.commitsOnNoRemote || card.commitsOnlyHere !== now.commitsOnlyHere) return 'its commits changed since the card was raised';
  return null;
}

/** `+3 untracked, 2 modified files; branch ac/x and its 4 commits stay in the clone` — what one copy loses. */
export function describeLoss(c: ReclaimSnapshot): string {
  const parts: string[] = [];
  if (c.uncommitted === null) parts.push('uncommitted files unknown (status unreadable)');
  else if (c.uncommitted.tracked || c.uncommitted.untracked) parts.push(`${c.uncommitted.tracked} modified and ${c.uncommitted.untracked} untracked file(s) are lost`);
  else parts.push('no uncommitted files');
  if (c.commitsOnlyHere === null) parts.push('commits only this copy holds: unknown');
  else if (c.commitsOnlyHere > 0) parts.push(`${c.commitsOnlyHere} commit(s) only this copy holds are lost`);
  if (c.branch) parts.push(`branch \`${c.branch}\`${c.commitsOnNoRemote ? ` (${c.commitsOnNoRemote} commit(s) on no remote)` : ''} stays in the project clone`);
  return parts.join('; ');
}

/** Bytes on disk under `path`, counting allocated blocks the way `du` does; the fallback when `du` fails. */
async function walkSize(path: string): Promise<number> {
  let total = 0;
  const stack = [path];
  while (stack.length) {
    const p = stack.pop()!;
    let st;
    try { st = await lstat(p); } catch { continue; }
    total += st.blocks * 512;
    if (st.isDirectory()) {
      try { for (const e of await readdir(p)) stack.push(join(p, e)); } catch { /* unreadable directory: counted as its own entry */ }
    }
  }
  return total;
}

/** Size on disk of `path`: `du -sk` in a child process (off the event loop), else an `lstat` walk. */
export async function measureBytes(path: string): Promise<number | null> {
  const r = await sh('du', ['-sk', path], { cwd: path, timeoutMs: DU_TIMEOUT_MS });
  const kb = r.ok ? Number(r.stdout.trim().split(/\s+/)[0]) : NaN;
  if (Number.isFinite(kb)) return kb * 1024;
  try { return await walkSize(path); } catch { return null; }
}

async function count(args: string[], cwd: string): Promise<number | null> {
  const r = await git(args, cwd, GIT_TIMEOUT_MS);
  if (!r.ok) return null;
  const n = Number(r.stdout.trim());
  return Number.isFinite(n) ? n : null;
}

/** Commits on `branch` not contained in `baseRef`, by ancestry then patch-id (a squash merge counts as landed). */
async function commitsNotIn(repo: string, branch: string, baseRef: string): Promise<number | null> {
  if ((await git(['merge-base', '--is-ancestor', branch, baseRef], repo, GIT_TIMEOUT_MS)).ok) return 0;
  const cherry = await git(['cherry', baseRef, branch], repo, 60_000);
  if (!cherry.ok) return null;
  return cherry.stdout.split('\n').filter((l) => l.trim().startsWith('+')).length;
}

const emptyTotals = () => ({ count: 0, bytes: 0 });

export interface RetainedCopiesDeps {
  ctx: WorkspaceContext;
  deps: () => CoreServices;
  providerFor(project: Project, providerId?: string | null): WorktreeProvider;
}

export function createRetainedCopies({ ctx, deps, providerFor }: RetainedCopiesDeps) {
  const log = ctx.log('daemon');
  let scanning: Promise<RetainedCopiesReport> | null = null;
  const offerDays = (): number => ctx.config.defaults.retainedCopyOfferDays ?? 30;

  /**
   * Read one `workers/<directory>` without changing anything. Null when it is not a retained copy: no
   * checkout, a live worker, or a finished worker whose work has landed and whose checkout is clean
   * (VS-859's sweep reclaims that one).
   */
  async function inspect(directory: string, now = Date.now()): Promise<RetainedCopy | null> {
    const home = join(ctx.paths.workers, directory);
    const wt = join(home, 'work');
    if (!existsSync(wt)) return null;
    const agent = ctx.db.get<Agent>('SELECT * FROM agents WHERE id = ? AND workspace_id = ?', [directory, ctx.workspaceId]) ?? null;
    if (agent && LIVE_STATUSES.has(agent.status)) return null;
    const ticket = agent?.ticketId ? ctx.db.get<Ticket>('SELECT * FROM tickets WHERE id = ?', [agent.ticketId]) ?? null : null;
    const project = agent?.projectId ? ctx.db.get<Project>('SELECT * FROM projects WHERE id = ?', [agent.projectId]) ?? null : null;
    const row = agent ? ctx.db.get<{ branch: string }>('SELECT branch FROM worktrees WHERE agent_id = ? ORDER BY created_at DESC LIMIT 1', [agent.id]) : undefined;

    const errors: string[] = [];
    const changes = await worktreeChanges(wt);
    if (!changes.ok) errors.push(changes.error ?? 'git status failed');
    const head = await git(['rev-parse', 'HEAD'], wt, GIT_TIMEOUT_MS);
    const headSha = head.ok ? head.stdout.trim() || null : null;
    let branch = row?.branch || agent?.branch || null;
    if (!branch) {
      const abbrev = await git(['rev-parse', '--abbrev-ref', 'HEAD'], wt, GIT_TIMEOUT_MS);
      const name = abbrev.ok ? abbrev.stdout.trim() : '';
      if (name && name !== 'HEAD') branch = name;
    }
    const mergedPr = Boolean(ticket && ctx.db.get(
      "SELECT id FROM ticket_work_products WHERE ticket_id = ? AND type = 'pull_request' AND state = 'merged' LIMIT 1", [ticket.id],
    ));

    const clone = project?.clonePath && existsSync(project.clonePath) ? project.clonePath : null;
    const branchGone = Boolean(project && branch && (!clone || !(await git(['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], clone, GIT_TIMEOUT_MS)).ok));
    // VS-963: the ticket's recorded merge, checked against the checkout's HEAD, decides before any ref
    // comparison — it survives the branch being deleted from the remote or the clone.
    const proof: RecordedLandingProof = clone && ticket && headSha
      ? await recordedLandingProof({ repoPath: clone, worktreePath: wt, delivery: ticket.delivery, changeName: ticket.openspecChangeName })
      : { kind: 'none' };
    // A merged pull-request work product is VS-859's accepted proof on its own, so a record the copy
    // cannot be checked against does not override it; commits made after the merge always do.
    const proven = proof.kind === 'landed' || (proof.kind === 'unverified' && mergedPr);
    const unverified = proof.kind === 'unverified' && !mergedPr;
    let commitsNotOnLandingBranch: number | null = null;
    let commitsOnNoRemote: number | null = null;
    if (clone && branch && !branchGone) {
      const landing = landingBranchOf(project!, ticket);
      const baseRef = (await resolveBaseRef(clone, landing)) ?? landing;
      commitsNotOnLandingBranch = proven || (proof.kind === 'none' && mergedPr) ? 0
        : proof.kind === 'unlanded' ? proof.commitsAfterMerge
          : unverified ? null
            : await commitsNotIn(clone, branch, baseRef);
      commitsOnNoRemote = await count(['rev-list', '--count', branch, '--not', '--remotes'], clone);
    } else if (proof.kind === 'unlanded') {
      commitsNotOnLandingBranch = proof.commitsAfterMerge;
    }
    // What the checkout alone holds: its HEAD's commits that no branch, remote or tag reaches. On a
    // checkout whose branch was deleted, or whose `.git` link is dangling, git cannot answer: unknown.
    const commitsOnlyHere = headSha ? await count(['rev-list', '--count', 'HEAD', '--not', '--branches', '--remotes', '--tags'], wt) : null;

    const reasons: RetainedCopyReason[] = [];
    if (changes.ok && (changes.tracked.length || changes.untracked.length)) reasons.push('uncommitted');
    // Commits only the checkout's HEAD reaches (a detached commit) are not on the landing branch either,
    // unless the recorded merge contains them. An unverifiable record is never counted as unlanded commits.
    if (proof.kind === 'unlanded' || (proof.kind === 'none' && ((commitsNotOnLandingBranch ?? 0) > 0 || (commitsOnlyHere ?? 0) > 0))) reasons.push('commits_not_on_landing_branch');
    if (branchGone && !proven) reasons.push('branch_gone');
    if (unverified) reasons.push('landing_unverified');
    if (!changes.ok || (proof.kind === 'none' && !branchGone && clone && branch && commitsNotOnLandingBranch === null)) reasons.push('unreadable');
    const terminal = ticket ? TERMINAL_TICKET_STATUSES.includes(ticket.status) : false;
    const cls: RetainedCopyClass = !agent || !ticket ? 'orphan' : !terminal ? 'open'
      : unverified ? 'landing_unverified' : branchGone && !proven ? 'branch_gone' : 'finished_unlanded';
    // A finished copy with nothing unlanded is VS-859's to reclaim once its window passes, not ours.
    if (reasons.length === 0 && cls !== 'orphan' && cls !== 'open') return null;
    if (reasons.length === 0 && cls === 'open') return null;

    const ageFrom = ticket && terminal
      ? ticket.completedAt ?? ticket.cancelledAt ?? ticket.updatedAt
      : agent ? agent.retiredAt ?? agent.lastRunAt ?? agent.updatedAt : new Date(statSync(home).mtimeMs).toISOString();
    const ageMs = ageFrom ? now - Date.parse(ageFrom) : NaN;
    const bytes = await measureBytes(home);
    return {
      directory,
      workerId: agent?.id ?? null,
      workerName: agent?.name ?? null,
      workerStatus: agent?.status ?? null,
      ticketId: ticket?.id ?? null,
      ticketIdentifier: ticket?.identifier ?? null,
      ticketStatus: ticket?.status ?? null,
      projectId: project?.id ?? null,
      branch,
      headSha,
      class: cls,
      offerable: cls !== 'open' && Number.isFinite(ageMs) && ageMs >= offerDays() * DAY_MS,
      ageFrom,
      bytes,
      uncommitted: changes.ok ? { tracked: changes.tracked.length, untracked: changes.untracked.length } : null,
      commitsNotOnLandingBranch,
      commitsOnNoRemote,
      commitsOnlyHere,
      mergedPr,
      landingNote: proof.kind === 'none' ? null : proof.reason,
      error: errors.length ? errors.join('; ').slice(0, 500) : null,
      reasons,
      needsOwnApproval: (commitsOnNoRemote ?? 0) > 0 || commitsOnlyHere !== 0 || reasons.includes('unreadable'),
      scannedAt: nowIso(),
    };
  }

  function report(now = Date.now()): RetainedCopiesReport {
    const rows = ctx.db.all<{ copy: RetainedCopy; scannedAt: string }>('SELECT copy_json, scanned_at FROM retained_copies ORDER BY bytes DESC, directory');
    const byClass = Object.fromEntries(RETAINED_COPY_CLASSES.map((c) => [c, emptyTotals()])) as RetainedCopiesReport['totals']['byClass'];
    const totals = { ...emptyTotals(), offerable: emptyTotals(), byClass };
    const copies = rows.map((r) => {
      // Offerable is re-judged on read, so a copy crosses the window without waiting for a rescan.
      const age = r.copy.ageFrom ? now - Date.parse(r.copy.ageFrom) : NaN;
      return { ...r.copy, offerable: r.copy.class !== 'open' && Number.isFinite(age) && age >= offerDays() * DAY_MS };
    });
    for (const c of copies) {
      const b = c.bytes ?? 0;
      totals.count += 1; totals.bytes += b;
      byClass[c.class].count += 1; byClass[c.class].bytes += b;
      if (c.offerable) { totals.offerable.count += 1; totals.offerable.bytes += b; }
    }
    const scannedAt = ctx.db.get<{ value: string }>("SELECT value FROM meta WHERE key = 'retained_copies.scanned_at'")?.value ?? null;
    return { scannedAt, scanning: scanning !== null, offerDays: offerDays(), totals, copies };
  }

  async function runScan(): Promise<RetainedCopiesReport> {
    const found: RetainedCopy[] = [];
    if (existsSync(ctx.paths.workers)) {
      for (const entry of readdirSync(ctx.paths.workers, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        try {
          const copy = await inspect(entry.name);
          if (copy) found.push(copy);
        } catch (e) {
          log.warn({ directory: entry.name, err: String(e) }, 'retained-copy scan could not read a worker home');
        }
      }
    }
    const at = nowIso();
    ctx.db.transaction(() => {
      ctx.db.run('DELETE FROM retained_copies');
      for (const c of found) {
        ctx.db.run('INSERT INTO retained_copies (directory, worker_id, class, bytes, copy_json, scanned_at) VALUES (?,?,?,?,?,?)',
          [c.directory, c.workerId, c.class, c.bytes, JSON.stringify(c), c.scannedAt]);
      }
      ctx.db.run("INSERT INTO meta (key, value) VALUES ('retained_copies.scanned_at', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [at]);
    });
    const bytes = found.reduce((n, c) => n + (c.bytes ?? 0), 0);
    log.info({ copies: found.length, bytes }, 'retained worker copies scanned');
    return report();
  }

  /** One scan at a time: a second call while one runs joins it rather than starting another. */
  function scan(): Promise<RetainedCopiesReport> {
    scanning ??= runScan().finally(() => { scanning = null; });
    return scanning;
  }

  /** Start a scan in the background; false when one is already running. Never throws. */
  function startScan(): boolean {
    if (scanning) return false;
    void scan().catch((e: unknown) => log.warn({ err: String(e) }, 'retained-copy scan failed'));
    return true;
  }

  function openCardDirectories(): Set<string> {
    const open = deps().decisions.list({ status: ['open'] }).filter((d) => d.kind === 'discard_approval' && isReclaimTarget(d.target));
    return new Set(open.flatMap((d) => (d.target as unknown as ReclaimTarget).copies.map((c) => c.directory)));
  }

  function cardContext(copies: RetainedCopy[]): string {
    const total = copies.reduce((n, c) => n + (c.bytes ?? 0), 0);
    return [
      `Reclaiming removes each worker copy's checkout and home directory and frees about ${formatBytes(total)}. The branch and its commits stay in the project clone.`,
      '',
      ...copies.map((c) => `- \`${c.directory}\` — ${c.ticketIdentifier ?? 'no ticket'} (${c.ticketStatus ?? '—'}, ${c.class}), ${formatBytes(c.bytes)}: ${describeLoss(snapshotOf(c))}`),
    ].join('\n');
  }

  /**
   * Raise the reclaim cards for these directories. Removes nothing. Each copy that needs its own
   * approval gets its own card; the rest share one. An `open` copy, an unknown directory, a copy that
   * no longer holds unlanded work, and one already on an open card are skipped with a reason.
   */
  async function offer(actor: Actor, directories: string[]): Promise<RetainedReclaimOffer> {
    const result: RetainedReclaimOffer = { cards: [], skipped: [] };
    const onCard = openCardDirectories();
    const own: RetainedCopy[] = [];
    const shared: RetainedCopy[] = [];
    for (const directory of [...new Set(directories)]) {
      if (directory.includes('/') || directory.startsWith('.')) { result.skipped.push({ directory, reason: 'not a worker directory' }); continue; }
      if (onCard.has(directory)) { result.skipped.push({ directory, reason: 'already on an open reclaim card' }); continue; }
      const agent = ctx.db.get<Agent>('SELECT status FROM agents WHERE id = ? AND workspace_id = ?', [directory, ctx.workspaceId]);
      if (agent && LIVE_STATUSES.has(agent.status)) { result.skipped.push({ directory, reason: `its worker is ${agent.status}` }); continue; }
      const copy = await inspect(directory);
      if (!copy) { result.skipped.push({ directory, reason: 'not a retained copy (no checkout, or nothing unlanded)' }); continue; }
      if (copy.class === 'open') { result.skipped.push({ directory, reason: `its ticket ${copy.ticketIdentifier ?? ''} is still ${copy.ticketStatus}`.replace('  ', ' ') }); continue; }
      (copy.needsOwnApproval ? own : shared).push(copy);
    }
    const raise = (copies: RetainedCopy[], isOwn: boolean): void => {
      const bytes = copies.reduce((n, c) => n + (c.bytes ?? 0), 0);
      const first = copies[0]!;
      const title = isOwn
        ? `Reclaim worker copy ${first.ticketIdentifier ?? first.directory} (${formatBytes(first.bytes)}), discarding its unlanded work?`
        : `Reclaim ${copies.length} worker ${copies.length === 1 ? 'copy' : 'copies'} (${formatBytes(bytes)}), discarding their uncommitted files?`;
      const target: ReclaimTarget = { kind: RECLAIM_TARGET_KIND, copies: copies.map(snapshotOf) };
      const d = deps().decisions.create(actor, {
        kind: 'discard_approval', owner: 'human', title, context: cardContext(copies),
        options: [
          { key: NAMED_CARD_OPTION_KEYS.discard_approval.approve, label: isOwn ? 'Reclaim this copy' : 'Reclaim these copies' },
          { key: NAMED_CARD_OPTION_KEYS.discard_approval.reject, label: 'Keep', recommended: true },
        ],
        allowFreeText: false,
        target: target as unknown as Record<string, unknown>,
        correlationKey: isOwn ? `reclaim:${first.directory}` : `reclaim-batch:${copies.map((c) => c.directory).sort().join(',')}`,
      });
      result.cards.push({ decisionId: d.id, directories: copies.map((c) => c.directory), bytes, own: isOwn });
      recordActivity(ctx.db, ctx.workspaceId, actor, 'worker.retained_copy_reclaim_offered', 'decision', d.id, { directories: copies.map((c) => c.directory), bytes });
    };
    for (const c of own) raise([c], true);
    if (shared.length) raise(shared, false);
    return result;
  }

  /** Remove one copy's checkout through its provider (branch kept) and then its home. */
  async function removeCopy(copy: RetainedCopy): Promise<void> {
    const home = join(ctx.paths.workers, copy.directory);
    const wt = join(home, 'work');
    const agent = copy.workerId ? ctx.db.get<Agent>('SELECT * FROM agents WHERE id = ?', [copy.workerId]) : undefined;
    const project = agent?.projectId ? ctx.db.get<Project>('SELECT * FROM projects WHERE id = ?', [agent.projectId]) : undefined;
    const clone = project?.clonePath && existsSync(project.clonePath) ? project.clonePath : null;
    if (project && clone && copy.branch && !copy.reasons.includes('branch_gone')) {
      const row = ctx.db.get<{ provider: string }>('SELECT provider FROM worktrees WHERE agent_id = ? ORDER BY created_at DESC LIMIT 1', [agent!.id]);
      // `force`: the uncommitted files are exactly what captain approved discarding. The branch stays.
      await providerFor(project, row?.provider).remove({ repoPath: clone, path: wt, branch: copy.branch, deleteBranch: false, force: true, configPath: ctx.paths.wtConfig });
    }
    rmSync(home, { recursive: true, force: true });
    // A checkout whose branch was gone, or removed by hand above, leaves stale metadata in the clone.
    if (clone) await git(['worktree', 'prune'], clone, GIT_TIMEOUT_MS);
    if (agent) ctx.db.run("UPDATE worktrees SET status = 'removed', removed_at = ?, last_verified_at = ? WHERE agent_id = ? AND status != 'removed'", [nowIso(), nowIso(), agent.id]);
    ctx.db.run('DELETE FROM retained_copies WHERE directory = ?', [copy.directory]);
  }

  /**
   * Carry out an approved reclaim card. Only `decisions.answer` calls this, after a human `approve` on
   * a `discard_approval` carrying a reclaim target. Each copy is re-read first; one that changed since
   * the card, or whose worker became live, is refused and left exactly as it is.
   */
  async function reclaim(actor: Actor, decision: Decision): Promise<{ reclaimed: Array<{ directory: string; bytes: number | null }>; refused: Array<{ directory: string; reason: string }> }> {
    const out = { reclaimed: [] as Array<{ directory: string; bytes: number | null }>, refused: [] as Array<{ directory: string; reason: string }> };
    if (!isReclaimTarget(decision.target)) return out;
    for (const card of decision.target.copies) {
      try {
        const agent = card.workerId ? ctx.db.get<Agent>('SELECT status FROM agents WHERE id = ?', [card.workerId]) : undefined;
        if (agent && LIVE_STATUSES.has(agent.status)) { out.refused.push({ directory: card.directory, reason: `its worker is ${agent.status} again` }); continue; }
        const now = await inspect(card.directory);
        if (!now) { out.refused.push({ directory: card.directory, reason: 'it no longer holds unlanded work, or is gone' }); continue; }
        if (now.class === 'open') { out.refused.push({ directory: card.directory, reason: `its ticket is ${now.ticketStatus} again` }); continue; }
        const drift = snapshotDrift(card, now);
        if (drift) { out.refused.push({ directory: card.directory, reason: drift }); continue; }
        await removeCopy(now);
        out.reclaimed.push({ directory: card.directory, bytes: now.bytes });
        recordActivity(ctx.db, ctx.workspaceId, actor, 'worker.retained_copy_reclaimed', 'agent', card.workerId ?? card.directory,
          { directory: card.directory, bytes: now.bytes, branch: now.branch, decisionId: decision.id, lost: describeLoss(snapshotOf(now)) }, now.ticketId);
        log.info({ directory: card.directory, bytes: now.bytes, decisionId: decision.id }, 'retained worker copy reclaimed');
      } catch (e) {
        out.refused.push({ directory: card.directory, reason: `removal failed: ${String(e).slice(0, 300)}` });
      }
    }
    for (const r of out.refused) {
      recordActivity(ctx.db, ctx.workspaceId, actor, 'worker.retained_copy_reclaim_refused', 'decision', decision.id, r);
      log.warn({ ...r, decisionId: decision.id }, 'retained worker copy not reclaimed');
    }
    const freed = out.reclaimed.reduce((n, r) => n + (r.bytes ?? 0), 0);
    const lines = [
      out.reclaimed.length ? `Reclaimed ${out.reclaimed.length} worker ${out.reclaimed.length === 1 ? 'copy' : 'copies'}, about ${formatBytes(freed)} freed.` : 'Reclaimed no worker copies.',
      ...out.refused.map((r) => `Kept \`${r.directory}\`: ${r.reason}.`),
    ];
    try { await deps().threads.notifyHuman(actor, { text: lines.join('\n') }); }
    catch (e) { log.warn({ err: String(e) }, 'could not post the reclaim result'); }
    return out;
  }

  return { inspect, scan, startScan, report, offer, reclaim };
}

export type RetainedCopies = ReturnType<typeof createRetainedCopies>;
