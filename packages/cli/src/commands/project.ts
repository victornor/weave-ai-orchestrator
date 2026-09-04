/** `conductor project add|list|show|remove|fetch|set-runtime|set-policy` (PLAN §20). */
import type { Command } from 'commander';
import { emit, fields, style, table, write } from '../output.js';
import { items, run, session } from './util.js';

export function register(program: Command): void {
  const project = program.command('project').description('projects in the workspace');

  project
    .command('add')
    .argument('<git-url>')
    .description('clone a repo, init OpenSpec, seed the project KB')
    .option('--id <id>', 'project id (slug)')
    .option('--runtime <runtime>', 'default runtime for roles in this project')
    .option('--branch <branch>', 'default branch')
    .option('--max-workers <n>', 'concurrent workers across all roles')
    .option('--setup <command>', 'setup command run once per new worktree')
    .action(async (url: string, opts: Record<string, string>, command: Command) => run(async () => {
      const { client } = await session(command);
      const body: Record<string, unknown> = { url };
      if (opts['id']) body['id'] = opts['id'];
      if (opts['runtime']) body['runtime'] = opts['runtime'];
      if (opts['branch']) body['defaultBranch'] = opts['branch'];
      if (opts['maxWorkers']) body['maxWorkers'] = Number(opts['maxWorkers']);
      if (opts['setup']) body['setupCommand'] = opts['setup'];
      const created = await client.write<Record<string, unknown>>({
        tool: 'ac_project_add', input: body,
        http: { method: 'POST', path: client.w('/projects'), body },
      });
      emit(created, () => {
        write(`${style.ok('project added')} ${String(created?.['id'] ?? opts['id'] ?? url)}`);
        fields([['status', String(created?.['status'] ?? '')], ['clone', String(created?.['clonePath'] ?? '')]]);
      });
    }));

  project
    .command('list', { isDefault: true })
    .description('list projects')
    .action(async (_opts: unknown, command: Command) => run(async () => {
      const { client } = await session(command);
      const payload = await client.wget('/projects');
      const rows = items<Record<string, unknown>>(payload, 'projects');
      emit(payload, () => {
        table(rows, [
          { header: 'ID', get: (r) => String(r['id'] ?? '') },
          { header: 'NAME', get: (r) => String(r['name'] ?? '') },
          { header: 'RUNTIME', get: (r) => String(r['runtimeId'] ?? '') },
          { header: 'BRANCH', get: (r) => String(r['defaultBranch'] ?? '') },
          { header: 'MAX', get: (r) => String(r['maxWorkers'] ?? ''), align: 'right' },
          { header: 'STATUS', get: (r) => String(r['status'] ?? '') },
          { header: 'FETCHED', get: (r) => String(r['lastFetchedAt'] ?? '') },
        ], { empty: 'no projects — run `conductor project add <git-url>`' });
      });
    }));

  project
    .command('show')
    .argument('<id>')
    .description('show a project')
    .action(async (id: string, _opts: unknown, command: Command) => run(async () => {
      const { client } = await session(command);
      const p = await client.wget<Record<string, unknown>>(`/projects/${encodeURIComponent(id)}`);
      emit(p, () => {
        fields([
          ['id', String(p['id'] ?? '')],
          ['name', String(p['name'] ?? '')],
          ['git', String(p['gitUrl'] ?? '')],
          ['branch', String(p['defaultBranch'] ?? '')],
          ['clone', String(p['clonePath'] ?? '')],
          ['runtime', String(p['runtimeId'] ?? '')],
          ['model', p['model'] === null ? '(runtime default)' : String(p['model'] ?? '')],
          ['max workers', String(p['maxWorkers'] ?? '')],
          ['setup', String(p['setupCommand'] ?? '')],
          ['worktrees', String(p['worktreeProvider'] ?? '')],
          ['openspec', p['openspecEnabled'] === true ? `enabled${p['openspecVersion'] ? ` (${String(p['openspecVersion'])})` : ''}` : 'disabled'],
          ['status', String(p['status'] ?? '')],
          ['error', p['errorText'] ? style.bad(String(p['errorText'])) : undefined],
        ]);
      });
    }));

  project
    .command('remove')
    .argument('<id>')
    .description('remove a project from the workspace')
    .action(async (id: string, _opts: unknown, command: Command) => run(async () => {
      const { client } = await session(command);
      const result = await client.del(client.w(`/projects/${encodeURIComponent(id)}`));
      emit(result ?? { ok: true }, () => write(`${style.ok('removed')} ${id}`));
    }));

  project
    .command('fetch')
    .argument('[id]', 'project id; omit to fetch every project')
    .description('fast-forward the primary clone')
    .action(async (id: string | undefined, _opts: unknown, command: Command) => run(async () => {
      const { client } = await session(command);
      const ids = id ? [id] : items<Record<string, unknown>>(await client.wget('/projects'), 'projects').map((p) => String(p['id']));
      const results: Array<Record<string, unknown>> = [];
      for (const projectId of ids) {
        const result = await client.wpost<Record<string, unknown>>(`/projects/${encodeURIComponent(projectId)}/fetch`, {});
        results.push({ id: projectId, ...(result ?? {}) });
      }
      emit(results, () => {
        table(results, [
          { header: 'PROJECT', get: (r) => String(r['id'] ?? '') },
          { header: 'HEAD', get: (r) => String(r['head'] ?? '') },
          { header: 'FAST-FORWARDED', get: (r) => (r['fastForwarded'] === true ? 'yes' : 'no') },
        ], { empty: 'no projects' });
      });
    }));

  project
    .command('set-runtime')
    .argument('<project>', 'project id')
    .argument('<runtime>', 'runtime id, e.g. claude, codex, opencode, gemini')
    .description('change the default runtime for roles in a project')
    .action(async (id: string, runtime: string, _opts: unknown, command: Command) => run(async () => {
      const { client } = await session(command);
      const updated = await client.patch<Record<string, unknown>>(client.w(`/projects/${encodeURIComponent(id)}`), { runtime });
      emit(updated, () => write(`${style.ok('updated')} ${id} runtime = ${String(updated?.['runtimeId'] ?? runtime)}`));
    }));

  project
    .command('set-policy')
    .argument('<project>', 'project id')
    .argument('<assignments...>', 'one or more key=value pairs')
    .description('change project policies (merged into the existing ones)')
    .addHelpText('after', `
Keys:   proposalApproval=human|conductor|none   mergeMethod=squash|merge|rebase
        deliveryMode=pr|local-branch            autoMergeDefault=true|false
        taskApproval=human|conductor|none       archiveCommit=push|pr|local
        requireCi=true|false
Example: conductor project set-policy api deliveryMode=pr requireCi=false`)
    .action(async (id: string, assignments: string[], _opts: unknown, command: Command) => run(async () => {
      const { client } = await session(command);
      const patch: Record<string, unknown> = {};
      for (const raw of assignments) {
        const eq = raw.indexOf('=');
        if (eq <= 0) throw new Error(`not a key=value pair: ${raw}`);
        patch[raw.slice(0, eq)] = coerce(raw.slice(eq + 1));
      }
      const current = await client.wget<Record<string, unknown>>(`/projects/${encodeURIComponent(id)}`);
      const policies = { ...((current['policies'] ?? {}) as Record<string, unknown>), ...patch };
      const updated = await client.patch<Record<string, unknown>>(client.w(`/projects/${encodeURIComponent(id)}`), { policies });
      emit(updated, () => {
        write(`${style.ok('updated')} ${id} policies`);
        fields(Object.entries(policies).map(([k, v]) => [k, String(v)] as [string, string]));
      });
    }));
}

/** `true`/`false` and plain integers are typed; everything else stays a string. */
function coerce(value: string): unknown {
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (/^-?\d+$/.test(value)) return Number(value);
  return value;
}
