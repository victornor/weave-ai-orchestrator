/** `conductor init <dir>` — scaffold a workspace through the daemon (PLAN §5, §20). */
import type { Command } from 'commander';
import { basename, resolve as resolvePath } from 'node:path';
import { ApiError } from '../api.js';
import { emit, fields, style, write } from '../output.js';
import { loadContexts, putContext } from '../contexts.js';
import { isRunning, readPid, startDaemon } from '../daemon.js';
import { run, session } from './util.js';

function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64) || 'workspace';
}

function prefixFrom(id: string): string {
  const letters = id.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
  return (letters.slice(0, 4) || 'OC').padEnd(2, 'C');
}

export function register(program: Command): void {
  program
    .command('init')
    .argument('[dir]', 'workspace directory', '.')
    .description('scaffold a workspace on the daemon host')
    .option('--prefix <prefix>', 'ticket prefix, e.g. ACME')
    .option('--id <id>', 'workspace id (slug)')
    .option('--name <name>', 'human name')
    .option('--local', 'start a local daemon first if none is reachable')
    .action(async (dir: string, opts: Record<string, string | boolean>, command: Command) => run(async () => {
      const path = resolvePath(dir ?? '.');
      const id = String(opts['id'] ?? slugify(basename(path)));
      const name = String(opts['name'] ?? basename(path));
      const ticketPrefix = String(opts['prefix'] ?? prefixFrom(id));

      const { client, url, contextName } = await session(command, { workspace: 'none' });

      let reachable = await ping(client);
      if (!reachable && opts['local'] === true) {
        const pid = readPid();
        if (!isRunning(pid)) {
          const started = startDaemon({});
          write(`${style.dim('starting daemon')} pid ${started.pid} (log ${started.log})`);
        }
        reachable = await waitForDaemon(client, 20_000);
      }
      if (!reachable) {
        throw new ApiError('net_daemon_unreachable', `no daemon is answering at ${url}`, 0, {
          hint: 'start one with `conductor daemon start` (or re-run with --local), or point at a remote daemon with `conductor login <url>`',
        }, true);
      }

      const workspace = await client.post<Record<string, unknown>>('/api/workspaces/init', { path, id, name, ticketPrefix });

      // Make the new workspace the default for the active context, so the next command needs no -w.
      if (contextName) {
        const file = loadContexts();
        const entry = file.contexts[contextName];
        if (entry && !entry.workspace) putContext(contextName, { ...entry, workspace: id }, false);
      }

      emit(workspace ?? { id, path, name, ticketPrefix }, () => {
        write(`${style.ok('workspace ready')} ${style.bold(id)}`);
        fields([['path', path], ['name', name], ['prefix', ticketPrefix], ['next', 'conductor project add <git-url>']]);
      });
    }));
}

async function ping(client: { get: (path: string) => Promise<unknown> }): Promise<boolean> {
  try {
    await client.get('/api/health');
    return true;
  } catch {
    return false;
  }
}

async function waitForDaemon(client: { get: (path: string) => Promise<unknown> }, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await ping(client)) return true;
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

export { slugify, prefixFrom };
