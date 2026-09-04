/** `oc worktree list|verify|discard` — provider-managed worktrees (PLAN §11.5, §20). */
import type { Command } from 'commander';
import { emit, fields, style, table, write } from '../output.js';
import { promptTyped } from '../prompt.js';
import { items, run, session } from './util.js';

export function register(program: Command): void {
  const worktree = program.command('worktree').description('worktrees and landed-work verdicts');

  worktree
    .command('list', { isDefault: true })
    .option('-p, --project <id>')
    .description('list worktrees')
    .action(async (opts: Record<string, string>, command: Command) => run(async () => {
      const { client } = await session(command);
      const payload = await client.wget('/worktrees', { project: opts['project'] });
      const rows = items<Record<string, unknown>>(payload, 'worktrees');
      emit(payload, () => {
        table(rows, [
          { header: 'ID', get: (r) => String(r['id'] ?? '') },
          { header: 'WORKER', get: (r) => String(r['agentId'] ?? r['workerId'] ?? '') },
          { header: 'TICKET', get: (r) => String(r['ticketId'] ?? '') },
          { header: 'BRANCH', get: (r) => String(r['branch'] ?? '') },
          { header: 'STATUS', get: (r) => String(r['status'] ?? '') },
          { header: 'PATH', get: (r) => String(r['path'] ?? '') },
        ], { empty: 'no worktrees' });
      });
    }));

  worktree
    .command('verify')
    .argument('<id>', 'worktree id, worker id or ticket id')
    .description('verify a worktree: dirty files, ahead/behind, landed verdict')
    .action(async (id: string, _opts: unknown, command: Command) => run(async () => {
      const { client } = await session(command);
      const result = await client.write<Record<string, unknown>>({
        tool: 'oc_worktree_status', input: { id },
        http: { method: 'POST', path: client.w(`/worktrees/${encodeURIComponent(id)}/verify`), body: {} },
      });
      emit(result, () => {
        fields([
          ['status', String(result?.['status'] ?? '')],
          ['dirty', result?.['dirty'] === true ? style.warn('yes') : 'no'],
          ['ahead', String(result?.['ahead'] ?? '')],
          ['behind', String(result?.['behind'] ?? '')],
          ['landed', result?.['landed'] === true ? style.ok('yes') : 'no'],
          ['verdict', String(result?.['verdict'] ?? '')],
        ]);
      });
    }));

  worktree
    .command('discard')
    .argument('<id>')
    .option('--force', 'skip the typed confirmation')
    .description('discard a worktree — destructive')
    .action(async (id: string, opts: Record<string, boolean>, command: Command) => run(async () => {
      const { client } = await session(command);
      if (opts['force'] !== true) {
        const confirmed = await promptTyped(id, `Type ${id} to discard this worktree and any uncommitted work`);
        if (!confirmed) {
          emit({ discarded: false, reason: 'not confirmed' }, () => write(style.dim('not confirmed — nothing was discarded')));
          return;
        }
      }
      const result = await client.wpost(`/worktrees/${encodeURIComponent(id)}/discard`, { force: true });
      emit(result ?? { ok: true }, () => write(`${style.ok('discarded')} ${id}`));
    }));
}
