import { existsSync, readFileSync, statSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

/**
 * VS-685: the checkout's git *common* directory, derived without invoking git.
 *
 * A Codex `workspace-write` turn makes only its working directory writable by default. A linked
 * git worktree keeps its per-worktree metadata (`index.lock`, `HEAD`, …) in the *main clone's*
 * `.git/worktrees/<name>/`, outside that directory, so `git commit` from the checkout fails as if
 * the filesystem were read-only. This returns the directory those writes need.
 *
 * - A plain clone's `.git` is a directory, which is itself the common dir.
 * - A linked worktree's `.git` is a file (`gitdir: <gitdir>`); the common dir is resolved through
 *   `<gitdir>/commondir`, falling back to the gitdir's parent when it is a `worktrees/` folder.
 * - Anything missing or malformed returns null, so the caller adds no root and the turn runs as it
 *   did before.
 */
export function gitCommonDir(checkout: string): string | null {
  const dotGit = join(checkout, '.git');
  let stat: ReturnType<typeof statSync>;
  try { stat = statSync(dotGit); } catch { return null; }
  if (stat.isDirectory()) return dotGit;
  if (!stat.isFile()) return null;
  let content: string;
  try { content = readFileSync(dotGit, 'utf8'); } catch { return null; }
  const match = /^\s*gitdir:\s*(.+?)\s*$/m.exec(content);
  if (!match || !match[1]) return null;
  const gitdir = resolve(checkout, match[1]);
  try {
    const common = readFileSync(join(gitdir, 'commondir'), 'utf8').trim();
    if (common) return resolve(gitdir, common);
  } catch { /* no commondir file; fall through to the layout default */ }
  const parent = resolve(gitdir, '..');
  return basename(parent) === 'worktrees' ? resolve(parent, '..') : null;
}

/**
 * The extra `workspace-write` sandbox roots a Codex turn needs: the checkout's git common dir,
 * plus the checkout itself when it lies outside the spawn cwd. Absolute, existing and
 * de-duplicated; empty when neither applies.
 */
export function sandboxWritableRoots(worktreePath: string | null | undefined, cwd: string): string[] {
  if (!worktreePath) return [];
  const roots: string[] = [];
  if (!worktreePath.startsWith(cwd) && existsSync(worktreePath)) roots.push(worktreePath);
  const common = gitCommonDir(worktreePath);
  if (common && existsSync(common)) roots.push(common);
  return [...new Set(roots)];
}
