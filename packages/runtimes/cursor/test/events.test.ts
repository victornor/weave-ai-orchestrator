import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { RuntimeEvent, RuntimePartial } from '@weave-ai/runtime-sdk';
import { createCursorParser } from '../src/events.js';

// SYNTHETIC fixtures transcribed from Cursor CLI docs (2026-09-09 output-format page) and, for
// stream-partial-output.jsonl, from the installed cursor-agent 2026.09.10 bundle's stream-json
// writer. Not a live recording — launching cursor-agent against host credentials is forbidden.
const lines = (name: string): string[] =>
  readFileSync(fileURLToPath(new URL(`../fixtures/${name}.jsonl`, import.meta.url)), 'utf8')
    .split('\n').filter((l) => l.trim() && !l.startsWith('#'));

function run(name: string, resumed = false) {
  const parser = createCursorParser({ resumed });
  const events: RuntimeEvent[] = [];
  for (const line of lines(name)) events.push(...parser.handle(line));
  parser.finish();
  return { events, state: parser.state, types: events.map((e) => e.type) };
}

/** VS-600: parse with `--stream-partial-output` on, collecting the partial deltas. */
function runStream(name: string, resumed = false) {
  const partials: RuntimePartial[] = [];
  const parser = createCursorParser({ resumed, streamPartial: true, onPartial: (p) => partials.push(p) });
  const events: RuntimeEvent[] = [];
  for (const line of lines(name)) events.push(...parser.handle(line));
  parser.finish();
  return { events, state: parser.state, partials, types: events.map((e) => e.type) };
}

const textsOf = (events: RuntimeEvent[]): string[] =>
  events.filter((e) => e.type === 'assistant.text').map((e) => String(e.payload['text']));

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

describe('cursor streamed partial output (VS-600)', () => {
  it('reports each delta through onPartial and persists one assistant.text per message', () => {
    const { partials, events } = runStream('stream-partial-output');
    // Two messages of two deltas each.
    expect(partials.map((p) => p.text)).toEqual(['Let me ', 'read the README.', 'Done', '.']);
    expect(partials.every((p) => p.kind === 'text')).toBe(true);
    // The two deltas of one message share one partId; the next message gets a new one.
    expect(new Set(partials.slice(0, 2).map((p) => p.partId)).size).toBe(1);
    expect(partials[0]!.partId).not.toBe(partials[2]!.partId);

    // No delta is persisted; the CLI's flush is the one assistant.text per message.
    const texts = textsOf(events);
    expect(texts).toEqual(['Let me read the README.', 'Done.']);
  });

  it('carries the delta partId on the completed event, so it supersedes the partial', () => {
    const { partials, events } = runStream('stream-partial-output');
    const done = events.filter((e) => e.type === 'assistant.text').map((e) => String(e.payload['partId']));
    expect(done).toEqual([partials[0]!.partId, partials[2]!.partId]);
    // The persisted text is the whole message, never an individual delta.
    for (const t of textsOf(events)) expect(partials.map((p) => p.text)).not.toContain(t);
  });

  it('keeps the deltas produced so far when the stream is cut off before the flush', () => {
    const partials: RuntimePartial[] = [];
    const p = createCursorParser({ streamPartial: true, onPartial: (x) => partials.push(x) });
    p.handle('{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"cut "}]},"session_id":"s","timestamp_ms":1}');
    p.handle('{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"off"}]},"session_id":"s","timestamp_ms":2}');
    p.finish();
    expect(partials.map((x) => x.text)).toEqual(['cut ', 'off']);
    expect(p.state.finalText).toBe('cut off');
  });

  it('reports session.resumed on the streamed fixture when resuming', () => {
    expect(runStream('stream-partial-output', true).types[0]).toBe('session.resumed');
  });
});
