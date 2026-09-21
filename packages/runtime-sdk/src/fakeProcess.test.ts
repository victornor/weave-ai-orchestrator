import { existsSync, readFileSync, rmSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import type { RuntimeAdapter, TurnInput, TurnResult } from './index.js';
import { interruptedTurn, waitFor, writeFakeProcess } from './fakeProcess.js';
import { spawnLines } from './process.js';

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
const fake = (spec: Parameters<typeof writeFakeProcess>[0]) => { const p = writeFakeProcess(spec); dirs.push(p.dir); return p; };

const input: TurnInput = {
  runId: 'r-660', turnEpoch: 1, cwd: process.cwd(), worktree: null,
  session: { policy: 'fresh', ref: null, isFirstTurn: true },
  systemPrompt: { text: '', mode: 'skip' }, prompt: 'x',
  mcpServers: {}, env: {}, options: {}, limits: { timeoutMs: 1000 }, permission: { mode: 'auto' },
};

/** A stand-in adapter: emits one event, hands back a handle, and resolves only when cancelled. */
function stubAdapter(cancel: (settle: () => void) => void): Pick<RuntimeAdapter, 'runTurn'> {
  return {
    runTurn: (_input, sink, onHandle) => {
      sink.onEvent({ ts: new Date().toISOString(), type: 'session.started', payload: {} });
      let settle!: () => void;
      const done = new Promise<TurnResult>((resolve) => { settle = () => resolve({ exitCode: 143, signal: 'SIGTERM', timedOut: false, session: null, finalText: null }); });
      onHandle?.({ pid: 1, cancel: async () => cancel(settle) });
      return done;
    },
  };
}

describe('writeFakeProcess', () => {
  it('writes its lines and stops only when signalled, recording which signal', async () => {
    const p = fake({ name: 'fake-cli', lines: ['{"hello":1}'], onInterrupt: { exitCode: 130 } });
    const lines: string[] = [];
    const run = spawnLines({
      cmd: p.bin, args: [], cwd: p.dir, env: process.env as Record<string, string>,
      stdin: null, timeoutMs: 5000, onLine: (stream, line) => { if (stream === 'stdout') lines.push(line); },
    });
    await waitFor(() => lines.includes('{"hello":1}'), { label: 'the prepared line' });
    expect(existsSync(p.marker)).toBe(false); // nothing stopped it on its own
    await run.cancel('interrupt');
    const outcome = await run.done;
    expect(outcome.exitCode).toBe(130);
    expect(readFileSync(p.marker, 'utf8')).toBe('SIGINT');
  });
});

describe('interruptedTurn', () => {
  it('waits until the turn is under way, interrupts, and returns the result and the recording', async () => {
    const { result, recorded } = await interruptedTurn(stubAdapter((settle) => settle()), input);
    expect(result.exitCode).toBe(143);
    expect(recorded.events.map((e) => e.type)).toEqual(['session.started']);
  });

  it('rejects on its bound when the interrupt never stops the turn, instead of hanging', async () => {
    await expect(interruptedTurn(stubAdapter(() => undefined), input, { timeoutMs: 100 })).rejects.toThrow(/timed out/);
  });
});