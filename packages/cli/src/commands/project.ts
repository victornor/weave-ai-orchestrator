/** `weave project add|list|show|remove|fetch|set-policy` (PLAN §20). The runtime is the
 * workspace's workers model setting — `weave models` (VS-77), not a per-project choice. */
import type { Command } from 'commander';
import type { Job } from '@weave-ai/shared';
import { ApiError } from '../api.js';
import { emit, fields, isJson, style, table, write, writeErr } from '../output.js';
import { elapsed, failureReport, followJob, formatMs } from '../jobs.js';
import { items, run, session } from './util.js';

export function register(program: Command): void {
  const project = program.command('project').description('projects in the workspace');

  project
    .command('add')
    .argument('<git-url>')
    .description('clone a repo, init OpenSpec, seed the project KB')
    .option('--id <id>', 'project id (slug)')
    .option('--branch <branch>', 'default branch')
    .option('--landing-branch <branch>', "the branch tickets' work lands on, when it differs from --branch (VS-119)")
    .option('--max-workers <n>', 'concurrent workers across all roles')
    .option('--setup <command>', 'setup command run once per new worktree')
    .option('--no-follow', 'return as soon as the job has started instead of watching it')
    .action(async (url: string, opts: Record<string, string | boolean>, command: Command) => run(async () => {
      const { client } = await session(command);
      const body: Record<string, unknown> = { url };
      if (opts['id']) body['id'] = opts['id'];
      if (opts['branch']) body['defaultBranch'] = opts['branch'];
      if (opts['landingBranch']) body['landingBranch'] = opts['landingBranch'];
      if (opts['maxWorkers']) body['maxWorkers'] = Number(opts['maxWorkers']);
      if (opts['setup']) body['setupCommand'] = opts['setup'];
      const started = await client.write<Started>({
        tool: 'weave_project_add', input: body,
        http: { method: 'POST', path: client.w('/projects'), body },
      });
      await reportJob(client, started, opts['follow'] === false, 'add');
    }));

  project
    .command('retry')
    .argument('<id>')
    .description('re-run a failed add, reusing whatever is already on disk')
    .option('--no-follow', 'return as soon as the job has started instead of watching it')
    .action(async (id: string, opts: Record<string, boolean>, command: Command) => run(async () => {
      const { client } = await session(command);
      const started = await client.wpost<Started>(`/projects/${encodeURIComponent(id)}/retry`, {});
      await reportJob(client, started, opts['follow'] === false, 'retry');
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
          { header: 'BRANCH', get: (r) => String(r['defaultBranch'] ?? '') },
          { header: 'LANDING', get: (r) => String(r['landingBranch'] ?? '') },
          { header: 'MAX', get: (r) => String(r['maxWorkers'] ?? ''), align: 'right' },
          { header: 'STATUS', get: (r) => String(r['status'] ?? '') },
          { header: 'FETCHED', get: (r) => String(r['lastFetchedAt'] ?? '') },
        ], { empty: 'no projects — run `weave project add <git-url>`' });
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
          ['landing branch', p['landingBranch'] ? String(p['landingBranch']) : undefined],
          ['clone', String(p['clonePath'] ?? '')],
          ['max workers', String(p['maxWorkers'] ?? '')],
          ['setup', String(p['setupCommand'] ?? '')],
          ['worktrees', String(p['worktreeProvider'] ?? '')],
          ['openspec', p['openspecEnabled'] === true ? `enabled${p['openspecVersion'] ? ` (${String(p['openspecVersion'])})` : ''}` : 'disabled'],
          ['yolo', (p['policies'] as Record<string, unknown> | undefined)?.['yolo'] === true ? 'on' : 'off'],
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
    .command('set-landing-branch')
    .argument('<id>', 'project id')
    .argument('[branch]', "the branch tickets' work is expected to reach (VS-119); omit with --clear")
    .option('--clear', 'clear it — checks run against the default branch again')
    .description("set, change or clear a project's landing branch after it was added")
    .action(async (id: string, branch: string | undefined, opts: Record<string, boolean>, command: Command) => run(async () => {
      const clear = opts['clear'] === true;
      if (clear && branch) throw new ApiError('validation', 'pass a branch or --clear, not both', 400);
      if (!clear && !branch) throw new ApiError('validation', 'pass a branch to set, or --clear to clear the landing branch', 400);
      const { client } = await session(command);
      const updated = await client.patch<Record<string, unknown>>(client.w(`/projects/${encodeURIComponent(id)}`), { landingBranch: branch ?? '' });
      emit(updated, () => {
        const inEffect = updated['landingBranch'] ? String(updated['landingBranch']) : `using default branch \`${String(updated['defaultBranch'] ?? '')}\``;
        write(`${style.ok('updated')} ${id}: landing branch = ${inEffect}`);
        write(style.dim('applies to the next ticket action; no daemon restart needed'));
      });
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
        requireCi=true|false                    mergeConcurrency=<1-8>
        yolo=true|false                         (YOLO mode for this project; off unless set)
Example: weave project set-policy api deliveryMode=pr requireCi=false`)
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

  project
    .command('set-openspec')
    .argument('<id>', 'project id')
    .argument('<state>', 'on or off')
    .description("turn a project's OpenSpec mode on or off after it was added (VS-578)")
    .action(async (id: string, state: string, _opts: unknown, command: Command) => run(async () => {
      if (state !== 'on' && state !== 'off') throw new ApiError('validation', 'state must be on or off', 400);
      const { client } = await session(command);
      const updated = await client.patch<Record<string, unknown>>(client.w(`/projects/${encodeURIComponent(id)}`), { openspec: { enabled: state === 'on' } });
      emit(updated, () => {
        write(`${style.ok('updated')} ${id}: openspec = ${updated['openspecEnabled'] === true ? 'enabled' : 'disabled'}`);
        write(style.dim('applies to tickets created from now on; tickets already bound to a change keep their OpenSpec flow'));
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

/** What `POST /projects` and `POST /projects/:id/retry` answer: the row, and the job doing the rest. */
interface Started { project?: Record<string, unknown> | null; jobId?: string | null }

/**
 * Watch the job the daemon started and report it the way the command used to report the finished
 * project — except that now the minutes in between are visible. `--json` still prints exactly one
 * document: the project as it ended up.
 */
async function reportJob(
  client: Awaited<ReturnType<typeof session>>['client'],
  started: Started | null,
  noFollow: boolean,
  verb: 'add' | 'retry',
): Promise<void> {
  const project = started?.project ?? {};
  const id = String(project['slug'] ?? project['id'] ?? '');
  const jobId = started?.jobId ? String(started.jobId) : null;

  if (!jobId || noFollow) {
    emit(project, () => {
      write(`${style.ok(verb === 'add' ? 'project add started' : 'project retry started')} ${id}`);
      fields([['status', String(project['status'] ?? '')], ['job', jobId ?? '(none)'], ['follow', jobId ? `weave project show ${id}` : '']]);
    });
    return;
  }

  const job = await followJob(client, jobId, { quiet: isJson() });
  const finished = await client.wget<Record<string, unknown>>(`/projects/${encodeURIComponent(id || String(project['id'] ?? ''))}`).catch(() => project);

  if (job.state === 'failed') {
    if (!isJson()) {
      for (const line of failureReport(job)) writeErr(line);
      writeErr(`retry with ${style.mono(`weave project retry ${id}`)}`);
    }
    throw new ApiError('internal', `project ${verb} failed at ${job.failedStep ?? 'an unknown step'}: ${job.message ?? 'no detail'}`, 500, { jobId, failedStep: job.failedStep });
  }

  emit(finished, () => {
    const took = formatMs(Date.parse(job.finishedAt ?? '') - Date.parse(job.startedAt));
    write(`${style.ok('project added')} ${String(finished?.['slug'] ?? finished?.['id'] ?? id)}${took ? style.dim(` in ${took}`) : ''}`);
    fields([
      ['status', String(finished?.['status'] ?? '')],
      ['branch', String(finished?.['defaultBranch'] ?? '')],
      ['clone', String(finished?.['clonePath'] ?? '')],
      ['openspec', describeStep(job, 'openspec')],
    ]);
  });
}

function describeStep(job: Job, stepId: string): string {
  const step = job.steps.find((s) => s.id === stepId);
  if (!step) return '';
  const took = elapsed(step);
  return step.state === 'skipped' ? 'skipped' : `${step.state}${took ? ` (${took})` : ''}`;
}
