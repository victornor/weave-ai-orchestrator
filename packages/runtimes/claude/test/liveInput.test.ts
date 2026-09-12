import { rmSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import type { RuntimeEvent, TurnHandle, TurnInput } from '@weave-ai/runtime-sdk';
import { RUN_REPORT_JSON_SCHEMA } from '@weave-ai/shared';
import { adapter } from '../src/adapter.js';
import { writeFakeClaudeCli } from './fakeCli.js';

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

function input(over: Partial<TurnInput> = {}, fakeOpts: Parameters<typeof writeFakeClaudeCli>[0] = {}): TurnInput {
  const fakeDir = writeFakeClaudeCli(fakeOpts);
  dirs.push(fakeDir);
  return {
    runId: `run-${Math.random().toString(36).slice(2)}`, turnEpoch: 1, cwd: '/tmp', worktree: null,
    session: { policy: 'fresh', ref: null, isFirstTurn: true },
    systemPrompt: { text: '', mode: 'skip' },
    prompt: 'do the thing', outputSchema: RUN_REPORT_JSON_SCHEMA as unknown as Record<string, unknown>,
    mcpServers: {}, env: { PATH: `${fakeDir}${process.platform === 'win32' ? ';' : ':'}${process.env['PATH'] ?? ''}` },
    options: {}, limits: { timeoutMs: 10_000 }, permission: { mode: 'auto' },
    ...over,
  };
}

describe('claude adapter — live stdin against a fake CLI', () => {
  it('spawns only the fake and completes a turn end to end', async () => {
    const events: RuntimeEvent[] = [];
    const result = await adapter.runTurn(input(), { onSpawn: () => undefined, onEvent: (e) => events.push(e), onRaw: () => undefined });
    expect(result.exitCode).toBe(0);
    expect(result.finalText).toBe('ack');
    expect(events.map((e) => e.type)).toEqual(['session.started', 'assistant.text', 'usage.delta', 'turn.completed']);
  });

  it('delivers a frame written mid-turn through the TurnHandle', async () => {
    let handle: TurnHandle | undefined;
    // The fake CLI waits before answering the first frame, opening a real window in which the
    // turn is still running and stdin is still open — the mid-turn case this change exists for.
    const resultPromise = adapter.runTurn(
      input({}, { respondDelayMs: 300 }),
      { onSpawn: () => undefined, onEvent: () => undefined, onRaw: () => undefined },
      (h) => { handle = h; },
    );
    await new Promise((r) => setTimeout(r, 60));
    expect(handle?.send).toBeTypeOf('function');
    const delivery = await handle!.send!('one more thing, mid-turn');
    expect(delivery).toBe('delivered');
    const result = await resultPromise;
    expect(result.exitCode).toBe(0);
  });

  it('closes stdin (and the process exits) once the result line arrives, and a late send reports closed', async () => {
    let handle: TurnHandle | undefined;
    const result = await adapter.runTurn(
      input(),
      { onSpawn: () => undefined, onEvent: () => undefined, onRaw: () => undefined },
      (h) => { handle = h; },
    );
    expect(result.exitCode).toBe(0);
    const late = await handle!.send!('too late');
    expect(late).toBe('closed');
  });

  it('omits send() entirely when liveInput is turned off', async () => {
    let handle: TurnHandle | undefined;
    await adapter.runTurn(
      input({ options: { liveInput: false } }),
      { onSpawn: () => undefined, onEvent: () => undefined, onRaw: () => undefined },
      (h) => { handle = h; },
    );
    expect(handle?.send).toBeUndefined();
  });
});
