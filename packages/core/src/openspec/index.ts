/**
 * OpenSpecService (PLAN §12.2/§12.4): the daemon's read-only view of a ticket's OpenSpec change, the
 * `proposed` gate, and the post-merge archive. Read commands run where the change actually lives — the
 * ticket's worktree while a worker holds it, the primary clone otherwise. The daemon never writes into a
 * worktree; the only mutation here is `openspec archive` in the primary clone after a merge.
 *
 * A project that simply does not use OpenSpec degrades to a zeroed record, so the rest of the daemon
 * keeps working on it. A change that exists on disk but whose `openspec` binary cannot be run is not
 * that case: since VS-318 it raises the real host-tool error rather than reporting an empty plan.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { nowIso, type Db } from '@weave-ai/db';
import { OcError, landingBranchOf } from '@weave-ai/shared';
import type { Actor, CoreServices, OpenSpecService, OpenSpecStatus } from '../api.js';
import type { WorkspaceContext } from '../context.js';
import { recordActivity } from '../events.js';
import { git } from '../util/git.js';
import { landLock } from '../util/land-lock.js';
import { scratchBranchFrom } from '../tickets/scratch.js';
import * as cli from './cli.js';
import { fillArchivedCapabilityPurposes } from './purpose.js';
import { findUndeclaredCapabilityRetirements } from './retirement.js';

const SYSTEM: Actor = { kind: 'system', id: null };

export interface ProjectRow { id: string; slug: string; clonePath: string; defaultBranch: string; landingBranch: string | null; openspecEnabled: number; policies: Record<string, unknown> }

/** The project row read straight from the db (camelCased, `policies_json` decoded). */
export function projectRow(db: Db, projectId: string | null | undefined): ProjectRow | undefined {
  if (!projectId) return undefined;
  return db.get<ProjectRow>('SELECT id, slug, clone_path, default_branch, landing_branch, openspec_enabled, policies_json FROM projects WHERE id = ? OR slug = ?', [projectId, projectId]);
}

/** The live worker's worktree for a ticket, when it exists on disk. */
export function ticketWorktree(db: Db, workspaceId: string, ticketId: string): string | null {
  const row = db.get<{ worktreePath: string | null }>(
    "SELECT worktree_path FROM agents WHERE workspace_id = ? AND kind = 'worker' AND ticket_id = ? AND status <> 'retired' AND worktree_path IS NOT NULL ORDER BY created_at DESC LIMIT 1",
    [workspaceId, ticketId],
  );
  const p = row?.worktreePath ?? null;
  return p && existsSync(p) ? p : null;
}

/**
 * VS-578: `enabled` is false only when the ticket is not on the OpenSpec path at all (no bound
 * change) — a bound ticket whose `openspec/` directory is missing is still enabled and gets the
 * zeroed-but-enabled status, so callers can tell "OpenSpec is off here" from "planning not started".
 */
export function zeroStatus(changeName: string, enabled = false): OpenSpecStatus {
  return { enabled, changeName, planningComplete: false, artifacts: [], tasks: null, applyState: null, validation: null, archived: false };
}

/**
 * JSON with object keys sorted recursively, so two statuses that differ only in key order compare
 * equal. OpenSpec's own JSON output does not guarantee key order between invocations, and the stored
 * status is round-tripped through SQLite; a plain `JSON.stringify` comparison would read a spurious
 * change on every check and re-emit forever (VS-470). Array order is kept, because it is semantic.
 */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const body = Object.keys(obj).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(',');
    return `{${body}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

export const archivedDirFor = cli.archivedDirFor;

/**
 * VS-389: record a pending archive-backfill pull request on the finished ticket's delivery, so a
 * surface can show "spec archive pending" and the sweep can raise a merge card for it. The delivery
 * is free-form JSON, so this is additive and needs no migration.
 */
function recordArchivePending(ctx: WorkspaceContext, ticketId: string, changeName: string, branch: string, pr: { url: string; number: number }): void {
  const row = ctx.db.get<{ delivery: Record<string, unknown> | null }>('SELECT delivery_json FROM tickets WHERE id = ?', [ticketId]);
  const delivery = (row?.delivery ?? {}) as Record<string, unknown>;
  const prev = (delivery['openspecArchive'] ?? {}) as Record<string, unknown>;
  const next: Record<string, unknown> = { ...prev, changeName, branch, number: pr.number, state: 'pending', pendingPrUrl: pr.url };
  // A replaced pull request starts a fresh failure history; the stale-card guard is kept so a
  // retired card is never re-noted.
  if (prev['pendingPrUrl'] !== pr.url) delete next['lastFailure'];
  ctx.db.update('tickets', ticketId, { deliveryJson: { ...delivery, openspecArchive: next }, updatedAt: nowIso() });
  ctx.events.emit('ticket.updated', 'ticket', ticketId, { openspecArchivePendingPrUrl: pr.url });
}

/** proposal + tasks + design of a change directory, rendered as the plan document (PLAN §12.2 step 2). */
export function renderPlan(changeDir: string, changeName: string): string {
  const parts: string[] = [`# Plan for ${changeName}`];
  for (const [file, heading] of [['proposal.md', 'Proposal'], ['tasks.md', 'Tasks'], ['design.md', 'Design']] as const) {
    const p = join(changeDir, file);
    if (!existsSync(p)) continue;
    const body = readFileSync(p, 'utf8').trim();
    if (!body.length) continue;
    parts.push(`## ${heading}\n\n${body}`);
  }
  return `${parts.join('\n\n')}\n`;
}

function isMissingBinary(e: unknown): boolean { return e instanceof OcError && e.code === 'openspec_not_found'; }

export function createOpenSpecService(ctx: WorkspaceContext, deps: () => CoreServices): OpenSpecService {
  const log = ctx.log('openspec');
  /** One archive at a time per project, shared with `tickets.mergeDone`'s land lock (VS-327): `openspec
   * archive` rewrites openspec/specs in the primary clone, which mergeDone's landing also touches. */
  const serialize = landLock;

  const resolve = (ticketId: string): { ticket: ReturnType<CoreServices['tickets']['get']>; project: ProjectRow; changeName: string; cwd: string } | null => {
    const ticket = deps().tickets.get(ticketId);
    const changeName = ticket.openspecChangeName;
    if (!changeName) { log.debug({ ticketId }, 'ticket has no openspec change'); return null; }
    const project = projectRow(ctx.db, ticket.projectId);
    if (!project) { log.debug({ ticketId }, 'ticket has no project'); return null; }
    const cwd = ticketWorktree(ctx.db, ctx.workspaceId, ticket.id) ?? project.clonePath;
    if (!existsSync(join(cwd, 'openspec'))) { log.debug({ ticketId, cwd }, 'no openspec directory'); return null; }
    return { ticket, project, changeName, cwd };
  };


  return {
    async statusFor(ticketId) {
      const t0 = deps().tickets.get(ticketId);
      const r = resolve(ticketId);
      if (!r) {
        // VS-578: a ticket with no bound change is off the OpenSpec path (an OpenSpec-off project,
        // or a kind that never binds); a bound ticket whose directory is missing is still enabled.
        return zeroStatus(t0.openspecChangeName ?? '', t0.openspecChangeName != null);
      }
      const { ticket, project, changeName, cwd } = r;
      const o = { cwd, root: cwd };
      const [change, counts, apply, validation] = await Promise.all([
        cli.statusChange(o, changeName),
        cli.list(o).catch(() => []),
        cli.instructionsApply(o, changeName),
        cli.validate(o, changeName),
      ]);
      const entry = counts.find((c) => c.name === changeName);
      const status = {
        enabled: true,
        changeName,
        planningComplete: change?.isPlanningComplete === true,
        artifacts: (change?.artifacts ?? []).map((a) => ({ id: a.id, status: a.status })),
        tasks: entry ? { total: entry.totalTasks, complete: entry.completedTasks } : apply.progress ? { total: apply.progress.total, complete: apply.progress.completed } : null,
        applyState: apply.state,
        validation: { ok: validation.ok, issues: validation.issues },
        archived: archivedDirFor(project.clonePath, changeName) !== null,
      };
      // VS-470: a read that changes nothing must write nothing and emit nothing. The ticket-detail read
      // is the only caller, and `ticket.updated` invalidates that same read's query — so an unconditional
      // emit is a self-sustaining loop (read → statusFor → emit → invalidate → read). Same state, same
      // output; only a real change writes the row, bumps `updatedAt` and notifies subscribers.
      if (canonicalJson(ticket.openspecState ?? null) === canonicalJson(status)) return status;
      ctx.db.update('tickets', ticket.id, { openspecStateJson: status, updatedAt: nowIso() });
      ctx.events.emit('ticket.updated', 'ticket', ticket.id, { openspecState: status });
      return status;
    },

    async validateForProposed(ticketId) {
      const r = resolve(ticketId);
      if (!r) return { ok: false, issues: [{ level: 'error', message: 'the ticket has no OpenSpec change to validate' }] };
      const { changeName, cwd } = r;
      const o = { cwd, root: cwd };
      let change: cli.ChangeStatus | null;
      let validation: cli.ValidationResult;
      try {
        [change, validation] = await Promise.all([cli.statusChange(o, changeName), cli.validate(o, changeName)]);
      } catch (e) {
        if (!isMissingBinary(e)) throw e;
        return { ok: false, issues: [{ level: 'error', message: (e as OcError).message }] };
      }
      const errors = validation.issues.filter((i) => i.level === 'error');
      // `openspec validate --strict` validates a delta's own shape, never what merging it would
      // leave behind — a change that empties a capability without declaring `retire_capabilities`
      // validates clean here and only fails once `openspec archive` runs, after the PR has merged
      // and closed (VS-293). Catch it at the one point a worker can still fix it.
      const retirementIssues = findUndeclaredCapabilityRetirements(cwd, changeName);
      if (change?.isPlanningComplete === true && errors.length === 0 && retirementIssues.length === 0) {
        return { ok: true, plan: renderPlan(join(cwd, 'openspec', 'changes', changeName), changeName) };
      }
      const issues = [...validation.issues, ...retirementIssues];
      if (change?.isPlanningComplete !== true) {
        const pending = (change?.artifacts ?? []).filter((a) => a.status !== 'done' && a.status !== 'skipped').map((a) => a.id);
        issues.unshift({ level: 'error', message: `planning is not complete for ${changeName}${pending.length ? `: ${pending.join(', ')} still ${pending.length === 1 ? 'is' : 'are'} outstanding` : ''}` });
      }
      return { ok: false, issues };
    },

    /**
     * VS-327: since archiving moved into the merge itself (`tickets.mergeDone`), this now runs only
     * as backfill — a change a ticket merged before that shipped, or one merged out of band, left
     * behind. For a `pr`-delivery project it never pushes to the landing branch: it commits the
     * archive on a new branch off the current landing tip and opens a PR carrying it, so the same
     * "no direct push to a protected branch" guarantee holds for backfill too. A `local-branch`
     * project has no forge and no protected-branch risk, so it still commits directly, unchanged.
     */
    async archiveAfterMerge(ticketId) {
      const ticket = deps().tickets.get(ticketId);
      const changeName = ticket.openspecChangeName;
      const project = projectRow(ctx.db, ticket.projectId);
      if (!changeName || !project) return { archivedAs: null, skipped: changeName ? 'ticket has no project' : 'ticket has no openspec change' };

      return serialize(project.id, async () => {
        try { await deps().projects.fetch(project.id); }
        catch (e) { log.warn({ err: e, projectId: project.id }, 'fast-forward before archive failed'); }

        const changeDir = join(project.clonePath, 'openspec', 'changes', changeName);
        if (!existsSync(changeDir)) {
          log.info({ ticketId, changeName }, 'nothing to archive: change directory not present in the primary clone');
          return { archivedAs: null, skipped: 'change directory not present' };
        }

        const mode = ((project.policies as { deliveryMode?: string } | null)?.deliveryMode ?? ctx.config.defaults.deliveryMode) as 'pr' | 'local-branch';
        if (mode === 'local-branch') {
          const o = { cwd: project.clonePath, root: project.clonePath };
          let result: cli.ArchiveResult;
          try { result = await cli.archive(o, changeName); }
          catch (e) {
            if (!isMissingBinary(e)) throw e;
            return { archivedAs: null, skipped: 'the openspec binary was not found on the daemon\'s PATH' };
          }
          const archivedAs = result.archivedAs ?? archivedDirFor(project.clonePath, changeName);
          // VS-362: fill any capability this archive created that openspec left with the placeholder
          // Purpose, before the commit; a proposal with no usable "Why" throws and the backfill is
          // recorded as failed rather than committing a placeholder.
          fillArchivedCapabilityPurposes(project.clonePath, changeName);
          await commitArchive(project.clonePath, changeName, log, false);
          recordActivity(ctx.db, ctx.workspaceId, SYSTEM, 'openspec.archived', 'ticket', ticket.id, { changeName, archivedAs, specsUpdated: result.specsUpdated, warnings: result.warnings }, ticket.id);
          ctx.events.emit('ticket.updated', 'ticket', ticket.id, { openspecArchivedAs: archivedAs });
          return { archivedAs, skipped: null };
        }

        // `pr` delivery: archive on a fresh branch off the current landing tip, never on the landing
        // branch itself, and open a PR carrying it rather than pushing directly. The spec is not on
        // the landing branch until a human merges that PR (VS-327 review, PR #272), so this never
        // reports `archivedAs` — only that a PR is pending — and never opens a second PR for the
        // same change while an earlier one is still open.
        const landing = landingBranchOf(project, ticket);
        const newBranch = `ac/archive-${changeName}`;
        const forge = ctx.registries.forges.get('github');
        const title = `chore(openspec): archive ${changeName}`;
        const body = `Backfills the OpenSpec archive for ${ticket.identifier}, left behind when it merged before archiving moved into the merge itself.`;
        const existingBranch = await git(['ls-remote', '--exit-code', '--heads', 'origin', newBranch], project.clonePath, 60_000);
        if (existingBranch.ok && existingBranch.stdout.trim()) {
          // A sweep may have pushed this branch and then failed before recording a PR (VS-340). The
          // branch's existence alone is not proof one is pending: find the open PR on it and record
          // it, or open one from the pushed branch. Only a real PR stops a retry, so a partial
          // failure converges instead of skipping forever.
          const pending = forge?.pullRequestForBranch ? await forge.pullRequestForBranch(project.clonePath, newBranch) : null;
          if (pending) {
            recordActivity(ctx.db, ctx.workspaceId, SYSTEM, 'openspec.archive_pr_opened', 'ticket', ticket.id, { changeName, pendingPrUrl: pending.url }, ticket.id);
            recordArchivePending(ctx, ticket.id, changeName, newBranch, pending);
            return { archivedAs: null, skipped: null, changeName, branch: newBranch, pendingPrUrl: pending.url, pendingPrNumber: pending.number };
          }
          // VS-389: a pull request on this branch that was closed without merging is recorded, never
          // silently reopened; the fresh pull request opened below raises its own card.
          if (forge?.listPullRequests) {
            const prs = await forge.listPullRequests(project.clonePath, { limit: 50 }).catch(() => []);
            const closed = prs.find((p) => p.headRefName === newBranch && p.state === 'closed');
            if (closed) {
              recordActivity(ctx.db, ctx.workspaceId, SYSTEM, 'openspec.archive_pr_closed', 'ticket', ticket.id, { changeName, closedPrUrl: closed.url }, ticket.id);
              try { deps().tickets.comment(SYSTEM, ticket.id, `the archive pull request ${closed.url} was closed unmerged; opening a fresh one`, 'status'); }
              catch (e) { log.warn({ err: e, ticketId: ticket.id }, 'archive closed-pull-request comment failed'); }
            }
          }
          if (!forge?.createPullRequest) {
            throw new OcError('internal', 'no forge available that can open a backfill pull request', { changeName, branch: newBranch });
          }
          const pr = await forge.createPullRequest(project.clonePath, { branch: newBranch, base: landing, title, body, draft: true });
          recordActivity(ctx.db, ctx.workspaceId, SYSTEM, 'openspec.archive_pr_opened', 'ticket', ticket.id, { changeName, pendingPrUrl: pr.url }, ticket.id);
          recordArchivePending(ctx, ticket.id, changeName, newBranch, pr);
          return { archivedAs: null, skipped: null, changeName, branch: newBranch, pendingPrUrl: pr.url, pendingPrNumber: pr.number };
        }
        const scratch = await scratchBranchFrom(project.clonePath, 'HEAD', newBranch, { stateDir: ctx.paths.state, projectSlug: project.slug, label: ticket.identifier });
        try {
          const o = { cwd: scratch.path, root: scratch.path };
          let result: cli.ArchiveResult;
          try { result = await cli.archive(o, changeName); }
          catch (e) {
            if (!isMissingBinary(e)) throw e;
            return { archivedAs: null, skipped: 'the openspec binary was not found on the daemon\'s PATH' };
          }
          // VS-362: fill a newly created capability's placeholder Purpose from the archived
          // proposal's "Why" before this branch is committed and pushed. A change with no usable
          // "Why" throws, and the sweep records it as a backfill failure rather than shipping it.
          fillArchivedCapabilityPurposes(scratch.path, changeName);
          const add = await git(['add', '-A', 'openspec'], scratch.path, 30_000);
          if (!add.ok) throw new OcError('internal', `git add of the backfill archive failed: ${add.stderr.trim().slice(0, 300)}`, { changeName });
          const commit = await git(['commit', '-m', `chore(openspec): archive ${changeName}`], scratch.path, 30_000);
          if (!commit.ok && !/nothing to commit|no changes added/i.test(`${commit.stdout} ${commit.stderr}`)) {
            throw new OcError('internal', `git commit of the backfill archive failed: ${commit.stderr.trim().slice(0, 300)}`, { changeName });
          }
          const push = await git(['push', '-u', 'origin', newBranch], scratch.path, 120_000);
          if (!push.ok) throw new OcError('internal', `push of backfill branch ${newBranch} failed: ${push.stderr.trim().slice(0, 300)}`, { changeName, branch: newBranch });
          if (!forge?.createPullRequest) {
            throw new OcError('internal', 'no forge available that can open a backfill pull request', { changeName, branch: newBranch });
          }
          const pr = await forge.createPullRequest(project.clonePath, { branch: newBranch, base: landing, title, body, draft: true });
          recordActivity(ctx.db, ctx.workspaceId, SYSTEM, 'openspec.archive_pr_opened', 'ticket', ticket.id, { changeName, specsUpdated: result.specsUpdated, warnings: result.warnings, pendingPrUrl: pr.url }, ticket.id);
          recordArchivePending(ctx, ticket.id, changeName, newBranch, pr);
          return { archivedAs: null, skipped: null, changeName, branch: newBranch, pendingPrUrl: pr.url, pendingPrNumber: pr.number };
        } finally {
          await scratch.dispose();
        }
      });
    },

    async version(projectId) {
      const project = projectRow(ctx.db, projectId);
      if (!project || !existsSync(project.clonePath)) return null;
      try { return await cli.version({ cwd: project.clonePath, root: project.clonePath }); }
      catch (e) {
        if (isMissingBinary(e)) return null;
        log.warn({ err: e, projectId }, 'openspec --version failed');
        return null;
      }
    },
  };
}

/**
 * Commits the archived specs directly in `clonePath`'s current checkout. `push` is only ever
 * `false` now (VS-327): a `local-branch`-delivery project's backfill, which has no forge and no
 * protected-branch risk, so a direct local commit is fine. A `pr`-delivery project's backfill uses
 * `archiveAfterMerge`'s branch-and-PR path below instead — this function no longer pushes anything.
 */
async function commitArchive(clonePath: string, changeName: string, log: ReturnType<WorkspaceContext['log']>, push = true): Promise<void> {
  const add = await git(['add', '-A', 'openspec'], clonePath, 30_000);
  if (!add.ok) { log.warn({ clonePath, stderr: add.stderr.slice(0, 300) }, 'git add of the archive failed'); return; }
  const commit = await git(['commit', '-m', `chore(openspec): archive ${changeName}`], clonePath, 30_000);
  if (!commit.ok) {
    const out = `${commit.stdout} ${commit.stderr}`;
    if (/nothing to commit|no changes added/i.test(out)) { log.info({ changeName }, 'archive produced no commit'); return; }
    log.warn({ changeName, stderr: commit.stderr.slice(0, 300) }, 'git commit of the archive failed');
    return;
  }
  if (!push) return;
  const pushed = await git(['push'], clonePath, 120_000);
  if (!pushed.ok) log.info({ changeName, stderr: pushed.stderr.slice(0, 200) }, 'git push of the archive skipped or refused');
}
