/**
 * Read-only history over a project's clone (VS-96): the default branch plus every branch a live
 * worktree or an unfinished ticket holds, drawn from the same clone every worker worktree is created
 * from (`git worktree add` in `../worktrees/git.ts` branches off it), so one repository is enough.
 *
 * Every git call here is one of a fixed, named allowlist, run through the existing `git()` helper
 * (`execFile`, no shell, `GIT_TERMINAL_PROMPT=0`, a timeout) — never a caller-supplied subcommand,
 * option or ref. `history.allowlist.test.ts` enumerates every argv this module can build and refuses
 * anything that is not one of these four read-only git subcommands.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { OcError, type Project } from '@weave-ai/shared';
import { git } from '../util/git.js';
import type { Db } from '@weave-ai/db';
import type { CommitDetail, CommitFile, HistoryCommit, HistoryPage, HistoryQuery, ProjectRef } from '../api.js';

/** The only git subcommands this module ever runs. Named so the allowlist test can assert against it directly. */
export const HISTORY_GIT_SUBCOMMANDS = ['for-each-ref', 'log', 'show'] as const;

const SHA_RE = /^[0-9a-f]{7,40}$/i;
const FIELD_SEP = '\x1f';
const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 200;
/** Recognised hosts whose commit address is `https://<host>/<owner>/<repo>/commit/<sha>`. Anything else gets no link. */
const FORGE_HOSTS = new Set(['github.com', 'gitlab.com', 'codeberg.org']);

interface RefRow { branch: string; ticketId: string | null; ticketIdentifier: string | null; agentId: string | null; agentName: string | null }

async function listBranches(clonePath: string): Promise<Map<string, string>> {
  const r = await git(['for-each-ref', '--format=%(objectname) %(refname:short)', 'refs/heads'], clonePath, 20_000);
  const out = new Map<string, string>();
  if (!r.ok) return out;
  for (const line of r.stdout.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const sp = trimmed.indexOf(' ');
    if (sp < 0) continue;
    out.set(trimmed.slice(sp + 1), trimmed.slice(0, sp));
  }
  return out;
}

/** The refs a project's history covers: the default branch, every live worktree's branch, every unfinished ticket's recorded branch. A branch the repository no longer has is dropped. */
async function coveredRefs(db: Db, project: Project): Promise<ProjectRef[]> {
  const shaByName = await listBranches(project.clonePath);
  const byName = new Map<string, ProjectRef>();

  const set = (row: { branch: string | null; ticketId?: string | null; ticketIdentifier?: string | null; agentId?: string | null; agentName?: string | null }): void => {
    if (!row.branch || byName.has(row.branch)) return;
    const sha = shaByName.get(row.branch);
    if (!sha) return; // recorded, but the repository no longer has it
    byName.set(row.branch, {
      name: row.branch, sha, isDefault: row.branch === project.defaultBranch,
      ticketId: row.ticketId ?? null, ticketIdentifier: row.ticketIdentifier ?? null,
      agentId: row.agentId ?? null, agentName: row.agentName ?? null,
    });
  };

  set({ branch: project.defaultBranch });

  const worktreeRows = db.all<RefRow>(
    `SELECT w.branch AS branch, w.ticket_id AS ticket_id, t.identifier AS ticket_identifier, w.agent_id AS agent_id, a.name AS agent_name
       FROM worktrees w LEFT JOIN tickets t ON t.id = w.ticket_id LEFT JOIN agents a ON a.id = w.agent_id
      WHERE w.project_id = ? AND w.removed_at IS NULL`,
    [project.id],
  );
  for (const row of worktreeRows) set(row);

  const wpRows = db.all<RefRow>(
    `SELECT wp.title AS branch, t.id AS ticket_id, t.identifier AS ticket_identifier, NULL AS agent_id, NULL AS agent_name
       FROM ticket_work_products wp JOIN tickets t ON t.id = wp.ticket_id
      WHERE wp.type = 'branch' AND t.project_id = ? AND t.status NOT IN ('done', 'cancelled')`,
    [project.id],
  );
  for (const row of wpRows) set(row);

  return [...byName.values()];
}

function encodeCursor(tips: string[], skip: number): string {
  return Buffer.from(JSON.stringify({ tips, skip }), 'utf8').toString('base64url');
}
function decodeCursor(cursor: string): { tips: string[]; skip: number } {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (!parsed || typeof parsed !== 'object') throw new Error('malformed');
    const { tips, skip } = parsed as { tips?: unknown; skip?: unknown };
    if (!Array.isArray(tips) || !tips.every((t) => typeof t === 'string') || typeof skip !== 'number') throw new Error('malformed');
    return { tips, skip };
  } catch {
    throw new OcError('validation', `not a history cursor: ${cursor}`);
  }
}

function parseLogLine(line: string): HistoryCommit | null {
  const [sha, parents, author, authoredAt, ...subjectParts] = line.split(FIELD_SEP);
  if (!sha) return null;
  return { sha, parents: parents ? parents.split(' ').filter(Boolean) : [], author: author ?? '', authoredAt: authoredAt ?? '', subject: subjectParts.join(FIELD_SEP), refs: [] };
}

function requireClone(project: Project): void {
  if (!existsSync(join(project.clonePath, '.git'))) throw new OcError('not_found', `project ${project.slug} has no clone on disk yet`);
}

export function createHistoryReader(db: Db): {
  history(project: Project, query?: HistoryQuery): Promise<HistoryPage>;
  commit(project: Project, sha: string): Promise<CommitDetail>;
} {
  return {
    async history(project: Project, query: HistoryQuery = {}): Promise<HistoryPage> {
      requireClone(project);
      const limit = Math.min(Math.max(1, query.limit ?? DEFAULT_LIMIT), MAX_LIMIT);
      const refs = await coveredRefs(db, project);
      const shaToRefNames = new Map<string, string[]>();
      for (const r of refs) shaToRefNames.set(r.sha, [...(shaToRefNames.get(r.sha) ?? []), r.name]);

      let tips: string[]; let skip: number;
      if (query.cursor) ({ tips, skip } = decodeCursor(query.cursor));
      else { tips = [...new Set(refs.map((r) => r.sha))]; skip = 0; }

      if (tips.length === 0) return { refs, commits: [], cursor: null };

      const format = `%H${FIELD_SEP}%P${FIELD_SEP}%an${FIELD_SEP}%aI${FIELD_SEP}%s`;
      const r = await git(['log', '--date-order', `--max-count=${limit + 1}`, `--skip=${skip}`, `--pretty=format:${format}`, ...tips, '--'], project.clonePath, 60_000);
      if (!r.ok) throw new OcError('internal', `git log failed: ${r.stderr.trim().slice(0, 300)}`, { project: project.slug });

      const rows = r.stdout.split('\n').filter((l) => l.trim().length > 0).map(parseLogLine).filter((c): c is HistoryCommit => c !== null);
      const hasMore = rows.length > limit;
      const commits = rows.slice(0, limit).map((c) => ({ ...c, refs: shaToRefNames.get(c.sha) ?? [] }));
      return { refs, commits, cursor: hasMore ? encodeCursor(tips, skip + limit) : null };
    },

    async commit(project: Project, sha: string): Promise<CommitDetail> {
      requireClone(project);
      if (!SHA_RE.test(sha)) throw new OcError('validation', `not a commit id: ${sha}`);

      const metaFormat = `%H${FIELD_SEP}%P${FIELD_SEP}%an${FIELD_SEP}%ae${FIELD_SEP}%aI${FIELD_SEP}%cI${FIELD_SEP}%B`;
      const meta = await git(['show', '--no-patch', `--pretty=format:${metaFormat}`, sha, '--'], project.clonePath, 20_000);
      if (!meta.ok) throw new OcError('not_found', `commit ${sha} not found in ${project.slug}`);
      const [full, parentsRaw, author, email, authoredAt, committedAt, ...messageParts] = meta.stdout.split(FIELD_SEP);
      if (!full) throw new OcError('not_found', `commit ${sha} not found in ${project.slug}`);
      const parents = parentsRaw ? parentsRaw.split(' ').filter(Boolean) : [];

      const filesRes = await git(['show', '--numstat', '--format=', '-m', '--first-parent', sha, '--'], project.clonePath, 30_000);
      const allFiles = filesRes.ok ? filesRes.stdout.split('\n').filter((l) => l.trim().length > 0).map(parseNumstatLine).filter((f): f is CommitFile => f !== null) : [];
      const MAX_FILES = 300;
      const files = allFiles.slice(0, MAX_FILES);

      return {
        sha: full, parents, author: author ?? '', email: email ?? '', authoredAt: authoredAt ?? '', committedAt: committedAt ?? '',
        message: messageParts.join(FIELD_SEP).replace(/\n+$/, ''), files, truncatedFiles: Math.max(0, allFiles.length - files.length),
        forgeUrl: forgeCommitUrl(project.gitUrl, full),
      };
    },
  };
}

function parseNumstatLine(line: string): CommitFile | null {
  const parts = line.split('\t');
  if (parts.length < 3) return null;
  const [addRaw, delRaw, ...pathParts] = parts;
  const additions = addRaw === '-' ? 0 : Number(addRaw) || 0;
  const deletions = delRaw === '-' ? 0 : Number(delRaw) || 0;
  const pathField = pathParts.join('\t');
  const rename = pathField.match(/^(.*)\{(.*) => (.*)\}(.*)$/);
  if (rename) {
    const [, prefix, from, to, suffix] = rename;
    return { path: `${prefix}${to}${suffix}`, previousPath: `${prefix}${from}${suffix}`, status: 'renamed', additions, deletions };
  }
  const arrow = pathField.match(/^(.*) => (.*)$/);
  if (arrow) return { path: arrow[2] ?? pathField, previousPath: arrow[1] ?? null, status: 'renamed', additions, deletions };
  return { path: pathField, previousPath: null, status: addRaw === '-' ? 'modified' : deletions === 0 && additions > 0 ? 'added' : additions === 0 && deletions > 0 ? 'deleted' : 'modified', additions, deletions };
}

/** `<host>/<owner>/<repo>` from any remote form, reused from `../util/git.js`, resolved to a commit URL only for a recognised forge host. */
function forgeCommitUrl(gitUrl: string, sha: string): string | null {
  let s = gitUrl.trim();
  const scp = s.match(/^([^@/]+)@([^:]+):(.+)$/);
  if (scp) s = `https://${scp[2]}/${scp[3]}`;
  s = s.replace(/^ssh:\/\//, 'https://').replace(/\.git$/, '');
  try {
    const u = new URL(s);
    if (!FORGE_HOSTS.has(u.host)) return null;
    const path = u.pathname.replace(/^\/+|\/+$/g, '');
    return `https://${u.host}/${path}/commit/${sha}`;
  } catch {
    return null;
  }
}
