import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { RuntimeEvent } from '@weave-ai/runtime-sdk';
import { createCursorParser } from '../src/events.js';

// SYNTHETIC fixtures transcribed from Cursor CLI docs (2026-09-09 output-format page).
// Not a live recording — launching cursor-agent against host credentials is forbidden.
function run(name: string, resumed = false) {
  const path = fileURLToPath(new URL(`../fixtures/${name}.jsonl`, import.meta.url));
  const parser = createCursorParser({ resumed });
  const events: RuntimeEvent[] = [];
  for (const line of readFileSync(path, 'utf8').split('\n').filter((l) => l.trim())) events.push(...parser.handle(line));
  parser.finish();
  return { events, state: parser.state, types: events.map((e) => e.type) };
}

describe('cursor-agent stream-json parser', () => {
  it('normalizes a simple turn', () => {
    const { types, state } = run('synthetic-turn-simple');
    expect(types[0]).toBe('session.started');
    expect(types).toContain('assistant.text');
    expect(types.at(-1)).toBe('turn.completed');
    expect(state.sessionId).toBe('c6b62c6f-7ead-4fd6-9922-e952131177ff');
    expect(state.finalText).toBe('pong');
    expect(state.resultSeen).toBe(true);
    expect(state.isError).toBe(false);
  });

  it('normalizes tool use and write', () => {
    const { types, state, events } = run('synthetic-turn-tool-report');
    expect(types).toContain('tool.call');
    expect(types).toContain('tool.result');
    expect(types).toContain('file.changed');
    expect(types.at(-1)).toBe('turn.completed');
    expect(state.resultSeen).toBe(true);
    const write = events.find((e) => e.type === 'file.changed');
    expect(write?.payload['path']).toBe('summary.txt');
  });

  it('reports session.resumed when resuming', () => {
    expect(run('synthetic-turn-simple', true).types[0]).toBe('session.resumed');
  });
});

describe('cursor command events (VS-328)', () => {
  it('carries the parsed test tally on command.executed before truncating', () => {
    const p = createCursorParser();
    const evs = p.handle(JSON.stringify({
      type: 'tool_call', subtype: 'completed', call_id: 'c1',
      tool_call: { bashToolCall: { name: 'bash', args: { command: 'pnpm test' }, result: { success: { content: ' Test Files  2 passed (2)\n      Tests  28 passed (28)\n   Duration  1.20s' } } } },
    }));
    const cmd = evs.find((e) => e.type === 'command.executed')!;
    expect(cmd.payload['tests']).toEqual({ passed: 28, total: 28 });

    const plain = p.handle(JSON.stringify({
      type: 'tool_call', subtype: 'completed', call_id: 'c2',
      tool_call: { bashToolCall: { name: 'bash', args: { command: 'echo pong' }, result: { success: { content: 'pong' } } } },
    })).find((e) => e.type === 'command.executed')!;
    expect(plain.payload['tests']).toBeUndefined();
  });
});
