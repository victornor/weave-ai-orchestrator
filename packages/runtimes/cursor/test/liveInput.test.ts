import { rmSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import type { RuntimeEvent, TurnHandle, TurnInput } from '@weave-ai/runtime-sdk';
import { adapter } from '../src/adapter.js';
import { writeFakeCursorCli, writeSilentFakeCursorCli } from './fakeCli.js';

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

function input(over: Partial<TurnInput> = {}, fakeDir = writeFakeCursorCli()): TurnInput {
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
    expect(result.error).toBeUndefined();
    expect(handle?.send).toBeUndefined();
  });
});

describe('cursor adapter — verifies the model that actually ran (VS-187)', () => {
  it('fails visibly when cursor-agent silently ran a different model family', async () => {
    const fakeDir = writeFakeCursorCli({ reportedModel: 'Claude 4.5 Opus High Thinking' });
    const result = await adapter.runTurn(
      input({ model: 'grok-4-6' }, fakeDir),
      { onSpawn: () => undefined, onEvent: () => undefined, onRaw: () => undefined },
      () => undefined,
    );
    expect(result.error?.code).toBe('model_mismatch');
    expect(result.timedOut).toBe(false);
  });

  it('does not flag a same-family model report', async () => {
    const fakeDir = writeFakeCursorCli({ reportedModel: 'Claude 4.5 Opus High Thinking' });
    const result = await adapter.runTurn(
      input({ model: 'opus-5' }, fakeDir),
      { onSpawn: () => undefined, onEvent: () => undefined, onRaw: () => undefined },
      () => undefined,
    );
    expect(result.error).toBeUndefined();
  });

  it('never flags a mismatch for model auto, regardless of what is reported', async () => {
    const fakeDir = writeFakeCursorCli({ reportedModel: 'Claude 4.5 Opus High Thinking' });
    const result = await adapter.runTurn(
      input({ model: 'auto' }, fakeDir),
      { onSpawn: () => undefined, onEvent: () => undefined, onRaw: () => undefined },
      () => undefined,
    );
    expect(result.error).toBeUndefined();
  });
});

describe('cursor adapter — surfaces the rejected model catalogue (VS-200)', () => {
  const TICKET_REJECTION = `Cannot use this model: grok-4-6. Available models: auto, gpt-5.3-codex-low,
gpt-5.3-codex-low-fast, gpt-5.3-codex, gpt-5.3-codex-fast, gpt-5.3-codex-high,
gpt-5.3-codex-high-fast, gpt-5.3-codex-xhigh, gpt-5.3-codex-xhigh-fast, gpt-5.2,
cursor-grok-4.6-high-fast, composer-2.5, claude-opus-5-thinking-high,
claude-opus-5-thinking-high-fast, gpt-5.6-sol-high, gpt-5.6-sol-high-fast,
gpt-5.6-sol-xhigh, ...`;

  it('enriches the turn error with the rejected model and the parsed available list', async () => {
    const fakeDir = writeFakeCursorCli({ unknownModelRejection: TICKET_REJECTION });
    const result = await adapter.runTurn(
      input({ model: 'grok-4-6' }, fakeDir),
      { onSpawn: () => undefined, onEvent: () => undefined, onRaw: () => undefined },
      () => undefined,
    );
    expect(result.error?.code).toBe('unknown_model');
    expect(result.error?.message).toContain('grok-4-6');
    expect(result.error?.message).toContain('cursor-grok-4.6-high-fast');
    expect(result.error?.message).not.toContain('...');
  });
});

describe('cursor adapter — fails fast on a silent process (VS-187)', () => {
  it('interrupts and fails within the no-output grace period instead of hanging', async () => {
    const fakeDir = writeSilentFakeCursorCli();
    const result = await adapter.runTurn(
      input({ options: { noOutputGraceMs: 100 } }, fakeDir),
      { onSpawn: () => undefined, onEvent: () => undefined, onRaw: () => undefined },
      () => undefined,
    );
    expect(result.error?.code).toBe('no_output');
    expect(result.timedOut).toBe(false);
  });

  it('a turn that produces output right away never trips the no-output check', async () => {
    const result = await adapter.runTurn(
      input({ model: 'auto', options: { noOutputGraceMs: 100 } }),
      { onSpawn: () => undefined, onEvent: () => undefined, onRaw: () => undefined },
      () => undefined,
    );
    expect(result.exitCode).toBe(0);
    expect(result.error).toBeUndefined();
  });
});
