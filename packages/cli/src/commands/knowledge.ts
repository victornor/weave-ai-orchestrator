/** `conductor knowledge show|edit|note|lint|curate|revert` (PLAN §13, §20). */
import type { Command } from 'commander';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { KNOWLEDGE_SCOPES } from '@agent-conductor/shared';
import { budgetMeter, formatRelative, formatTokens } from '@agent-conductor/render';
import { ApiError } from '../api.js';
import { emit, fields, style, table, write } from '../output.js';
import { items, run, session } from './util.js';

interface KnowledgeDoc { path?: string; body?: string; tokenEstimate?: number; budgetTokens?: number; lastCuratedAt?: string | null; curationPending?: boolean; revision?: number }

export function register(program: Command): void {
  const knowledge = program.command('knowledge').description('knowledge bases');

  knowledge
    .command('lint', { isDefault: true })
    .description('sizes, budgets and curation state for every KB')
    .action(async (_opts: unknown, command: Command) => run(async () => {
      const { client } = await session(command);
      const payload = await client.wget('/knowledge');
      const rows = items<Record<string, unknown>>(payload, 'files');
      emit(payload, () => {
        table(rows, [
          { header: 'PATH', get: (r) => String(r['path'] ?? '') },
          { header: 'SCOPE', get: (r) => String(r['scope'] ?? '') },
          { header: 'PROJECT', get: (r) => String(r['projectId'] ?? '') },
          { header: 'TOKENS', get: (r) => formatTokens(Number(r['tokenEstimate'] ?? 0)), align: 'right' },
          { header: 'BUDGET', get: (r) => formatTokens(Number(r['budgetTokens'] ?? 0)), align: 'right' },
          {
            header: 'USE',
            get: (r) => {
              const meter = budgetMeter({ label: '', tokenEstimate: Number(r['tokenEstimate'] ?? 0), budgetTokens: Number(r['budgetTokens'] ?? 0), curationPending: r['curationPending'] === true });
              const pct = `${Math.round(meter.pct * 100)}%`;
              return meter.tone === 'over' ? style.bad(pct) : meter.tone === 'warn' ? style.warn(pct) : pct;
            },
            align: 'right',
          },
          { header: 'CURATED', get: (r) => (r['lastCuratedAt'] ? formatRelative(String(r['lastCuratedAt'])) : 'never') },
          { header: 'PENDING', get: (r) => (r['curationPending'] === true ? 'yes' : '') },
        ], { empty: 'no knowledge files yet' });
      });
    }));

  knowledge
    .command('show')
    .argument('<scope>', KNOWLEDGE_SCOPES.join('|'))
    .option('-p, --project <id>', 'project scope needs a project')
    .description('print a knowledge base')
    .action(async (scope: string, opts: Record<string, string>, command: Command) => run(async () => {
      const { client } = await session(command);
      const doc = await client.wget<KnowledgeDoc>(`/knowledge/${encodeURIComponent(scope)}`, { project: opts['project'] });
      emit(doc, () => {
        fields([
          ['path', String(doc.path ?? '')],
          ['tokens', `${formatTokens(doc.tokenEstimate ?? 0)} / ${formatTokens(doc.budgetTokens ?? 0)}`],
          ['curated', doc.lastCuratedAt ? formatRelative(doc.lastCuratedAt) : 'never'],
          ['revision', String(doc.revision ?? '')],
        ]);
        write('');
        write(String(doc.body ?? ''));
      });
    }));

  knowledge
    .command('edit')
    .argument('<scope>')
    .option('-p, --project <id>')
    .option('--reason <reason>', 'revision reason', 'human')
    .description('edit a knowledge base in $EDITOR and save it back')
    .action(async (scope: string, opts: Record<string, string>, command: Command) => run(async () => {
      const { client } = await session(command);
      const doc = await client.wget<KnowledgeDoc>(`/knowledge/${encodeURIComponent(scope)}`, { project: opts['project'] });
      const editor = process.env['VISUAL'] ?? process.env['EDITOR'];
      if (!editor) throw new ApiError('validation', 'set $EDITOR (or $VISUAL) to edit knowledge from the CLI', 400);
      const dir = mkdtempSync(join(tmpdir(), 'ac-knowledge-'));
      const file = join(dir, `${scope}${opts['project'] ? `-${opts['project']}` : ''}.md`);
      writeFileSync(file, String(doc.body ?? ''));
      const before = readFileSync(file, 'utf8');
      const result = spawnSync(editor, [file], { stdio: 'inherit', shell: true });
      if (result.status !== 0) throw new ApiError('internal', `${editor} exited with ${result.status}`, 500);
      const after = readFileSync(file, 'utf8');
      if (after === before) {
        emit({ changed: false }, () => write(style.dim('unchanged')));
        return;
      }
      const saved = await client.put(client.w(`/knowledge/${encodeURIComponent(scope)}`), { body: after }, { query: { project: opts['project'] } });
      emit(saved, () => write(`${style.ok('saved')} ${scope}${opts['project'] ? ` (${opts['project']})` : ''}`));
    }));

  knowledge
    .command('note')
    .argument('<scope>')
    .argument('<section>')
    .argument('<text...>')
    .option('-p, --project <id>')
    .description('append a note to a section')
    .action(async (scope: string, section: string, text: string[], opts: Record<string, string>, command: Command) => run(async () => {
      const { client } = await session(command);
      const body = { section, text: text.join(' ') };
      const result = await client.write({
        tool: 'ac_knowledge_note', input: { scope, projectId: opts['project'], ...body },
        http: { method: 'POST', path: client.w(`/knowledge/${encodeURIComponent(scope)}/note`), body, query: { project: opts['project'] } },
      });
      emit(result, () => write(`${style.ok('noted')} in ${scope}/${section}`));
    }));

  knowledge
    .command('revisions')
    .argument('<scope>')
    .option('-p, --project <id>')
    .description('revision history')
    .action(async (scope: string, opts: Record<string, string>, command: Command) => run(async () => {
      const { client } = await session(command);
      const payload = await client.wget(`/knowledge/${encodeURIComponent(scope)}/revisions`, { project: opts['project'] });
      const rows = items<Record<string, unknown>>(payload, 'revisions');
      emit(payload, () => {
        table(rows, [
          { header: 'REV', get: (r) => String(r['revision'] ?? ''), align: 'right' },
          { header: 'AUTHOR', get: (r) => String(r['authorKind'] ?? '') },
          { header: 'REASON', get: (r) => String(r['reason'] ?? '') },
          { header: 'WHEN', get: (r) => String(r['createdAt'] ?? '') },
        ], { empty: 'no revisions' });
      });
    }));

  knowledge
    .command('revert')
    .argument('<scope>')
    .argument('<revision>')
    .option('-p, --project <id>')
    .description('revert a knowledge base to a revision')
    .action(async (scope: string, revision: string, opts: Record<string, string>, command: Command) => run(async () => {
      const { client } = await session(command);
      const result = await client.post(client.w(`/knowledge/${encodeURIComponent(scope)}/revert`), { revision: Number(revision) }, { query: { project: opts['project'] } });
      emit(result, () => write(`${style.ok('reverted')} ${scope} to revision ${revision}`));
    }));

  knowledge
    .command('curate')
    .argument('<scope>')
    .option('-p, --project <id>')
    .description('ask the daemon to curate a knowledge base now')
    .action(async (scope: string, opts: Record<string, string>, command: Command) => run(async () => {
      const { client } = await session(command);
      const result = await client.post(client.w(`/knowledge/${encodeURIComponent(scope)}/curate`), {}, { query: { project: opts['project'] } });
      emit(result, () => write(`${style.ok('curation queued')} for ${scope}`));
    }));
}
