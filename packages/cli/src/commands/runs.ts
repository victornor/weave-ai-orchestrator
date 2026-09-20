/** `weave runs list|show|tail|cancel` (PLAN §16.1, §20). */
import type { Command } from 'commander';
import type { Run, RunDeltaFrame, RunEvent, RunLiveSnapshot } from '@weave-ai/shared';
import { RUNTIME_PARTIAL_OUTPUT } from '@weave-ai/shared';
import { applyDelta, dropSuperseded, formatCost, formatDuration, formatTokens, fromSnapshot, liveTurn, liveTurnLine, runEventFromFrame, runEventsToTranscript, type LiveTurn, type PartialMap, type TranscriptBlock } from '@weave-ai/render';
import { emit, fields, heading, style, table, write } from '../output.js';
import { items, run as guard, session, unwrap } from './util.js';

/** The live `liveTurn` for a followed run, over its events and partial output (VS-603). */
export function runsTailTurn(events: readonly RunEvent[], partials: readonly { partId: string; kind: 'text' | 'thinking' | 'tool_input'; text: string }[], now: number, runtimeId: string | null): LiveTurn {
  const partialOutput = runtimeId ? RUNTIME_PARTIAL_OUTPUT[runtimeId] ?? 'none' : 'none';
  return liveTurn(events, partials, now, { partialOutput });
}

/** One transcript block as a terminal line (the TUI renders the same model with widgets). */
export function renderBlock(block: TranscriptBlock): string[] {
  switch (block.kind) {
    case 'text': return [String(block.text)];
    case 'thinking': return [style.dim(String(block.text))];
    case 'tool': return [`${style.dim(block.status === 'pending' ? '·' : '▸')} ${block.collapsed}`];
    case 'file': return [`${style.dim('▸')} ${block.collapsed}`];
    case 'phase': return [style.dim(block.text)];
    case 'status': return [block.tone === 'error' ? style.bad(block.text) : block.tone === 'warn' ? style.warn(block.text) : style.dim(block.text)];
    case 'error': return [style.bad(`error${block.code ? ` ${block.code}` : ''}: ${block.message}`)];
    default: return [];
  }
}

export function register(program: Command): void {
  const runs = program.command('runs').description('agent runs');

  runs
    .command('list', { isDefault: true })
    .description('list runs')
    .option('-a, --agent <id>')
    .option('-t, --ticket <id>')
    .option('-s, --status <statuses>', 'comma-separated run statuses')
    .option('--limit <n>', 'max rows', '30')
    .action(async (opts: Record<string, string>, command: Command) => guard(async () => {
      const { client } = await session(command);
      const payload = await client.wget('/runs', { agent: opts['agent'], ticket: opts['ticket'], status: opts['status'], limit: opts['limit'] });
      const rows = items<Run>(payload, 'runs');
      emit(payload, () => {
        table(rows, [
          { header: 'ID', get: (r) => String(r.id ?? '') },
          { header: 'AGENT', get: (r) => String(r.agentId ?? '') },
          { header: 'TICKET', get: (r) => String(r.ticketId ?? '') },
          { header: 'STATUS', get: (r) => String(r.status ?? '') },
          { header: 'MODEL', get: (r) => String(r.model ?? '') },
          { header: 'TOKENS', get: (r) => formatTokens((r.usage?.inputTokens ?? 0) + (r.usage?.outputTokens ?? 0)), align: 'right' },
          { header: 'COST', get: (r) => formatCost(r.costCents ?? null, null), align: 'right' },
          { header: 'STARTED', get: (r) => String(r.startedAt ?? '') },
        ], { empty: 'no runs' });
      });
    }));

  runs
    .command('show')
    .argument('<id>')
    .description('run detail with its transcript')
    .option('--events <n>', 'how many events to render', '400')
    .option('--raw', 'print the raw jsonl log instead')
    .action(async (id: string, opts: Record<string, string | boolean>, command: Command) => guard(async () => {
      const { client } = await session(command);
      if (opts['raw'] === true) {
        const log = await client.request<string>('GET', client.w(`/runs/${encodeURIComponent(id)}/log`), { raw: true });
        write(log);
        return;
      }
      const payload = await client.wget<unknown>(`/runs/${encodeURIComponent(id)}`);
      const detail = unwrap<Run>(payload, 'run');
      const events = items<RunEvent>(await client.wget(`/runs/${encodeURIComponent(id)}/events`, { limit: opts['events'] as string }), 'events');
      const blocks = runEventsToTranscript(events);
      emit({ run: detail, events }, () => {
        fields([
          ['run', String(detail.id ?? '')],
          ['agent', String(detail.agentId ?? '')],
          ['ticket', String(detail.ticketId ?? '')],
          ['status', String(detail.status ?? '')],
          ['runtime', `${String(detail.runtimeId ?? '')}${detail.model ? ` · ${detail.model}` : ''}`],
          ['liveness', String(detail.liveness ?? '')],
          ['tokens', formatTokens((detail.usage?.inputTokens ?? 0) + (detail.usage?.outputTokens ?? 0))],
          ['cost', formatCost(detail.costCents ?? null, null)],
          ['duration', detail.startedAt && detail.finishedAt ? formatDuration(Date.parse(detail.finishedAt) - Date.parse(detail.startedAt)) : ''],
          ['error', detail.errorCode ? style.bad(`${detail.errorCode}${detail.errorFamily ? ` (${detail.errorFamily})` : ''}`) : undefined],
          ['summary', detail.summary ?? undefined],
        ]);
        if (blocks.length) {
          write('');
          heading('Transcript');
          for (const block of blocks) for (const line of renderBlock(block)) write(line);
        }
      });
    }));

  runs
    .command('tail')
    .argument('<id>')
    .description('follow a run live')
    .action(async (id: string, _opts: unknown, command: Command) => guard(async () => {
      const { client } = await session(command);
      const runtimeId = unwrap<Run>(await client.wget<unknown>(`/runs/${encodeURIComponent(id)}`), 'run')?.runtimeId ?? null;
      const events = items<RunEvent>(await client.wget(`/runs/${encodeURIComponent(id)}/events`, { limit: 200 }), 'events');
      for (const block of runEventsToTranscript(events)) for (const line of renderBlock(block)) write(line);
      const lastSeq = events.length ? events[events.length - 1]!.seq : 0;

      // VS-603: the live row. Frames arrive many times a second; the line is printed only when the
      // state or label changes, so a busy turn does not flood the transcript.
      let partials: PartialMap = new Map();
      let lastLabel: string | null = null;
      const printLive = (): void => {
        const turn = runsTailTurn(events, dropSuperseded(partials, events), Date.now(), runtimeId);
        if (turn.label === lastLabel) return;
        lastLabel = turn.label;
        write(style.dim(liveTurnLine(turn)));
      };
      const readLive = (): void => {
        void client.wget<RunLiveSnapshot>(`/runs/${encodeURIComponent(id)}/live`)
          .then((snap) => { if (snap?.partials?.length) { partials = fromSnapshot(snap); printLive(); } })
          .catch(() => undefined);
      };
      readLive();

      await new Promise<void>((resolve) => {
        const subscription = client.stream(client.w(`/runs/${encodeURIComponent(id)}/events/stream`), {
          after: lastSeq,
          onMessage: (message) => {
            const runEvent = runEventFromFrame(message.json);
            if (!runEvent) return;
            events.push(runEvent);
            if (events.length > 500) events.splice(0, events.length - 500);
            for (const block of runEventsToTranscript([runEvent])) for (const line of renderBlock(block)) write(line);
          },
          onError: (_error, attempt) => {
            if (attempt === 1) write(style.warn('reconnecting…'));
          },
        });
        // `run.delta` is live-only on the workspace stream (never on the per-run one), so the live
        // row needs its own subscription here.
        const liveSubscription = client.stream(client.w('/events'), {
          onMessage: (message) => {
            if (message.type !== 'run.delta') return;
            const frame = (message.json as { payload?: RunDeltaFrame } | null)?.payload ?? null;
            if (!frame || frame.runId !== id || !Array.isArray(frame.parts)) return;
            const applied = applyDelta(partials, frame.parts);
            partials = applied.map;
            if (applied.gap) readLive();
            printLive();
          },
        });
        process.once('SIGINT', () => { subscription.close(); liveSubscription.close(); resolve(); });
      });
    }));

  runs
    .command('cancel')
    .argument('<id>')
    .option('--mode <mode>', 'interrupt|kill', 'interrupt')
    .description('cancel a run')
    .action(async (id: string, opts: Record<string, string>, command: Command) => guard(async () => {
      const { client } = await session(command);
      const result = await client.wpost(`/runs/${encodeURIComponent(id)}/cancel`, { mode: opts['mode'] ?? 'interrupt' });
      emit(result ?? { ok: true }, () => write(`${style.ok('cancelled')} ${id}`));
    }));
}
