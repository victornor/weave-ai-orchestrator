import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { RuntimeEvent, RuntimePartial } from '@weave-ai/runtime-sdk';
import { createGeminiParser } from '../src/events.js';

// SYNTHETIC fixtures: this machine has no Gemini credentials, so no live turn could be
// recorded. The event shapes are transcribed from the shipped gemini bundle's stream-json emit
// sites (init / message / tool_use / tool_result / error / result); streaming-deltas.jsonl from
// 0.60.0, where every assistant chunk is a `message` with `delta: true`.
const lines = (name: string): string[] =>
  readFileSync(fileURLToPath(new URL(`../fixtures/${name}.jsonl`, import.meta.url)), 'utf8')
    .split('\n').filter((l) => l.trim() && !l.startsWith('#'));

function run(name: string, resumed = false) {
  const parser = createGeminiParser({ resumed });
  const events: RuntimeEvent[] = [];
  for (const line of lines(name)) events.push(...parser.handle(line));
  parser.finish();
  return { events, state: parser.state, types: events.map((e) => e.type) };
}

/** VS-600: parse with partial reporting on, collecting the deltas. */
function runStream(name: string, resumed = false) {
  const partials: RuntimePartial[] = [];
  const parser = createGeminiParser({ resumed, onPartial: (p) => partials.push(p) });
  const events: RuntimeEvent[] = [];
  for (const line of lines(name)) events.push(...parser.handle(line));
  parser.finish();
  return { events, state: parser.state, partials, types: events.map((e) => e.type) };
}

const textsOf = (events: RuntimeEvent[]): string[] =>
  events.filter((e) => e.type === 'assistant.text').map((e) => String(e.payload['text']));

describe('gemini stream-json parser', () => {
  it('normalizes a tool-using turn and reassembles the streamed text', () => {
    const { types, state, events } = run('synthetic-turn-tool-report');
    expect(types[0]).toBe('session.started');
    expect(types).toContain('tool.call');
    expect(types).toContain('tool.result');
    expect(types).toContain('command.executed');
    expect(types).toContain('assistant.text');
    expect(types).toContain('usage.delta');
    expect(types.at(-1)).toBe('turn.completed');
    expect(state.sessionId).toBe('6f1c2b7e-6a2b-4a1e-9b0f-2c1d3e4f5a6b');
    expect(state.model).toBe('gemini-3-pro-preview');
    expect(state.finalText).toBe('```json\n{"state":"done","summary":"said pong"}\n```');
    expect(state.usage).toEqual({ inputTokens: 1300, outputTokens: 120, cachedInputTokens: 900 });
    expect(state.isError).toBe(false);
    // the user echo is preserved as runtime.raw, not mistaken for assistant output
    expect(events.filter((e) => e.type === 'runtime.raw').map((e) => e.payload['originalType'])).toContain('message.user');
  });

  it('separates warnings from a failing result', () => {
    const { types, state } = run('synthetic-turn-error');
    expect(types).toEqual(['session.started', 'error', 'usage.delta', 'error', 'turn.completed']);
    expect(state.isError).toBe(true);
    expect(state.errorMessage).toContain('Error executing tool write_file');
  });

  it('reports session.resumed when resuming', () => {
    expect(run('synthetic-turn-tool-report', true).types[0]).toBe('session.resumed');
  });
});

describe('gemini command events (VS-328)', () => {
  it('carries the parsed test tally on command.executed before truncating', () => {
    const p = createGeminiParser();
    p.handle(JSON.stringify({ type: 'tool_use', tool_id: 't1', tool_name: 'run_shell_command', parameters: { command: 'pnpm test' } }));
    const evs = p.handle(JSON.stringify({ type: 'tool_result', tool_id: 't1', status: 'success', output: ' Test Files  2 passed (2)\n      Tests  28 passed (28)\n   Duration  1.20s' }));
    const cmd = evs.find((e) => e.type === 'command.executed')!;
    expect(cmd.payload['tests']).toEqual({ passed: 28, total: 28 });

    p.handle(JSON.stringify({ type: 'tool_use', tool_id: 't2', tool_name: 'run_shell_command', parameters: { command: 'echo pong' } }));
    const plain = p.handle(JSON.stringify({ type: 'tool_result', tool_id: 't2', status: 'success', output: 'pong' })).find((e) => e.type === 'command.executed')!;
    expect(plain.payload['tests']).toBeUndefined();
  });
});

describe('gemini streamed partial output (VS-600)', () => {
  const FINAL = '```json\n{"state":"done","summary":"said pong"}\n```';

  it('reports each delta through onPartial and coalesces a message into one assistant.text', () => {
    const { partials, events } = runStream('streaming-deltas');
    expect(partials.map((p) => p.text)).toEqual(['Let me ', 'check.', '```json\n{"state":"done",', '"summary":"said pong"}\n```']);
    expect(partials.every((p) => p.kind === 'text')).toBe(true);
    // The two deltas of one message share a partId; the second message gets a new one.
    expect(new Set(partials.slice(0, 2).map((p) => p.partId)).size).toBe(1);
    expect(partials[0]!.partId).not.toBe(partials[2]!.partId);
    // One persisted block per message, never one per chunk.
    expect(textsOf(events)).toEqual(['Let me check.', FINAL]);
  });

  it('flushes the message on the next non-text event and at turn end, carrying the delta partId', () => {
    const { partials, events } = runStream('streaming-deltas');
    const order = events.map((e) => e.type);
    const firstText = order.indexOf('assistant.text');
    expect(order.indexOf('tool.call')).toBeGreaterThan(firstText);
    expect(order.indexOf('tool.result')).toBeGreaterThan(order.indexOf('tool.call'));
    expect(order.indexOf('assistant.text', firstText + 1)).toBeGreaterThan(order.indexOf('tool.result'));
    const done = events.filter((e) => e.type === 'assistant.text').map((e) => String(e.payload['partId']));
    expect(done).toEqual([partials[0]!.partId, partials[2]!.partId]);
    expect(events.at(-1)!.type).toBe('turn.completed');
  });

  it('leaves finalText as the concatenated chunks', () => {
    expect(runStream('streaming-deltas').state.finalText).toBe(`Let me check.${FINAL}`);
  });

  it('keeps the text produced so far when the stream is cut off before result', () => {
    const partials: RuntimePartial[] = [];
    const p = createGeminiParser({ onPartial: (x) => partials.push(x) });
    p.handle(JSON.stringify({ type: 'message', role: 'assistant', content: 'half ', delta: true }));
    p.handle(JSON.stringify({ type: 'message', role: 'assistant', content: 'done', delta: true }));
    p.finish();
    expect(partials.map((x) => x.text)).toEqual(['half ', 'done']);
    // The unflushed message is a partial: discarded, not persisted, but its text survives in finalText.
    expect(p.state.finalText).toBe('half done');
  });
});
