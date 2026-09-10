import { rmSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import type { RuntimeEvent, TurnHandle, TurnInput } from '@agent-conductor/runtime-sdk';
import { adapter } from '../src/adapter.js';
import { writeFakeCursorCli } from './fakeCli.js';

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

function input(over: Partial<TurnInput> = {}): TurnInput {
  const fakeDir = writeFakeCursorCli();
  dirs.push(fakeDir);
  return {
    runId: `run-${Math.random().toString(36).slice(2)}`, turnEpoch: 1, cwd: '/tmp', worktree: null,
    session: { policy: 'fresh', ref: null, isFirstTurn: true },
    systemPrompt: { text: '', mode: 'skip' },
    prompt: 'do the thing', mcpServers: {}, env: { PATH: `${fakeDir}${process.platform === 'win32' ? ';' : ':'}${process.env['PATH'] ?? ''}` },
    options: {}, limits: { timeoutMs: 10_000 }, permission: { mode: 'auto' },
    ...over,
  };
}

describe('cursor adapter — argv print mode against a fake CLI', () => {
  it('spawns only the fake and completes a turn with model auto', async () => {
    const events: RuntimeEvent[] = [];
    let handle: TurnHandle | undefined;
    const result = await adapter.runTurn(
      input({ model: 'auto' }),
      { onSpawn: () => undefined, onEvent: (e) => events.push(e), onRaw: () => undefined },
      (h) => { handle = h; },
    );
    expect(result.exitCode).toBe(0);
    expect(result.finalText).toBe('ack');
    expect(handle?.send).toBeUndefined();
    expect(events.map((e) => e.type)).toEqual(['session.started', 'assistant.text', 'turn.completed']);
  });

  it('completes a turn with a named catalog model and has no send', async () => {
    let handle: TurnHandle | undefined;
    const result = await adapter.runTurn(
      input({ model: 'opus-5' }),
      { onSpawn: () => undefined, onEvent: () => undefined, onRaw: () => undefined },
      (h) => { handle = h; },
    );
    expect(result.exitCode).toBe(0);
    expect(handle?.send).toBeUndefined();
  });
});
