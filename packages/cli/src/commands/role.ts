/** `conductor role ...` — roles are templates; workers are the things that run (PLAN §11, §20). */
import type { Command } from 'commander';
import { emit, fields, heading, style, table, write } from '../output.js';
import { statusGlyph } from '@agent-conductor/render';
import { items, run, session } from './util.js';
import { ApiError } from '../api.js';

function roleUiStatus(status: string): string {
  switch (status) {
    case 'active': return 'idle';
    case 'paused': return 'paused';
    case 'retired': return 'done';
    default: return 'needs-you';
  }
}

export function register(program: Command): void {
  const role = program.command('role').description('roles (hired job descriptions)');

  role
    .command('list', { isDefault: true })
    .description('list roles')
    .option('-p, --project <id>', 'filter by project')
    .action(async (opts: Record<string, string>, command: Command) => run(async () => {
      const { client } = await session(command);
      const payload = await client.wget('/roles', opts['project'] ? { project: opts['project'] } : undefined);
      const rows = items<Record<string, unknown>>(payload, 'roles');
      emit(payload, () => {
        table(rows, [
          { header: '', get: (r) => statusGlyph(roleUiStatus(String(r['status'] ?? ''))) },
          { header: 'ID', get: (r) => String(r['id'] ?? '') },
          { header: 'NAME', get: (r) => String(r['name'] ?? '') },
          { header: 'PROJECT', get: (r) => String(r['projectId'] ?? '') },
          { header: 'MAX', get: (r) => String(r['maxWorkers'] ?? ''), align: 'right' },
          { header: 'STATUS', get: (r) => String(r['status'] ?? '') },
        ], { empty: 'no roles yet — ask the conductor to hire one' });
      });
    }));

  role
    .command('show')
    .argument('<id>')
    .description('role spec, charter and live workers')
    .action(async (id: string, _opts: unknown, command: Command) => run(async () => {
      const { client } = await session(command);
      const payload = await client.wget<Record<string, unknown>>(`/roles/${encodeURIComponent(id)}`);
      const spec = (payload['role'] ?? payload) as Record<string, unknown>;
      const conc = (payload['concurrency'] ?? {}) as Record<string, unknown>;
      emit(payload, () => {
        fields([
          ['id', String(spec['id'] ?? '')],
          ['name', String(spec['name'] ?? '')],
          ['project', String(spec['projectId'] ?? '')],
          ['session', String(spec['sessionPolicy'] ?? '')],
          ['max workers', String(spec['maxWorkers'] ?? '')],
          ['effective', conc['effective'] === undefined
            ? '(unknown)'
            : `${conc['effective']} concurrent · ${conc['live'] ?? 0} live · ${conc['free'] ?? 0} free${Number(conc['projectMax']) < Number(conc['roleMax']) ? ` (capped by the project limit of ${conc['projectMax']})` : ''}`],
          ['status', String(spec['status'] ?? '')],
          ['scope', String(spec['scopeText'] ?? '')],
          ['charter', String(spec['charterSummary'] ?? '')],
        ]);
        const workers = items<Record<string, unknown>>(payload['workers'], 'workers');
        if (workers.length) {
          write('');
          heading('Workers');
          table(workers, [
            { header: 'ID', get: (w) => String(w['id'] ?? '') },
            { header: 'NAME', get: (w) => String(w['name'] ?? '') },
            { header: 'TICKET', get: (w) => String(w['ticketId'] ?? '') },
            { header: 'STATUS', get: (w) => String(w['status'] ?? '') },
          ]);
        }
        const revisions = items<Record<string, unknown>>(payload['revisions'], 'revisions');
        if (revisions.length) {
          write('');
          heading('Charter revisions');
          table(revisions, [
            { header: 'REV', get: (r) => String(r['revision'] ?? ''), align: 'right' },
            { header: 'AUTHOR', get: (r) => String(r['author'] ?? '') },
            { header: 'REASON', get: (r) => String(r['reason'] ?? '') },
            { header: 'WHEN', get: (r) => String(r['createdAt'] ?? '') },
          ]);
        }
      });
    }));

  role
    .command('activate')
    .argument('<id>')
    .description('activate a hired role so it can pick up tickets')
    .action(async (id: string, _opts: unknown, command: Command) => run(async () => {
      const { client } = await session(command);
      const result = await client.wpost(`/roles/${encodeURIComponent(id)}/activate`, {});
      emit(result, () => write(`${style.ok('activated')} ${id}`));
    }));

  role
    .command('set-max-workers')
    .argument('<id>')
    .argument('<n>', 'how many workers this role may run at once (1-32)')
    .option('--reason <reason>')
    .description('change how many workers a role may run at once')
    .action(async (id: string, n: string, opts: Record<string, string>, command: Command) => run(async () => {
      const maxWorkers = Number(n);
      if (!Number.isInteger(maxWorkers) || maxWorkers < 1 || maxWorkers > 32) throw new ApiError('validation', `max workers must be a whole number between 1 and 32, not "${n}"`, 400);
      const { client } = await session(command);
      const reason = opts['reason'] ?? `set max workers to ${maxWorkers}`;
      const result = await client.write({
        tool: 'ac_role_set_max_workers', input: { id, maxWorkers, reason },
        http: { method: 'PATCH', path: client.w(`/roles/${encodeURIComponent(id)}`), body: { patch: { maxWorkers }, reason } },
      });
      emit(result, () => write(`${style.ok('updated')} ${id}: max workers = ${maxWorkers}`));
    }));

  for (const verb of ['pause', 'resume', 'retire'] as const) {
    role
      .command(verb)
      .argument('<id>')
      .option('--reason <reason>', 'why', verb === 'resume' ? '' : `${verb}d from the CLI`)
      .description(`${verb} a role`)
      .action(async (id: string, opts: Record<string, string>, command: Command) => run(async () => {
        const { client } = await session(command);
        const tool = verb === 'pause' ? 'ac_role_pause' : verb === 'resume' ? 'ac_role_resume' : 'ac_role_retire';
        const result = await client.write({
          tool, input: { roleId: id, reason: opts['reason'] ?? '' },
          http: { method: 'POST', path: client.w(`/roles/${encodeURIComponent(id)}/${verb}`), body: { reason: opts['reason'] ?? '' } },
        });
        emit(result, () => write(`${style.ok(`${verb}d`)} ${id}`));
      }));
  }

  const charter = role.command('charter').description('role charters');

  charter
    .command('show')
    .argument('<id>')
    .description('print the charter markdown')
    .action(async (id: string, _opts: unknown, command: Command) => run(async () => {
      const { client } = await session(command);
      const payload = await client.wget<Record<string, unknown>>(`/roles/${encodeURIComponent(id)}`);
      const text = String(payload['charter'] ?? '');
      emit({ id, charter: text }, () => write(text || style.dim('(no charter yet)')));
    }));

  charter
    .command('rollback')
    .argument('<id>')
    .argument('<revision>')
    .description('roll the charter back to a revision')
    .action(async (id: string, revision: string, _opts: unknown, command: Command) => run(async () => {
      const { client } = await session(command);
      const result = await client.wpost(`/roles/${encodeURIComponent(id)}/rollback`, { revision: Number(revision) });
      emit(result, () => write(`${style.ok('rolled back')} ${id} to revision ${revision}`));
    }));
}
