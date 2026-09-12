/** `weave chat|say|briefing|attach|top|specs explore` — the human-facing front door (PLAN §21.2). */
import type { Command } from 'commander';
import type { Briefing, ChannelThread, ThreadMessage } from '@weave-ai/shared';
import { briefingToSections, oneLine } from '@weave-ai/render';
import { ApiError, type ApiClient } from '../api.js';
import { emit, heading, style, write } from '../output.js';
import { first, items, run, session } from './util.js';

/** The TUI is loaded lazily: `weave ticket list` must not pay for Ink and React. */
async function tui(): Promise<typeof import('@weave-ai/tui')> {
  try {
    return await import('@weave-ai/tui');
  } catch (cause) {
    throw new ApiError('internal', `the terminal UI is not installed (${(cause as Error).message}); install @weave-ai/tui or run with --json`, 500);
  }
}

export async function primaryThread(client: ApiClient): Promise<ChannelThread> {
  const existing = items<ChannelThread>(await client.wget('/threads', { channel: 'web' }), 'threads');
  const found = first(existing);
  if (found) return found;
  return client.wpost<ChannelThread>('/threads', { channel: 'web' });
}

export function register(program: Command): void {
  program
    .command('chat')
    .argument('[ticketId]', 'bind the thread to a ticket and talk to its worker')
    .description('interactive chat with the conductor (or a ticket worker)')
    .action(async (ticketId: string | undefined, _opts: unknown, command: Command) => run(async () => {
      const { client } = await session(command);
      const { runChat } = await tui();
      await runChat(client, ticketId ? { ticketId } : {});
    }));

  program
    .command('attach')
    .argument('<agent>', 'worker id, or "weaver"')
    .description('live transcript and steering for one agent')
    .action(async (agent: string, _opts: unknown, command: Command) => run(async () => {
      const { client } = await session(command);
      const { runAttach } = await tui();
      await runAttach(client, agent);
    }));

  program
    .command('top')
    .description('one-screen fleet view')
    .action(async (_opts: unknown, command: Command) => run(async () => {
      const { client } = await session(command);
      const { runTop } = await tui();
      await runTop(client);
    }));

  program
    .command('say')
    .argument('<text...>')
    .description('one-shot message to the conductor; prints the reply')
    .option('--timeout <seconds>', 'how long to wait for the reply', '180')
    .option('--no-wait', 'send without waiting for a reply')
    .action(async (text: string[], opts: Record<string, string | boolean>, command: Command) => run(async () => {
      const { client } = await session(command);
      const body = text.join(' ');
      const thread = await primaryThread(client);
      const threadId = String(thread?.id ?? '');
      if (!threadId) throw new ApiError('internal', 'the daemon did not return a chat thread', 500);

      if (opts['wait'] === false) {
        const sent = await client.wpost<ThreadMessage>(`/threads/${encodeURIComponent(threadId)}/messages`, { body });
        emit(sent, () => write(style.dim('sent')));
        return;
      }

      const timeoutMs = Math.max(1, Number(opts['timeout'] ?? 180)) * 1000;
      const reply = await new Promise<ThreadMessage | null>((resolve) => {
        let settled = false;
        const finish = (value: ThreadMessage | null) => {
          if (settled) return;
          settled = true;
          subscription.close();
          clearTimeout(timer);
          resolve(value);
        };
        const subscription = client.stream(client.w('/events'), {
          onMessage: (message) => {
            if (message.type !== 'thread.message') return;
            const event = message.json as { payload?: ThreadMessage } | null;
            const payload = event?.payload;
            if (!payload || String(payload.threadId ?? '') !== threadId) return;
            if (payload.direction !== 'outbound') return;
            finish(payload);
          },
        });
        const timer = setTimeout(() => finish(null), timeoutMs);
        // Post only once the stream is open, so a fast reply cannot be missed.
        setTimeout(() => {
          void client.wpost(`/threads/${encodeURIComponent(threadId)}/messages`, { body }).catch((error) => {
            finish(null);
            process.exitCode = 1;
            write(style.bad(String((error as Error).message)));
          });
        }, 150);
      });

      emit(reply ?? { reply: null, timedOut: true }, () => {
        if (!reply) {
          write(style.warn(`no reply within ${Number(opts['timeout'] ?? 180)}s — it may still arrive; see \`weave chat\``));
          process.exitCode = 2;
          return;
        }
        write(String(reply.body ?? ''));
      });
    }));

  program
    .command('briefing')
    .description('the four-section briefing, rendered from the snapshot (no LLM)')
    .action(async (_opts: unknown, command: Command) => run(async () => {
      const { client } = await session(command);
      const briefing = await client.wget<Briefing>('/briefing');
      const model = briefingToSections(briefing, {});
      emit(briefing, () => {
        write(style.bold(model.headline));
        for (const section of model.sections) {
          write('');
          heading(`${section.title}${section.count ? ` (${section.count})` : ''}`);
          if (section.empty) {
            write(style.dim(`  ${section.emptyLine}`));
            continue;
          }
          for (const item of section.items) {
            write(`  ${item.glyph} ${oneLine(item.primary, 80)}${item.meta ? style.dim(`  ${item.meta}`) : ''}`);
            if (item.secondary) write(`     ${style.dim(oneLine(item.secondary, 90))}`);
          }
        }
        if (model.warnings.length) {
          write('');
          heading('Warnings');
          for (const warning of model.warnings) write(`  ${style.warn(warning)}`);
        }
      });
    }));
}

export { tui };
