import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { RuntimeEvent } from '@openconductor/runtime-sdk';
import { createGeminiParser } from '../src/events.js';

// SYNTHETIC fixtures: this machine has no Gemini credentials, so no live turn could be
// recorded. The event shapes are transcribed from the shipped gemini 0.58.0 bundle's
// `StreamJsonFormatter` emit sites (init / message / tool_use / tool_result / error / result).
function run(name: string, resumed = false) {
  const path = fileURLToPath(new URL(`../fixtures/${name}.jsonl`, import.meta.url));
  const parser = createGeminiParser({ resumed });
  const events: RuntimeEvent[] = [];
  for (const line of readFileSync(path, 'utf8').split('\n').filter((l) => l.trim())) events.push(...parser.handle(line));
  parser.finish();
  return { events, state: parser.state, types: events.map((e) => e.type) };
}

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
