/** `weave demo` — a seeded, offline demo daemon for product screenshots (VS-770, docs/demo-mode.md). */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Command } from 'commander';
import { ApiError } from '../api.js';
import { run } from './util.js';

/** The live daemon's default port; a demo never takes it. */
const LIVE_PORT = 7433;

/**
 * The server build that sits beside this CLI, never the installed release's `current` link: an older
 * build does not know `--demo`, ignores it, and would start a real daemon on the default port. A build
 * without the demo module is refused for the same reason.
 */
export function siblingServerBin(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const bin = resolve(here, '..', '..', '..', 'server', 'dist', 'bin.js');
  if (!existsSync(bin) || !existsSync(resolve(dirname(bin), 'demo', 'index.js'))) {
    throw new ApiError('validation', 'this installation has no demo mode: build the repository (`pnpm build`) and run `weave demo` from it', 400);
  }
  return bin;
}

export function register(program: Command): void {
  program
    .command('demo')
    .description('start a demo daemon on made-up data (no agents, git remotes, forge or network) for screenshots')
    .option('--port <n>', 'loopback port (default: a free one)')
    .option('--dir <path>', 'config directory (default: a fresh temporary one; must be empty or an earlier demo)')
    .addHelpText('after', '\nRuns in the foreground; Ctrl-C stops it. Capture screenshots with `pnpm demo:screenshots`.')
    .action(async (opts: { port?: string; dir?: string }) => run(async () => {
      if (opts.port !== undefined && Number(opts.port) === LIVE_PORT) throw new ApiError('validation', `demo mode refuses port ${LIVE_PORT}: that is the live daemon's port`, 400);
      const args = [siblingServerBin(), '--demo'];
      if (opts.port !== undefined) args.push('--port', opts.port);
      if (opts.dir !== undefined) args.push('--config-dir', opts.dir);
      const child = spawn(process.execPath, args, { stdio: 'inherit' });
      // Forward a stop request to the one process this command started.
      for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => child.kill(signal));
      await new Promise<void>((resolve) => child.once('exit', (code) => { process.exitCode = code ?? 0; resolve(); }));
    }));
}
