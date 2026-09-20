/**
 * Path confinement for the file tools (runtime-details section 5, VS-608).
 *
 * A `path` is resolved against the worktree, then `realpath`'d so a symlink is judged by its target,
 * and only then tested against the roots: the worktree and the agent home. This is honest hygiene,
 * not a security boundary — `bash` runs unconfined as it does for the three CLIs — but it stops a
 * file tool from reaching the daemon's state by accident.
 *
 * Named gap: the daemon's own config directory (`daemon.yaml`, the daemon database, `credentials/`)
 * is not an ancestor of any path the child receives, so it cannot be derived here. It stays reachable
 * through `bash` until `RuntimeHost` exposes host paths (S3 widens it).
 */
import { realpathSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';

export type ConfineOp = 'read' | 'write';
export type ConfineMode = 'auto' | 'restricted' | 'bypass';

export interface ConfineCtx {
  /** The worktree: a relative path resolves here and a shell starts here. */
  cwd: string;
  /** The agent home. */
  home: string;
  /** The runtime's config home (`<workspace state>/runtimes/<runtime>`), used to derive the state dir. */
  configHome?: string | undefined;
  /** Where a truncated tool output is spilled; readable in `auto`/`bypass`. */
  spillDir: string;
  mode: ConfineMode;
}

export type ConfineResult = { ok: true; path: string } | { ok: false; error: string };

/** `/usr` and the handful of machine-identity files the design names; a read outside the roots. */
const SYSTEM_READ_PREFIXES = ['/usr', '/etc/os-release', '/etc/hosts', '/etc/resolv.conf', '/etc/localtime'];

const stripTrailing = (p: string): string => (p.length > 1 ? p.replace(/\/+$/, '') : p);

/** True when `child` is `root` or lives under it. */
export function isInside(child: string, root: string): boolean {
  const c = stripTrailing(child);
  const r = stripTrailing(root);
  return c === r || c.startsWith(r === '/' ? '/' : `${r}/`);
}

/**
 * `realpath` a path that may not exist yet, by resolving the existing part of its ancestry and
 * re-joining the rest, so a symlinked ancestor still resolves before the check.
 */
export function realpathLenient(p: string): string {
  try { return realpathSync(p); } catch { /* does not exist (yet) or is unreadable */ }
  const parent = dirname(p);
  if (parent === p) return p;
  return join(realpathLenient(parent), p.slice(parent.length).replace(/^\/+/, ''));
}

function isSystemRead(path: string): boolean {
  return SYSTEM_READ_PREFIXES.some((prefix) => isInside(path, prefix));
}

const HOME_WRITE_PROTECTED = ['AGENTS.md', 'CLAUDE.md', '.claude', '.agents', '.opencode'];
const WORKTREE_WRITE_PROTECTED = ['.git/hooks', '.git/config'];

/**
 * Resolve a tool `path` for `op` and decide whether it is allowed. Refusals are ordinary errors
 * (`Error: …`), never a permission denial — the mode decides the tool set, not each path.
 */
export function confinePath(rawPath: string, op: ConfineOp, ctx: ConfineCtx): ConfineResult {
  const worktree = realpathLenient(ctx.cwd);
  const home = realpathLenient(ctx.home);
  const abs = isAbsolute(rawPath) ? rawPath : resolve(worktree, rawPath);
  const real = realpathLenient(abs);

  const stateDir = ctx.configHome ? dirname(dirname(ctx.configHome)) : undefined;
  const spill = realpathLenient(ctx.spillDir);
  const inAuto = ctx.mode !== 'restricted';

  if (isInside(real, worktree) || isInside(real, home)) {
    if (op === 'write') {
      for (const rel of HOME_WRITE_PROTECTED) if (isInside(real, join(home, rel))) return { ok: false, error: `path is protected: ${real}` };
      for (const rel of WORKTREE_WRITE_PROTECTED) if (isInside(real, join(worktree, rel))) return { ok: false, error: `path is protected: ${real}` };
    } else {
      for (const rel of WORKTREE_WRITE_PROTECTED) if (isInside(real, join(worktree, rel))) return { ok: false, error: `path is protected: ${real}` };
    }
    return { ok: true, path: real };
  }

  // The workspace state directory (secrets, the daemon database, runtime homes, other agents' homes)
  // is refused in every mode. The agent's own home lives under it, so it was handled above.
  if (stateDir && isInside(real, stateDir)) {
    if (op === 'read' && inAuto && isInside(real, spill)) return { ok: true, path: real };
    return { ok: false, error: `path is protected: ${real}` };
  }

  if (op === 'read' && inAuto && (isInside(real, spill) || isSystemRead(real))) return { ok: true, path: real };
  return { ok: false, error: `path is outside the worktree and agent home: ${real}` };
}