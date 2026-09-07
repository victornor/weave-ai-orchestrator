/**
 * How a coding CLI is launched (PLAN §16.2): the command resolved to a real executable, and the
 * environment the child runs under. Every spawn of a runtime CLI goes through here — a turn and
 * the account probe alike — so a probe can never resolve differently from the turn beside it.
 *
 * The daemon runs under a systemd user unit whose PATH is not the interactive shell's, and a CLI
 * installed by mise, npm or bun sits on the human's PATH only. So the child is given the daemon's
 * own environment rather than a bare one, and a command PATH does not resolve is looked for in the
 * directories those installers use.
 */
import { accessSync, constants, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';

/** Directories a coding CLI is commonly installed into, searched when PATH does not resolve it. */
export function fallbackBinDirs(home: string = homedir()): string[] {
  return [
    join(home, '.local', 'share', 'mise', 'shims'),
    join(home, '.local', 'bin'),
    join(home, '.bun', 'bin'),
    join(home, '.volta', 'bin'),
    join(home, '.npm-global', 'bin'),
    join(home, 'node_modules', '.bin'),
    '/usr/local/bin',
    '/opt/homebrew/bin',
    '/usr/bin',
    '/bin',
  ];
}

function executable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return statSync(path).isFile();
  } catch { return false; }
}

/** The daemon's own environment with an adapter's overlay on top; entries it does not set are dropped. */
export function childEnv(overlay: Record<string, string> = {}): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (typeof v === 'string') env[k] = v;
  return { ...env, ...overlay };
}

export interface Launch {
  /** What to spawn: an absolute path when one was found, else the command unchanged. */
  cmd: string;
  /** The environment for the child. */
  env: Record<string, string>;
  /** Where the command was found. `given` = it already carried a path; `unresolved` = nowhere. */
  source: 'given' | 'path' | 'fallback' | 'unresolved';
  /** Every directory that was searched, joined — what a failed spawn reports as the PATH it used. */
  searched: string;
}

/**
 * Resolve a runtime CLI and the environment to run it in. Never throws and never rejects a
 * command it cannot find: an unresolved command is returned as given, so the spawn fails with the
 * runtime's own error rather than a different one from here.
 */
export function launchCommand(cmd: string, overlay: Record<string, string> = {}, opts: { home?: string } = {}): Launch {
  const env = childEnv(overlay);
  // A command that already carries a path is not looked up, exactly as execvp treats it.
  if (cmd.includes('/')) return { cmd, env, source: 'given', searched: '' };

  const onPath = (env['PATH'] ?? '').split(delimiter).filter((d) => d.length > 0);
  const fallback = fallbackBinDirs(opts.home ?? env['HOME'] ?? homedir()).filter((d) => !onPath.includes(d));
  const searched = [...onPath, ...fallback].join(delimiter);

  for (const dir of onPath) {
    const p = join(dir, cmd);
    if (executable(p)) return { cmd: p, env, source: 'path', searched };
  }
  for (const dir of fallback) {
    const p = join(dir, cmd);
    if (executable(p)) return { cmd: p, env, source: 'fallback', searched };
  }
  return { cmd, env, source: 'unresolved', searched };
}
