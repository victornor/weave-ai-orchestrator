/**
 * VS-874: make an inherited personal commit identity visible. A worker's identity is configured now,
 * never read from the clone, so this is only about existing workspaces: a ready project whose clone
 * commits as a personal address while nothing configures a worker identity gets one warning, recorded
 * so it never repeats. It never writes to the clone or to an existing worktree.
 */
import { nowIso } from '@weave-ai/db';
import type { WorkerGitIdentity } from '@weave-ai/shared';
import type { WorkspaceContext } from '../context.js';
import { looksPersonalGitEmail, readGitIdentity } from '../util/git.js';

export interface InheritedWorkerIdentityFinding { projectId: string; slug: string; cloneEmail: string }

interface ProjectIdentityRow { id: string; slug: string; clonePath: string; workerIdentity: WorkerGitIdentity | null }

/** The `meta` key that records a project has already been reported, so the warning fires once. */
export function workerIdentityWarningKey(projectId: string): string { return `worker_identity_warning:${projectId}`; }

/**
 * Report each ready project that would have leaked a personal address into worker commits: its clone
 * commits as a personal-looking address and neither the project nor the workspace configures a worker
 * identity. One `log.warn` and one `meta` marker per project, ever.
 */
export async function reportInheritedWorkerIdentities(ctx: WorkspaceContext): Promise<InheritedWorkerIdentityFinding[]> {
  const log = ctx.log('daemon');
  const workspaceIdentity = ctx.config.defaults.workerGitIdentity ?? null;
  const rows = ctx.db.all<ProjectIdentityRow>(
    "SELECT id, slug, clone_path, worker_identity_json FROM projects WHERE workspace_id = ? AND status = 'ready'",
    [ctx.workspaceId],
  );
  const findings: InheritedWorkerIdentityFinding[] = [];
  for (const row of rows) {
    const declared = ctx.config.projects.find((p) => p.id === row.slug)?.workerGitIdentity ?? null;
    if (workspaceIdentity || row.workerIdentity || declared) continue;
    const marker = workerIdentityWarningKey(row.id);
    if (ctx.db.get<{ value: string }>('SELECT value FROM meta WHERE key = ?', [marker])) continue;
    const clone = (await readGitIdentity(row.clonePath)).identity;
    if (!clone || !looksPersonalGitEmail(clone.email)) continue;
    ctx.db.run(
      'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      [marker, nowIso()],
    );
    log.warn(
      { project: row.slug, cloneEmail: clone.email },
      `project ${row.slug}'s clone commits as ${clone.email}, a personal address, and no worker identity is configured: worker commits would have inherited it. Set defaults.workerGitIdentity in workspace.yaml or this project's workerGitIdentity (see docs/OPERATIONS.md)`,
    );
    findings.push({ projectId: row.id, slug: row.slug, cloneEmail: clone.email });
  }
  return findings;
}
