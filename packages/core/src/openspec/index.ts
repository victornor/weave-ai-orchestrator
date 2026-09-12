/**
 * OpenSpecService (PLAN §12.2/§12.4): the daemon's read-only view of a ticket's OpenSpec change, the
 * `proposed` gate, and the post-merge archive. Read commands run where the change actually lives — the
 * ticket's worktree while a worker holds it, the primary clone otherwise. The daemon never writes into a
 * worktree; the only mutation here is `openspec archive` in the primary clone after a merge.
 *
 * A missing `openspec` binary is never fatal: status degrades to a zeroed record so the rest of the daemon
 * keeps working on projects that do not have OpenSpec installed.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { nowIso, type Db } from '@weave-ai/db';
import { OcError } from '@weave-ai/shared';
import type { Actor, CoreServices, OpenSpecService, OpenSpecStatus } from '../api.js';
import type { WorkspaceContext } from '../context.js';
import { recordActivity } from '../events.js';
import { git } from '../util/git.js';
import { createSerializer } from '../util/serialize.js';
import * as cli from './cli.js';

const SYSTEM: Actor = { kind: 'system', id: null };

export interface ProjectRow { id: string; clonePath: string; defaultBranch: string; openspecEnabled: number; policies: Record<string, unknown> }

/** The project row read straight from the db (camelCased, `policies_json` decoded). */
export function projectRow(db: Db, projectId: string | null | undefined): ProjectRow | undefined {
  if (!projectId) return undefined;
  return db.get<ProjectRow>('SELECT id, clone_path, default_branch, openspec_enabled, policies_json FROM projects WHERE id = ? OR slug = ?', [projectId, projectId]);
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

export function zeroStatus(changeName: string): OpenSpecStatus {
  return { changeName, planningComplete: false, artifacts: [], tasks: null, applyState: null, validation: null, archived: false };
}

/** `openspec/changes/archive/YYYY-MM-DD-<change>` in the primary clone. */
export function archivedDirFor(clonePath: string, changeName: string): string | null {
  const dir = join(clonePath, 'openspec', 'changes', 'archive');
  if (!existsSync(dir)) return null;
  const re = new RegExp(`^\\d{4}-\\d{2}-\\d{2}-${changeName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);
  for (const e of readdirSync(dir, { withFileTypes: true })) if (e.isDirectory() && re.test(e.name)) return e.name;
  return null;
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
  /** One archive at a time per project: `openspec archive` rewrites openspec/specs in the primary clone. */
  const serialize = createSerializer();

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
      const r = resolve(ticketId);
      if (!r) {
        const t = deps().tickets.get(ticketId);
        return zeroStatus(t.openspecChangeName ?? '');
      }
      const { ticket, project, changeName, cwd } = r;
      const o = { cwd, root: cwd };
      let status = zeroStatus(changeName);
      try {
        const [change, counts, apply, validation] = await Promise.all([
          cli.statusChange(o, changeName),
          cli.list(o).catch(() => []),
          cli.instructionsApply(o, changeName),
          cli.validate(o, changeName),
        ]);
        const entry = counts.find((c) => c.name === changeName);
        status = {
          changeName,
          planningComplete: change?.isPlanningComplete === true,
          artifacts: (change?.artifacts ?? []).map((a) => ({ id: a.id, status: a.status })),
          tasks: entry ? { total: entry.totalTasks, complete: entry.completedTasks } : apply.progress ? { total: apply.progress.total, complete: apply.progress.completed } : null,
          applyState: apply.state,
          validation: { ok: validation.ok, issues: validation.issues },
          archived: archivedDirFor(project.clonePath, changeName) !== null,
        };
      } catch (e) {
        if (!isMissingBinary(e)) throw e;
        log.warn({ ticketId, changeName }, 'openspec binary missing; reporting an empty status');
        return zeroStatus(changeName);
      }
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
        return { ok: false, issues: [{ level: 'error', message: 'the openspec binary is not installed' }] };
      }
      const errors = validation.issues.filter((i) => i.level === 'error');
      if (change?.isPlanningComplete === true && errors.length === 0) {
        return { ok: true, plan: renderPlan(join(cwd, 'openspec', 'changes', changeName), changeName) };
      }
      const issues = [...validation.issues];
      if (change?.isPlanningComplete !== true) {
        const pending = (change?.artifacts ?? []).filter((a) => a.status !== 'done' && a.status !== 'skipped').map((a) => a.id);
        issues.unshift({ level: 'error', message: `planning is not complete for ${changeName}${pending.length ? `: ${pending.join(', ')} still ${pending.length === 1 ? 'is' : 'are'} outstanding` : ''}` });
      }
      return { ok: false, issues };
    },

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

        const o = { cwd: project.clonePath, root: project.clonePath };
        let result: cli.ArchiveResult;
        try { result = await cli.archive(o, changeName); }
        catch (e) {
          if (!isMissingBinary(e)) throw e;
          return { archivedAs: null, skipped: 'the openspec binary is not installed' };
        }
        const archivedAs = result.archivedAs ?? archivedDirFor(project.clonePath, changeName);

        const archiveCommit = ((project.policies ?? {}) as { archiveCommit?: string }).archiveCommit ?? 'push';
        if (archiveCommit === 'push' || archiveCommit === 'local') await commitArchive(project.clonePath, changeName, log, archiveCommit === 'push');

        recordActivity(ctx.db, ctx.workspaceId, SYSTEM, 'openspec.archived', 'ticket', ticket.id, { changeName, archivedAs, specsUpdated: result.specsUpdated, warnings: result.warnings }, ticket.id);
        ctx.events.emit('ticket.updated', 'ticket', ticket.id, { openspecArchivedAs: archivedAs });
        return { archivedAs, skipped: null };
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

/** policy `archiveCommit: push` — commit the archived specs on the default branch and push them. */
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
