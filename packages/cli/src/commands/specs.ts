/** `conductor specs list|show|changes|search|explore` — the spec index (PLAN §12.5). */
import type { Command } from 'commander';
import { oneLine } from '@agent-conductor/render';
import { ApiError } from '../api.js';
import { emit, fields, heading, style, table, write } from '../output.js';
import { items, run, session } from './util.js';

async function defaultProject(client: { wget: (p: string) => Promise<unknown> }, explicit?: string): Promise<string> {
  if (explicit) return explicit;
  const projects = items<Record<string, unknown>>(await client.wget('/projects'), 'projects');
  if (projects.length === 1) return String(projects[0]!['id']);
  throw new ApiError('validation', 'pass --project: this workspace has more than one', 400, { projects: projects.map((p) => String(p['id'])) });
}

/** `{ done, total }` from a change payload, printed as `done/total`. */
function taskProgress(v: unknown): string {
  const p = v as { done?: number; total?: number } | null | undefined;
  return p && typeof p.total === 'number' ? `${p.done ?? 0}/${p.total}` : '';
}

export function register(program: Command): void {
  const specs = program.command('specs').description('capabilities, requirements and changes');

  specs
    .command('list', { isDefault: true })
    .option('-p, --project <id>')
    .description('capabilities in a project')
    .action(async (opts: Record<string, string>, command: Command) => run(async () => {
      const { client } = await session(command);
      const project = await defaultProject(client, opts['project']);
      const payload = await client.wget(`/specs/${encodeURIComponent(project)}`);
      const rows = items<Record<string, unknown>>(payload, 'capabilities');
      emit(payload, () => {
        table(rows, [
          { header: 'CAPABILITY', get: (r) => String(r['capability'] ?? '') },
          { header: 'TITLE', get: (r) => oneLine(String(r['title'] ?? ''), 50) },
          { header: 'REQS', get: (r) => String(r['requirementCount'] ?? 0), align: 'right' },
          { header: 'PENDING', get: (r) => String(items<Record<string, unknown>>(r['pendingChanges']).length), align: 'right' },
          { header: 'UPDATED', get: (r) => String(r['updatedAt'] ?? '') },
        ], { empty: 'no capabilities indexed' });
      });
    }));

  specs
    .command('show')
    .argument('<capability>')
    .option('-p, --project <id>')
    .description('a capability with its requirements and pending deltas')
    .action(async (capability: string, opts: Record<string, string>, command: Command) => run(async () => {
      const { client } = await session(command);
      const project = await defaultProject(client, opts['project']);
      const payload = await client.wget<Record<string, unknown>>(`/specs/${encodeURIComponent(project)}/capabilities/${encodeURIComponent(capability)}`);
      emit(payload, () => {
        heading(String(payload['title'] ?? payload['capability'] ?? capability));
        const requirements = items<Record<string, unknown>>(payload['requirements']);
        for (const requirement of requirements) {
          write('');
          write(style.bold(String(requirement['name'] ?? '')));
          write(String(requirement['text'] ?? ''));
        }
        const pending = items<Record<string, unknown>>(payload['pending']);
        if (pending.length) {
          write('');
          heading('Pending deltas');
          table(pending, [
            { header: 'CHANGE', get: (p) => String(p['changeName'] ?? '') },
            { header: 'DELTA', get: (p) => String(p['deltaKind'] ?? '').toUpperCase() },
            { header: 'TICKET', get: (p) => String(p['ticketId'] ?? '') },
          ]);
        }
        const history = items<Record<string, unknown>>(payload['history']);
        if (history.length) {
          write('');
          heading('History');
          table(history, [
            { header: 'CHANGE', get: (h) => String(h['changeName'] ?? '') },
            { header: 'TICKET', get: (h) => String(h['ticketId'] ?? '') },
            { header: 'ARCHIVED', get: (h) => String(h['archivedAt'] ?? '') },
          ]);
        }
      });
    }));

  specs
    .command('changes')
    .option('-p, --project <id>')
    .option('--state <state>', 'active|archived (default: all)')
    .argument('[name]', 'show one change')
    .description('OpenSpec changes')
    .action(async (name: string | undefined, opts: Record<string, string>, command: Command) => run(async () => {
      const { client } = await session(command);
      const project = await defaultProject(client, opts['project']);
      if (name) {
        const change = await client.wget<Record<string, unknown>>(`/specs/${encodeURIComponent(project)}/changes/${encodeURIComponent(name)}`);
        emit(change, () => {
          fields([
            ['change', String(change['changeName'] ?? name)],
            ['state', String(change['state'] ?? '')],
            ['ticket', String(change['ticketIdentifier'] ?? change['ticketId'] ?? '')],
            ['tasks', taskProgress(change['taskProgress'])],
          ]);
          if (change['proposal']) { write(''); write(String(change['proposal'])); }
        });
        return;
      }
      const payload = await client.wget(`/specs/${encodeURIComponent(project)}/changes`, { state: opts['state'] });
      const rows = items<Record<string, unknown>>(payload, 'changes');
      emit(payload, () => {
        table(rows, [
          { header: 'CHANGE', get: (r) => String(r['changeName'] ?? '') },
          { header: 'STATE', get: (r) => String(r['state'] ?? '') },
          { header: 'TICKET', get: (r) => String(r['ticketIdentifier'] ?? r['ticketId'] ?? '') },
          { header: 'TASKS', get: (r) => taskProgress(r['taskProgress']) },
        ], { empty: 'no changes' });
      });
    }));

  specs
    .command('search')
    .argument('<query...>')
    .option('-p, --project <id>')
    .description('search knowledge and specs')
    .action(async (query: string[], opts: Record<string, string>, command: Command) => run(async () => {
      const { client } = await session(command);
      const payload = await client.write<unknown>({
        tool: 'ac_spec_search', input: { query: query.join(' '), projectId: opts['project'] },
        http: { method: 'GET', path: client.w('/search'), query: { q: query.join(' '), project: opts['project'] } },
      });
      const rows = items<Record<string, unknown>>(payload, 'results');
      emit(payload, () => {
        table(rows, [
          { header: 'KIND', get: (r) => String(r['kind'] ?? '') },
          { header: 'REF', get: (r) => String(r['ref'] ?? '') },
          { header: 'TITLE', get: (r) => oneLine(String(r['title'] ?? ''), 40) },
          { header: 'SNIPPET', get: (r) => oneLine(String(r['snippet'] ?? ''), 60) },
        ], { empty: 'nothing found' });
      });
    }));

  specs
    .command('explore')
    .argument('[project]')
    .description('browse capabilities, requirements and neighbours in the TUI')
    .action(async (project: string | undefined, _opts: unknown, command: Command) => run(async () => {
      const { client } = await session(command);
      const projectId = await defaultProject(client, project);
      const { runSpecs } = await import('@agent-conductor/tui');
      await runSpecs(client, projectId);
    }));
}
