import { Hono } from 'hono';
import { z } from 'zod';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import { OcError } from '@openconductor/shared';
import { landedWorkTest } from '@openconductor/core';
import type { AppEnv } from '../types.js';
import { body, notFound } from '../http.js';

const exec = promisify(execFile);
interface WorktreeRow { id: string; projectId: string; ticketId: string | null; agentId: string | null; provider: string; path: string; branch: string; status: string; createdAt: string; lastVerifiedAt: string | null; removedAt: string | null; landedEvidence: unknown }

/** `GET /worktrees`, `POST /worktrees/:id/verify`, `POST /worktrees/:id/discard` (PLAN §11.5, §20). */
export function worktreeRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get('/', (c) => {
    const ws = c.get('ws');
    const project = c.req.query('project');
    const rows = ws.ctx.db.all<WorktreeRow>(`SELECT w.*, p.slug AS project_slug, t.identifier AS ticket_identifier FROM worktrees w LEFT JOIN projects p ON p.id = w.project_id LEFT JOIN tickets t ON t.id = w.ticket_id ${project ? 'WHERE p.slug = ? OR p.id = ?' : ''} ORDER BY w.created_at DESC`, project ? [project, project] : []);
    return c.json(rows);
  });

  app.post('/:id/verify', async (c) => {
    const ws = c.get('ws');
    const row = findWorktree(ws.ctx.db, c.req.param('id'));
    const git = await gitState(row.path);
    const project = ws.ctx.db.get<{ clonePath: string; defaultBranch: string }>('SELECT clone_path, default_branch FROM projects WHERE id = ?', [row.projectId]);
    const workProducts = row.ticketId ? ws.services.tickets.workProducts(row.ticketId) : [];
    const pr = workProducts.find((w) => w.type === 'pull_request') as { state?: string; url?: string } | undefined;
    const verdict = existsSync(row.path) && project
      ? await landedWorkTest({ worktreePath: row.path, branch: row.branch, repoPath: project.clonePath, defaultBranch: project.defaultBranch, prMerged: pr?.state === 'merged', deliveryMode: 'pr' } as never).catch((e: unknown) => ({ landed: false, reason: String(e) }))
      : { landed: false, reason: 'worktree path missing' };
    const landed = (verdict as { landed?: boolean }).landed === true;
    ws.ctx.db.update('worktrees', row.id, { lastVerifiedAt: new Date().toISOString(), status: row.status === 'removed' ? 'removed' : landed ? 'landed' : git.dirty ? 'dirty' : 'active', landedEvidenceJson: verdict });
    return c.json({ id: row.id, path: row.path, branch: row.branch, status: landed ? 'landed' : git.dirty ? 'dirty' : row.status, dirty: git.dirty, ahead: git.ahead, behind: git.behind, landed, verdict: (verdict as { reason?: string }).reason ?? (landed ? 'landed' : 'not landed') });
  });

  app.post('/:id/discard', async (c) => {
    const ws = c.get('ws');
    const { force } = await body(c, z.object({ force: z.boolean().default(false) }));
    const row = findWorktree(ws.ctx.db, c.req.param('id'));
    if (!force) throw new OcError('worktree_not_landed', 'discarding an unlanded worktree requires force: true (a human decision)');
    const provider = ws.ctx.registries.worktreeProviders.get(row.provider) ?? ws.ctx.registries.worktreeProviders.get('git');
    const project = ws.ctx.db.get<{ clonePath: string }>('SELECT clone_path FROM projects WHERE id = ?', [row.projectId]);
    if (provider && project && existsSync(row.path)) await provider.remove({ repoPath: project.clonePath, path: row.path, branch: row.branch, deleteBranch: true, force: true, configPath: ws.ctx.paths.wtConfig });
    ws.ctx.db.update('worktrees', row.id, { status: 'removed', removedAt: new Date().toISOString() });
    if (row.agentId) { try { await ws.services.workers.cancel(c.get('actor'), row.agentId, 'worktree discarded by the human'); } catch { /* already gone */ } }
    ws.ctx.events.emit('worker.retired', 'worktree', row.id, { discarded: true, agentId: row.agentId });
    return c.json({ ok: true, id: row.id });
  });

  return app;
}

function findWorktree(db: AppEnv['Variables']['ws']['ctx']['db'], id: string): WorktreeRow {
  const row = db.get<WorktreeRow>('SELECT * FROM worktrees WHERE id = ? OR agent_id = ? OR ticket_id = ? OR ticket_id IN (SELECT id FROM tickets WHERE identifier = ?) ORDER BY created_at DESC LIMIT 1', [id, id, id, id]);
  if (!row) throw notFound('worktree', id);
  return row;
}

async function gitState(path: string): Promise<{ dirty: boolean; ahead: number; behind: number }> {
  if (!existsSync(path)) return { dirty: false, ahead: 0, behind: 0 };
  try {
    const { stdout: status } = await exec('git', ['status', '--porcelain'], { cwd: path, timeout: 15000 });
    let ahead = 0; let behind = 0;
    try { const { stdout } = await exec('git', ['rev-list', '--left-right', '--count', 'HEAD...@{upstream}'], { cwd: path, timeout: 15000 }); const [a, b] = stdout.trim().split(/\s+/); ahead = Number(a ?? 0); behind = Number(b ?? 0); } catch { /* no upstream */ }
    return { dirty: status.trim().length > 0, ahead, behind };
  } catch { return { dirty: false, ahead: 0, behind: 0 }; }
}
