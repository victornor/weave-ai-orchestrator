import { accessSync, constants } from 'node:fs';
import { delimiter, join } from 'node:path';

export interface TerminalSpec { cmd: string; classFlag: string; execFlag: string }

/**
 * Per-emulator flag spellings. `--class=` style entries take the value attached;
 * everything else takes it as the next token. `execFlag` is the "run this command" flag.
 */
export const TERMINAL_FLAGS: Record<string, { classFlag: string; execFlag: string }> = {
  foot: { classFlag: '-a', execFlag: '-e' },
  footclient: { classFlag: '-a', execFlag: '-e' },
  kitty: { classFlag: '--class', execFlag: '-e' },
  ghostty: { classFlag: '--class=', execFlag: '-e' },
  alacritty: { classFlag: '--class', execFlag: '-e' },
  wezterm: { classFlag: '--class', execFlag: 'start --' },
  xterm: { classFlag: '-class', execFlag: '-e' },
  'xdg-terminal-exec': { classFlag: '--app-id=', execFlag: '--' },
};

export const DEFAULT_TERMINAL_FLAGS = { classFlag: '--class', execFlag: '-e' };

/** Look the flags up by binary name (the config value may carry a path and extra args). */
export function terminalSpecFor(command: string): TerminalSpec {
  const first = command.trim().split(/\s+/)[0] ?? command;
  const base = first.split('/').pop() ?? first;
  const flags = TERMINAL_FLAGS[base] ?? DEFAULT_TERMINAL_FLAGS;
  return { cmd: command.trim(), classFlag: flags.classFlag, execFlag: flags.execFlag };
}

export interface ResolveTerminalOptions {
  /** `presentation.<block>.terminal` from workspace.yaml. */
  configured?: string | null;
  env?: Record<string, string | undefined>;
  /** Injected in tests; defaults to a PATH lookup. */
  exists?(command: string): boolean;
}

export function existsOnPath(command: string, env: Record<string, string | undefined> = process.env): boolean {
  const bin = command.trim().split(/\s+/)[0] ?? command;
  if (bin.includes('/')) {
    try { accessSync(bin, constants.X_OK); return true; } catch { return false; }
  }
  for (const dir of (env.PATH ?? '').split(delimiter).filter(Boolean)) {
    try { accessSync(join(dir, bin), constants.X_OK); return true; } catch { /* keep looking */ }
  }
  return false;
}

/**
 * Terminal resolution for every terminal-spawning surface:
 * `presentation.<block>.terminal`, else `$TERMINAL`, else `xdg-terminal-exec`, else null.
 */
export function resolveTerminal(opts: ResolveTerminalOptions = {}): TerminalSpec | null {
  const env = opts.env ?? process.env;
  const exists = opts.exists ?? ((cmd: string) => existsOnPath(cmd, env));
  const configured = opts.configured?.trim();
  if (configured) return terminalSpecFor(configured);
  const fromEnv = env.TERMINAL?.trim();
  if (fromEnv) return terminalSpecFor(fromEnv);
  if (exists('xdg-terminal-exec')) return terminalSpecFor('xdg-terminal-exec');
  return null;
}
