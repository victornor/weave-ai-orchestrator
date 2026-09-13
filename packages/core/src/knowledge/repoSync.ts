/**
 * VS-358: reconciles the workspace's own `knowledge/projects/<id>/**` copy against what an opted-in
 * project's landing actually changed under `.weave/knowledge/`, immediately after that ticket lands.
 * Scoped to the landing's own diff (`changedKnowledgePaths`) so an unrelated landing never touches a
 * knowledge file it did not itself change, and merges rather than overwrites (`mergeEntries` for the
 * hub, a staleness guard for a full-body document) so a concurrent, still-unmerged knowledge write is
 * never reverted or deleted by someone else's landing.
 */
import type { Actor, CoreServices } from '../api.js';
import type { WorkspaceContext } from '../context.js';
import { git } from '../util/git.js';
import { docFolderOf, docSlugOf, isDocPath, mergeEntries } from './files.js';
import type { Project } from '@weave-ai/shared';

const SYSTEM: Actor = { kind: 'system', id: null };

export interface ChangedKnowledgePath { path: string; status: 'added' | 'modified' | 'deleted' }

/** The `.weave/knowledge/`-relative paths (added/modified/deleted) a landing's own commits changed. */
export async function changedKnowledgePaths(clonePath: string, beforeSha: string, afterSha: string): Promise<ChangedKnowledgePath[]> {
  const diff = await git(['diff', '--name-status', `${beforeSha}..${afterSha}`, '--', '.weave/knowledge/'], clonePath, 60_000);
  if (!diff.ok || !diff.stdout.trim()) return [];
  const out: ChangedKnowledgePath[] = [];
  for (const line of diff.stdout.split('\n').filter(Boolean)) {
    const [code, ...rest] = line.split('\t');
    const path = rest.at(-1); // a rename ("R100\told\tnew") is treated by its new path, as a modification
    if (!path) continue;
    const status: ChangedKnowledgePath['status'] = code?.startsWith('A') ? 'added' : code?.startsWith('D') ? 'deleted' : 'modified';
    out.push({ path: path.replace(/^\.weave\/knowledge\//, ''), status });
  }
  return out;
}

/** `git show`'s stdout has its trailing newline trimmed; every knowledge file's convention is to end in one. */
async function showAt(clonePath: string, sha: string, repoRelPath: string): Promise<string> {
  const r = await git(['show', `${sha}:.weave/knowledge/${repoRelPath}`], clonePath, 30_000);
  if (!r.ok) return '';
  return r.stdout.endsWith('\n') ? r.stdout : `${r.stdout}\n`;
}

export async function reconcileProjectKnowledgeFromRepo(
  ctx: WorkspaceContext,
  deps: () => CoreServices,
  project: Project,
  beforeSha: string,
  afterSha: string,
  /**
   * The ticket whose landing this reconciliation follows. Plan review round 2: this repo squash-
   * merges, so every landing is one commit whose author date is the merge time — a git commit date
   * can never tell "the ticket's own edit" apart from "an unrelated concurrent edit that merged
   * moments earlier or later." `knowledge_revisions.ticket_id` already records that distinction.
   */
  landingTicketId: string | null,
): Promise<void> {
  const changed = await changedKnowledgePaths(project.clonePath, beforeSha, afterSha);
  if (!changed.length) return;
  const knowledge = deps().knowledge;
  const log = ctx.log('knowledge');

  /**
   * Is it safe to apply the landed content for `workspaceRel`? Anchored on the workspace's own
   * revision history, never on a commit date:
   * - No workspace row yet (a document that never reached the workspace at all): nothing to
   *   clobber — safe.
   * - The landing ticket has its own revision of this path: safe exactly when no *later* revision
   *   (by a different ticket, or by none — an out-of-ticket weaver edit) exists. Revisions are a
   *   strictly increasing counter per file, so "later" needs no timestamp at all.
   * - The landing ticket has no revision of this path (it changed the file by hand in git — a
   *   resolved conflict, a direct edit — never through a knowledge tool call): there is no
   *   ticket-authored baseline to compare against, so this is left alone rather than guessed at.
   */
  function safeToApply(workspaceRel: string): boolean {
    const file = ctx.db.get<{ id: string }>('SELECT id FROM knowledge_files WHERE workspace_id = ? AND path = ?', [ctx.workspaceId, workspaceRel]);
    if (!file) return true;
    const ticketRevision = landingTicketId
      ? ctx.db.get<{ revision: number }>('SELECT MAX(revision) AS revision FROM knowledge_revisions WHERE file_id = ? AND ticket_id = ?', [file.id, landingTicketId])?.revision ?? null
      : null;
    if (ticketRevision === null) {
      log.info({ path: workspaceRel, landingTicketId }, 'knowledge repo sync: no revision from the landing ticket for this path; leaving the workspace copy as is');
      return false;
    }
    const newer = ctx.db.get<{ n: number }>(
      'SELECT COUNT(*) AS n FROM knowledge_revisions WHERE file_id = ? AND revision > ? AND (ticket_id IS NULL OR ticket_id != ?)',
      [file.id, ticketRevision, landingTicketId],
    )?.n ?? 0;
    return newer === 0;
  }

  for (const { path, status } of changed) {
    const workspaceRel = `projects/${project.slug}/${path}`;
    if (path === 'PROJECT.md') {
      // The hub is never deleted; merge at the entry level so a concurrent, still-unmerged write
      // (another ticket's note, a pending weaver PR) is kept rather than clobbered.
      const [base, landed] = await Promise.all([showAt(project.clonePath, beforeSha, path), showAt(project.clonePath, afterSha, path)]);
      const workspace = knowledge.get('project', project.id).body;
      const merged = mergeEntries(base, landed, workspace);
      if (merged !== workspace) knowledge.replace(SYSTEM, 'project', merged, 'merge-sync', project.id);
      continue;
    }
    if (!isDocPath(workspaceRel)) continue; // not a document or hub this scheme recognizes; ignore
    const slug = docSlugOf(workspaceRel);
    if (!slug) continue;
    if (!safeToApply(workspaceRel)) continue;
    if (status === 'deleted') {
      try { knowledge.deleteDoc(SYSTEM, 'project', slug, project.id); } catch { /* already gone */ }
      continue;
    }
    const landed = await showAt(project.clonePath, afterSha, path);
    if (!landed) continue;
    knowledge.putDoc(SYSTEM, 'project', slug, landed, project.id, 'merge-sync', docFolderOf(workspaceRel));
  }
}
