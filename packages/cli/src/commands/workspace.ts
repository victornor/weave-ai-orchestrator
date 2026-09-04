/** `oc workspace list|use|register|unregister` — the multi-workspace registry (PLAN §20). */
import type { Command } from 'commander';
import { resolve as resolvePath } from 'node:path';
import { emit, style, table, write } from '../output.js';
import { loadContexts, putContext } from '../contexts.js';
import { items, run, session } from './util.js';

export function register(program: Command): void {
  const workspace = program.command('workspace').description('workspaces on the daemon');

  workspace
    .command('list', { isDefault: true })
    .description('list workspaces')
    .action(async (_opts: unknown, command: Command) => run(async () => {
      const { client } = await session(command, { workspace: 'none' });
      const payload = await client.get('/api/workspaces');
      const rows = items<Record<string, unknown>>(payload, 'workspaces');
      emit(payload, () => {
        table(rows, [
          { header: '', get: (r) => (String(r['id'] ?? '') === client.workspace ? '*' : ' ') },
          { header: 'ID', get: (r) => String(r['id'] ?? '') },
          { header: 'NAME', get: (r) => String(r['name'] ?? '') },
          { header: 'PREFIX', get: (r) => String(r['ticketPrefix'] ?? '') },
          { header: 'STATUS', get: (r) => String(r['status'] ?? '') },
          { header: 'PATH', get: (r) => String(r['rootPath'] ?? r['path'] ?? '') },
        ], { empty: 'no workspaces — run `oc init <dir>`' });
      });
    }));

  workspace
    .command('use')
    .argument('<id>')
    .description('make a workspace the default for the active context')
    .action(async (id: string, _opts: unknown, command: Command) => run(async () => {
      const { contextName } = await session(command, { workspace: 'none' });
      if (!contextName) throw new Error('no context configured — run `oc login <url>` first');
      const file = loadContexts();
      const entry = file.contexts[contextName];
      if (!entry) throw new Error(`no such context: ${contextName}`);
      putContext(contextName, { ...entry, workspace: id }, false);
      emit({ context: contextName, workspace: id }, () => write(`${style.ok('using')} workspace ${id} in context ${contextName}`));
    }));

  workspace
    .command('register')
    .argument('<path>', 'path to an existing workspace directory on the daemon host')
    .description('register an existing workspace directory')
    .action(async (path: string, _opts: unknown, command: Command) => run(async () => {
      const { client } = await session(command, { workspace: 'none' });
      const result = await client.post('/api/workspaces', { path: resolvePath(path) });
      emit(result, () => write(`${style.ok('registered')} ${resolvePath(path)}`));
    }));

  workspace
    .command('unregister')
    .argument('<id>')
    .description('remove a workspace from the daemon registry (files are left alone)')
    .action(async (id: string, _opts: unknown, command: Command) => run(async () => {
      const { client } = await session(command, { workspace: 'none' });
      const result = await client.del(`/api/workspaces/${encodeURIComponent(id)}`);
      emit(result ?? { ok: true }, () => write(`${style.ok('unregistered')} ${id}`));
    }));
}
