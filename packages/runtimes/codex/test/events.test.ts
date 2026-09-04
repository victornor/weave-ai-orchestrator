import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { RuntimeEvent } from '@openconductor/runtime-sdk';
import { createCodexParser } from '../src/events.js';

// `turn-auth-error.jsonl` was recorded live from codex 0.150.1 (this machine has no
// credentials for the configured provider, so the turn fails after `turn.started`).
// `synthetic-turn-tool-message.jsonl` is hand-written from the event tags and item field
// names extracted from that same binary, because a successful turn cannot be recorded here.
function run(name: string, resumed = false) {
  const path = fileURLToPath(new URL(`../fixtures/${name}.jsonl`, import.meta.url));
  const parser = createCodexParser({ resumed });
  const events: RuntimeEvent[] = [];
  for (const line of readFileSync(path, 'utf8').split('\n').filter((l) => l.trim())) events.push(...parser.handle(line));
  return { events, state: parser.state, types: events.map((e) => e.type) };
}

describe('codex exec --json parser', () => {
  it('normalizes a full turn (synthetic fixture)', () => {
    const { types, state, events } = run('synthetic-turn-tool-message');
    expect(types[0]).toBe('session.started');
    expect(types).toContain('turn.started');
    expect(types).toContain('assistant.thinking');
    expect(types).toContain('command.executed');
    expect(types).toContain('file.changed');
    expect(types).toContain('tool.call');
    expect(types).toContain('tool.result');
    expect(types).toContain('assistant.text');
    expect(types).toContain('usage.delta');
    expect(types.at(-1)).toBe('turn.completed');

    expect(state.threadId).toBe('01a069b4-d08e-7600-9dac-8a5d20259196');
    expect(state.finalText).toBe('{"state":"done","summary":"said pong"}');
    expect(state.usage).toEqual({ inputTokens: 1200, outputTokens: 48, cachedInputTokens: 900 });
    expect(events.find((e) => e.type === 'command.executed')!.payload).toMatchObject({ command: 'echo pong', exitCode: 0, output: 'pong\n' });
    expect(events.find((e) => e.type === 'file.changed')!.payload).toMatchObject({ path: '/home/agent/work/notes.md' });
    // item.started is kept as runtime.raw, never dropped
    expect(events.filter((e) => e.type === 'runtime.raw').map((e) => e.payload['originalType'])).toContain('item.started');
  });

  it('normalizes a failed turn (recorded live)', () => {
    const { types, state } = run('turn-auth-error');
    expect(types).toEqual(['session.started', 'turn.started', 'error', 'error', 'turn.completed']);
    expect(state.threadId).toBe('01a069b4-d08e-7600-9dac-8a5d20259196');
    expect(state.isError).toBe(true);
    expect(state.errorMessage).toContain('Missing environment variable');
  });

  it('reports session.resumed when resuming', () => {
    expect(run('synthetic-turn-tool-message', true).types[0]).toBe('session.resumed');
  });
});
