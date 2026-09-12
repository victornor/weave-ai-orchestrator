/**
 * VS-258: the two-name compatibility layer ahead of the agent-conductor -> weave-ai rename. Every
 * directory this product owns may exist on a host under an old name or a new one; these two
 * functions are the one place that decides which, so no other file has to spell both names itself.
 * Leaf: imports nothing from `@weave-ai/*`, so it throws plain `Error`s, not `OcError` — see
 * this change's design.md, Decision 1.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * `old` when only `oldPath` exists, `new` when only `newPath` exists, `fresh` when neither does (a
 * brand new install gets the new name), `ambiguous` when both do — a loud refusal, never a silent
 * pick.
 */
export type InstallPathResolution =
  | { status: 'old' | 'new' | 'fresh'; path: string }
  | { status: 'ambiguous'; oldPath: string; newPath: string };

export function resolveInstallPath(oldPath: string, newPath: string): InstallPathResolution {
  const oldExists = existsSync(oldPath);
  const newExists = existsSync(newPath);
  if (oldExists && newExists) return { status: 'ambiguous', oldPath, newPath };
  if (newExists) return { status: 'new', path: newPath };
  if (oldExists) return { status: 'old', path: oldPath };
  return { status: 'fresh', path: newPath };
}

export type WorkspaceInstallStatus = 'old' | 'new' | 'fresh';
export interface WorkspaceInstall { status: WorkspaceInstallStatus; stateDir: string }

/**
 * The same decision, scoped to one workspace root, keyed on whichever side's `db.sqlite` exists —
 * not on directory presence, which `ensureLayout()` (`packages/core`) creates ahead of the database
 * itself, so a directory-presence check would see its own side effect as "already installed" on the
 * very first fresh boot. Every consumer that needs a workspace's own directory (not only
 * `workspacePaths()`) calls this rather than rebuilding the two candidate paths itself.
 */
export function resolveWorkspaceStateDir(root: string): WorkspaceInstall {
  const oldDb = join(root, '.agent-conductor', 'db.sqlite');
  const newDb = join(root, '.weave', 'db.sqlite');
  const r = resolveInstallPath(oldDb, newDb);
  if (r.status === 'ambiguous') {
    throw new Error(`ambiguous workspace install at ${root}: both ${r.oldPath} and ${r.newPath} exist`);
  }
  return { status: r.status, stateDir: r.status === 'old' ? join(root, '.agent-conductor') : join(root, '.weave') };
}
