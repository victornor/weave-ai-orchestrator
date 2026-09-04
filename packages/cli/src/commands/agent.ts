/** `oc agent inbox` and friends — the run-token surface for agents (PLAN §9.5). */
import type { Command } from 'commander';
import { oneLine } from '@openconductor/render';
import { ApiError } from '../api.js';
import { emit, heading, style, table, write } from '../output.js';
import { items, run, session } from './util.js';

export function register(program: Command): void {
  const agent = program.command('agent').description('agent-facing commands (need OC_RUN_TOKEN)');

  agent
    .command('inbox', { isDefault: true })
    .description('what this agent has to do now')
    .action(async (_opts: unknown, command: Command) => run(async () => {
      const { client } = await session(command);
      if (!client.isAgent) throw new ApiError('forbidden', 'oc agent inbox needs OC_RUN_TOKEN (it is meant for agents inside a run)', 403);
      const payload = await client.wget<Record<string, unknown>>('/agent/inbox');
      emit(payload, () => {
        const tickets = items<Record<string, unknown>>(payload['tickets']);
        const decisions = items<Record<string, unknown>>(payload['decisions']);
        const messages = items<Record<string, unknown>>(payload['messages']);
        if (payload['reason']) write(`${style.dim('woken by')} ${String(payload['reason'])}`);
        if (tickets.length) {
          heading('Tickets');
          table(tickets, [
            { header: 'ID', get: (t) => String(t['identifier'] ?? t['id'] ?? '') },
            { header: 'STATUS', get: (t) => String(t['status'] ?? '') },
            { header: 'TITLE', get: (t) => oneLine(String(t['title'] ?? ''), 60) },
          ]);
        }
        if (decisions.length) {
          write('');
          heading('Decisions');
          table(decisions, [
            { header: 'ID', get: (d) => String(d['id'] ?? '') },
            { header: 'KIND', get: (d) => String(d['kind'] ?? '') },
            { header: 'TITLE', get: (d) => oneLine(String(d['title'] ?? ''), 60) },
            { header: 'STATUS', get: (d) => String(d['status'] ?? '') },
          ]);
        }
        if (messages.length) {
          write('');
          heading('Messages');
          for (const message of messages) write(`  ${String(message['body'] ?? '')}`);
        }
        if (!tickets.length && !decisions.length && !messages.length) write(style.dim('inbox is empty'));
      });
    }));

  agent
    .command('report')
    .argument('<json>', 'the structured final report (or - for stdin)')
    .description('submit the structured final report for this turn')
    .action(async (json: string, _opts: unknown, command: Command) => run(async () => {
      const { client } = await session(command);
      if (!client.isAgent) throw new ApiError('forbidden', 'oc agent report needs OC_RUN_TOKEN', 403);
      const raw = json === '-' ? await readStdin() : json;
      let parsed: unknown;
      try { parsed = JSON.parse(raw); } catch (cause) { throw new ApiError('validation', `report is not valid JSON: ${(cause as Error).message}`, 400); }
      const result = await client.tool('oc_report', parsed as Record<string, unknown>);
      emit(result, () => write(style.ok('report submitted')));
    }));

  agent
    .command('ask')
    .argument('<title...>')
    .option('--option <key=label>', 'repeatable option', (value: string, previous: string[] = []) => [...previous, value], [])
    .option('--context <text>', 'one-line context', '')
    .option('--free-text', 'allow a free-text answer')
    .description('ask the human (or the conductor) a question and block until it is answered')
    .action(async (title: string[], opts: Record<string, unknown>, command: Command) => run(async () => {
      const { client } = await session(command);
      if (!client.isAgent) throw new ApiError('forbidden', 'oc agent ask needs OC_RUN_TOKEN', 403);
      const options = (opts['option'] as string[] | undefined ?? []).map((pair) => {
        const idx = pair.indexOf('=');
        return idx === -1 ? { key: pair, label: pair } : { key: pair.slice(0, idx), label: pair.slice(idx + 1) };
      });
      const result = await client.tool('oc_ask', {
        title: title.join(' '),
        context: String(opts['context'] ?? ''),
        options,
        allowFreeText: opts['freeText'] === true,
      });
      emit(result, () => write(JSON.stringify(result)));
    }));

  agent
    .command('human')
    .argument('<text...>')
    .description('send a message to the human through the primary channel')
    .action(async (text: string[], _opts: unknown, command: Command) => run(async () => {
      const { client } = await session(command);
      if (!client.isAgent) throw new ApiError('forbidden', 'oc agent human needs OC_RUN_TOKEN', 403);
      const result = await client.tool('oc_human_send', { text: text.join(' ') });
      emit(result, () => write(style.ok('sent')));
    }));
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}
