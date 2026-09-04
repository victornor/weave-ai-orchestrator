import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { RuntimeEvent } from '@agent-conductor/runtime-sdk';
import { createClaudeParser } from '../src/events.js';

// Fixtures: recorded live from claude 2.1.258 on 2026-09-03 (`claude -p --output-format
// stream-json --verbose --safe-mode ...`). Thinking blocks and the machine-specific tool /
// command lists in `system:init` were redacted; the event shapes are untouched.
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
