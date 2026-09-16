/** `weave workspace list|use|register|unregister|set-default|pause|resume|export|import` (PLAN §20). */
import type { Command } from 'commander';
import { resolve as resolvePath } from 'node:path';
import { ApiError } from '../api.js';
import { emit, fields, style, table, write } from '../output.js';
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
        ], { empty: 'no workspaces — run `weave init <dir>`' });
      });
    }));

  workspace
    .command('use')
    .argument('<id>')
    .description('make a workspace the default for the active context')
    .action(async (id: string, _opts: unknown, command: Command) => run(async () => {
      const { contextName } = await session(command, { workspace: 'none' });
      if (!contextName) throw new Error('no context configured — run `weave login <url>` first');
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

  for (const [name, description] of [['pause', 'stop dispatching runs in this workspace'], ['resume', 'start dispatching runs again']] as const) {
    workspace
      .command(name)
      .description(description)
      .action(async (_opts: unknown, command: Command) => run(async () => {
        const { client } = await session(command);
        const result = await client.wpost<Record<string, unknown>>(`/${name}`, {});
        emit(result, () => write(`${style.ok(String(result?.['status'] ?? name))} ${String(result?.['id'] ?? '')}`));
      }));
  }

  workspace
    .command('set-default')
    .argument('<assignments...>', 'one or more key=value pairs; dotted keys reach one level in')
    .description('change workspace defaults (merged into the existing ones)')
    .addHelpText('after', `
Keys:    knowledgeBudgetTokens.project=<n>    knowledgeBudgetTokens.document=<n>
         knowledgeBudgetTokens.workspace=<n>  knowledgeBudgetTokens.shared=<n>
         knowledgeBudgetTokens.decisions=<n>  bootstrapBudgetTokens=<n>
         inlineKnowledgeBudgetTokens=<n>
         maxConcurrentRuns=<n>  turnTimeoutSec=<n>  autoMerge=true|false
Example: weave workspace set-default knowledgeBudgetTokens.project=20000`)
    .action(async (assignments: string[], _opts: unknown, command: Command) => run(async () => {
      const { client } = await session(command);
      const defaults = parseAssignments(assignments);
      // VS-382: YOLO is a per-project setting now; refuse the old workspace key rather than let the
      // daemon strip it and report a change that did nothing.
      if ('yolo' in defaults) {
        throw new ApiError('validation', 'YOLO mode is set per project now, not for the workspace — run `weave project set-policy <id> yolo=true|false`', 400);
      }
      const updated = await client.patch<Record<string, unknown>>(client.w('/config'), { defaults });
      const applied = (updated['defaults'] ?? {}) as Record<string, unknown>;
      emit(updated, () => {
        write(`${style.ok('updated')} workspace defaults`);
        fields(Object.keys(defaults).map((k) => [k, JSON.stringify(applied[k])] as [string, string]));
      });
    }));

  workspace
    .command('export')
    .description('write a portable package of this workspace on the daemon host')
    .option('--out <dir>', 'target directory on the daemon host (default: <workspace>/exports/<timestamp>)')
    .addHelpText('after', `
Carries:      workspace.yaml (secrets stay as \${ENV} references), roles/<id>/{role.yaml,CHARTER.md},
              knowledge/** without archive directories, tickets/<identifier>.md rendered from the db
              (front-matter fields, description, comments, documents).
Never carries: the sqlite db, run logs, worker homes and archives, worktrees, project clones,
              sessions, auth material, or any resolved secret value.`)
    .action(async (opts: Record<string, string>, command: Command) => run(async () => {
      const { client } = await session(command);
      const body: Record<string, unknown> = {};
      if (opts['out']) body['out'] = resolvePath(opts['out']);
      const result = await client.wpost<Record<string, unknown>>('/export', body);
      emit(result, () => {
        write(`${style.ok('exported')} ${String(result?.['path'] ?? '')}`);
        fields([
          ['roles', String(result?.['roles'] ?? 0)],
          ['knowledge files', String(result?.['knowledgeFiles'] ?? 0)],
          ['tickets', String(result?.['tickets'] ?? 0)],
        ]);
      });
    }));

  workspace
    .command('import')
    .argument('<dir>', 'an export directory on the daemon host')
    .requiredOption('--target <dir>', 'workspace directory to import into (created when it does not exist)')
    .description('copy an export into a new or existing workspace directory and register it')
    .addHelpText('after', `
Imports:      workspace.yaml (only when the target has none), roles, knowledge, and every
              tickets/*.md as a fresh backlog ticket with an \`[imported]\` provenance comment.
Does not:     restore ticket status, history, comments, documents, decisions, runs, usage, workers,
              worktrees or project clones — declared projects still have to be cloned.`)
    .action(async (dir: string, opts: Record<string, string>, command: Command) => run(async () => {
      const { client } = await session(command, { workspace: 'none' });
      const result = await client.post<Record<string, unknown>>('/api/workspaces/import', {
        path: resolvePath(dir), target: resolvePath(opts['target']!),
      });
      emit(result, () => {
        write(`${style.ok(result?.['created'] === true ? 'created' : 'updated')} workspace ${String(result?.['id'] ?? '')}`);
        fields([
          ['path', String(result?.['path'] ?? '')],
          ['roles', String(result?.['roles'] ?? 0)],
          ['knowledge files', String(result?.['knowledgeFiles'] ?? 0)],
          ['tickets', `${String(result?.['tickets'] ?? 0)} imported as backlog`],
          ['skipped', String(result?.['skipped'] ?? 0)],
        ]);
      });
    }));
}

/** `a=1 b.c=2` into `{ a: 1, b: { c: 2 } }`; only the daemon decides whether a key is real. */
export function parseAssignments(assignments: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const raw of assignments) {
    const eq = raw.indexOf('=');
    if (eq <= 0) throw new Error(`not a key=value pair: ${raw}`);
    const path = raw.slice(0, eq).split('.');
    const value = coerce(raw.slice(eq + 1));
    let node = out;
    for (const key of path.slice(0, -1)) {
      if (typeof node[key] !== 'object' || node[key] === null) node[key] = {};
      node = node[key] as Record<string, unknown>;
    }
    node[path[path.length - 1]!] = value;
  }
  return out;
}

/** `true`/`false` and plain integers are typed; everything else stays a string. */
function coerce(value: string): unknown {
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (/^-?\d+$/.test(value)) return Number(value);
  return value;
}
