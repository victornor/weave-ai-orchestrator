import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { RuntimeEvent } from '@weave-ai/runtime-sdk';
import { createClaudeParser } from '../src/events.js';

// Fixtures: recorded live from claude 2.1.258 on 2026-09-03 (`claude -p --output-format
// stream-json --verbose --safe-mode ...`). Thinking blocks and the machine-specific tool /
// command lists in `system:init` were redacted; the event shapes are untouched.
//
// `turn-replayed-input` is the exception: constructed, not recorded — the credential rule (VS-99)
// forbids launching the CLI to record a `--replay-user-messages` turn. Its `user` frames follow the
// wire shape the installed binary's own help text and log strings document (see design.md).
function fixture(name: string): string[] {
  const path = fileURLToPath(new URL(`../fixtures/${name}.jsonl`, import.meta.url));
  return readFileSync(path, 'utf8').split('\n').filter((l) => l.trim().length > 0);
}
function run(name: string, resumed = false) {
  const parser = createClaudeParser({ resumed });
  const events: RuntimeEvent[] = [];
  for (const line of fixture(name)) events.push(...parser.handle(line));
  return { events, state: parser.state, types: events.map((e) => e.type) };
}

describe('claude stream-json parser', () => {
  it('normalizes a simple turn', () => {
    const { types, state, events } = run('turn-simple');
    expect(types[0]).toBe('session.started');
    expect(types).toContain('assistant.text');
    expect(types).toContain('assistant.thinking');
    expect(types.at(-1)).toBe('turn.completed');
    expect(state.sessionId).toBe('b672fc9b-d8eb-4146-97cd-75e33ba166c8');
    expect(state.model).toBe('claude-haiku-4-5-20251001');
    expect(state.finalText).toBe('pong');
    expect(state.usage).toEqual({ inputTokens: 12333, outputTokens: 43, cachedInputTokens: 13615 });
    // One request, so its size and the turn's totals happen to agree: 10 + 12323 + 13615.
    expect(state.contextTokens).toBe(25_948);
    expect(state.costUsd).toBeCloseTo(0.0262325, 6);
    expect(state.isError).toBe(false);
    // unknown CLI events are kept, never dropped
    const raws = events.filter((e) => e.type === 'runtime.raw');
    expect(raws.map((e) => e.payload['originalType'])).toContain('rate_limit_event');
  });

  it('normalizes tool use, tool results and the structured report', () => {
    const { types, state, events } = run('turn-tool-structured');
    expect(types).toContain('tool.call');
    expect(types).toContain('tool.result');
    expect(types).toContain('command.executed');
    expect(types).toContain('usage.delta');

    const call = events.find((e) => e.type === 'tool.call')!;
    expect(call.payload).toMatchObject({ name: 'Bash', input: { command: 'echo pong' } });
    const cmd = events.find((e) => e.type === 'command.executed')!;
    expect(cmd.payload).toMatchObject({ tool: 'Bash', stdout: 'pong', isError: false });

    expect(state.structured).toEqual({ state: 'done', summary: 'said pong' });
    expect(state.finalText).toBe('{"state":"done","summary":"said pong"}');
    expect(state.usage).toEqual({ inputTokens: 17962, outputTokens: 257, cachedInputTokens: 17739 });
  });

  it('measures the context from the last request, while usage stays the turn\u2019s total', () => {
    // This fixture is a two-request turn: the first assistant message reports 10 + 17,739 + 0 and
    // the second 8 + 205 + 17,739. The `result` block sums them, which is what cost is computed
    // from — and what the context meter used to be computed from, reading 35,701 tokens for a
    // conversation that never held more than 17,952 (VS-98).
    const { state } = run('turn-tool-structured');
    expect(state.contextTokens).toBe(17_952);
    const cumulative = state.usage!.inputTokens + state.usage!.cachedInputTokens!;
    expect(cumulative).toBe(35_701);
    expect(state.contextTokens).toBeLessThan(cumulative);
  });

  it('ignores a sub-agent\u2019s requests, which measure a different conversation', () => {
    const p = createClaudeParser();
    const msg = (parent: string | null, cacheRead: number) => JSON.stringify({
      type: 'assistant', session_id: 's1', parent_tool_use_id: parent,
      message: { model: 'm', content: [{ type: 'text', text: 'hi' }], usage: { input_tokens: 5, cache_creation_input_tokens: 0, cache_read_input_tokens: cacheRead } },
    });
    p.handle(msg(null, 80_000));
    expect(p.state.contextTokens).toBe(80_005);
    // A Task tool's own turn: far smaller, and not this session's context.
    p.handle(msg('toolu_sub', 900));
    expect(p.state.contextTokens).toBe(80_005);
  });

  it('reports session.resumed when the turn resumed a session', () => {
    expect(run('turn-simple', true).types[0]).toBe('session.resumed');
  });

  it('keeps unparseable lines as runtime.raw instead of throwing', () => {
    const p = createClaudeParser();
    const evs = p.handle('not json at all');
    expect(evs[0]!.type).toBe('runtime.raw');
    expect(evs[0]!.payload['originalType']).toBe('unparseable');
  });

  it('surfaces an error result', () => {
    const p = createClaudeParser();
    const evs = p.handle(JSON.stringify({ type: 'result', subtype: 'error_during_execution', is_error: true, session_id: 's1', result: 'boom' }));
    expect(evs.map((e) => e.type)).toEqual(['error', 'turn.completed']);
    expect(p.state.isError).toBe(true);
    expect(p.state.errorMessage).toBe('boom');
  });

  it('a replayed user frame (--replay-user-messages echo) produces no spurious event and marks resultSeen', () => {
    const { types, state } = run('turn-replayed-input');
    // Neither the initial-prompt echo nor the mid-turn send() echo appears as an event of any kind.
    expect(types.filter((t) => t === 'runtime.raw' || t === 'tool.result')).toEqual([]);
    expect(types).toEqual(['session.started', 'assistant.text', 'usage.delta', 'turn.completed']);
    expect(state.finalText).toBe('pong');
    expect(state.resultSeen).toBe(true);
  });

  it('emits file.changed for edit tools', () => {
    const p = createClaudeParser();
    const evs = p.handle(JSON.stringify({
      type: 'assistant', session_id: 's1',
      message: { model: 'm', content: [{ type: 'tool_use', id: 't1', name: 'Edit', input: { file_path: '/w/a.ts' } }] },
    }));
    expect(evs.map((e) => e.type)).toEqual(['tool.call', 'file.changed']);
    expect(evs[1]!.payload).toMatchObject({ path: '/w/a.ts', tool: 'Edit' });
  });
});
