#!/usr/bin/env node
import { createInterface } from 'node:readline';
import { runAgentTurn, type LoopIO } from './loop.js';
import { parseParentLine, type ChildMessage, type ChildResult, type InitMessage } from './protocol.js';

/** The child entry: reads `init` from stdin, runs one turn, writes exactly one `result` to stdout, exits with its code. */
function write(m: ChildMessage): void { process.stdout.write(`${JSON.stringify(m)}\n`); }

async function main(): Promise<void> {
  // stdout is the protocol channel: anything a library prints goes to stderr.
  for (const k of ['log', 'info', 'debug', 'warn'] as const) console[k] = (...a: unknown[]) => { process.stderr.write(`${a.map(String).join(' ')}\n`); };

  const ac = new AbortController();
  const onSignal = (): void => ac.abort();
  process.on('SIGTERM', onSignal);
  process.on('SIGINT', onSignal);

  let init: InitMessage | null = null;
  const initSeen = new Promise<InitMessage | null>((resolve) => {
    const rl = createInterface({ input: process.stdin });
    rl.on('line', (line) => {
      const m = parseParentLine(line);
      if (!m) return;
      if (m.type === 'init') { init = m; resolve(m); }
      else if (m.type === 'cancel') ac.abort();
      // `send` is not supported in this slice: live input arrives with S7.
    });
    // The adapter closing our stdin means it is gone or is cancelling.
    rl.on('close', () => { if (init) ac.abort(); resolve(null); });
  });
  const first0 = await initSeen;
  if (!first0) { write({ t: 'log', level: 'error', msg: 'no init message received' }); process.exit(2); }

  const first = process.argv.includes('--compact') ? { ...first0, mode: 'compact' as const } : first0;
  const io: LoopIO = {
    emit: (ev) => write({ t: 'event', ev }),
    partial: (p) => write({ t: 'partial', p }),
    log: (level, msg, fields) => write({ t: 'log', level, msg, ...(fields ? { fields } : {}) }),
  };
  let result: ChildResult;
  try { result = await runAgentTurn(first, io, ac.signal); }
  catch (e) { result = { exitCode: 1, signal: null, timedOut: false, session: null, finalText: null, error: { code: 'agent_crashed', family: 'unknown', message: (e as Error).message } }; }
  write({ t: 'result', result });
  process.stdout.write('', () => process.exit(result.exitCode ?? 0));
}

void main();
