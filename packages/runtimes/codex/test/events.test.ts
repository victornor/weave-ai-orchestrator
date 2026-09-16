import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { RuntimeEvent } from '@weave-ai/runtime-sdk';
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


describe('documented Codex item format', () => {
  it('reads type-tagged messages and retains text before completion', () => {
    const parser = createCodexParser();
    expect(parser.handle(JSON.stringify({ type: 'item.completed', item: { id: 'm1', type: 'agent_message', text: 'hello' } }))[0]?.type).toBe('assistant.text');
    expect(parser.state.finalText).toBe('hello');
  });

  it('clears a retry error after a successful turn', () => {
    const parser = createCodexParser();
    parser.handle(JSON.stringify({ type: 'error', message: 'Reconnecting... 1/5' }));
    parser.handle(JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 3, output_tokens: 1 } }));
    expect(parser.state.isError).toBe(false);
    expect(parser.state.errorMessage).toBeNull();
  });

  it('preserves failed MCP tool details', () => {
    const parser = createCodexParser();
    const events = parser.handle(JSON.stringify({ type: 'item.completed', item: { type: 'mcp_tool_call', status: 'failed', error: { message: 'tool failed' } } }));
    expect(events[1]?.payload).toMatchObject({ isError: true, content: '{"message":"tool failed"}' });
  });
});


it('emits MCP calls while they run and does not duplicate them on completion', () => {
  const parser = createCodexParser();
  const item = { id: 'call-1', type: 'mcp_tool_call', server: 'ac', tool: 'ac_report', arguments: {} };
  const started = parser.handle(JSON.stringify({ type: 'item.started', item }));
  expect(started.map((event) => event.type)).toEqual(['runtime.raw', 'tool.call']);
  expect(parser.handle(JSON.stringify({ type: 'item.updated', item })).map((event) => event.type)).toEqual(['runtime.raw']);
  expect(parser.handle(JSON.stringify({ type: 'item.completed', item: { ...item, status: 'completed', result: { ok: true } } })).map((event) => event.type)).toEqual(['tool.result']);
});

describe('codex command events (VS-328)', () => {
  it('carries the parsed test tally on command.executed before truncating', () => {
    const p = createCodexParser();
    const evs = p.handle(JSON.stringify({
      type: 'item.completed',
      item: { item_type: 'command_execution', id: 'i1', command: 'pnpm test', exit_code: 0, status: 'completed', aggregated_output: ' Test Files  2 passed (2)\n      Tests  28 passed (28)\n   Duration  1.20s' },
    }));
    const cmd = evs.find((e) => e.type === 'command.executed')!;
    expect(cmd.payload['tests']).toEqual({ passed: 28, total: 28 });
  });
});

describe('session cumulative usage', () => {
  it('subtracts the previous turn instead of charging the whole session again', () => {
    const parser = createCodexParser({ resumed: true, baseline: { inputTokens: 448626, outputTokens: 2114, cachedInputTokens: 403072 } });
    const events = parser.handle(JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 1661849, output_tokens: 5630, cached_input_tokens: 1555456 } }));
    expect(parser.state.usage).toEqual({ inputTokens: 1213223, outputTokens: 3516, cachedInputTokens: 1152384 });
    expect(events.find(e => e.type === 'usage.delta')?.payload).toMatchObject({ inputTokens: 1213223, basis: 'per_turn' });
    expect(parser.state.cumulativeUsage?.inputTokens).toBe(1661849);
  });

  it('does not charge historical usage when a legacy baseline is unavailable', () => {
    const parser = createCodexParser({ resumed: true, baseline: null });
    const events = parser.handle(JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 1931235, output_tokens: 5988 } }));
    expect(parser.state.usage).toBeNull();
    expect(parser.state.cumulativeUsage?.inputTokens).toBe(1931235);
    expect(events.some(e => e.type === 'usage.delta')).toBe(false);
  });

  it('uses a fresh counter when Codex resets cumulative usage', () => {
    const parser = createCodexParser({ resumed: true, baseline: { inputTokens: 1000, outputTokens: 100, cachedInputTokens: 800 } });
    parser.handle(JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 20, output_tokens: 2, cached_input_tokens: 10 } }));
    expect(parser.state.usage).toEqual({ inputTokens: 20, outputTokens: 2, cachedInputTokens: 10 });
  });
});
