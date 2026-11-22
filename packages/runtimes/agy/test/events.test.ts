import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { RuntimeEvent } from '@weave-ai/runtime-sdk';
import { createAgyParser } from '../src/index.js';

/** Owner capture of agy 1.5.14, 2026-11-22 (fixtures/README.md). */
const lines = (n: string) => readFileSync(new URL(`../fixtures/${n}`, import.meta.url), 'utf8').split('\n').filter(Boolean);
const CONV = 'bf1094f5-0123-4994-926b-c0bba7374957';

function parse(file: string, resumed = false) {
  const p = createAgyParser({ resumed });
  const events: RuntimeEvent[] = lines(file).flatMap((l) => p.handle(l));
  return { state: p.state, events };
}

describe('agy stream-json parser (VS-995, captured bytes)', () => {
  it('turn 1: session, the MCP tool call, the text, the schema-enforced report', () => {
    const { state, events } = parse('turn1-tool-schema.jsonl');
    const started = events.find((e) => e.type === 'session.started')!;
    expect(started.payload).toMatchObject({ sessionId: CONV, model: 'gemini-4-neon-low' });
    expect((started.payload['tools'] as string[])).toContain('call_mcp_tool');

    const calls = events.filter((e) => e.type === 'tool.call').map((e) => e.payload);
    expect(calls).toEqual([
      { id: 'step-2', name: 'read_file', input: { Path: '/tmp/agy-capture.ky83ML/gemini/antigravity-cli/mcp/capture/echo.json' } },
      { id: 'step-4', name: 'mcp__capture__echo', input: { text: 'weave-capture-7' } },
    ]);
    const results = events.filter((e) => e.type === 'tool.result').map((e) => e.payload);
    expect(results[1]).toEqual({ id: 'step-4', name: 'mcp__capture__echo', isError: false, content: 'weave-capture-7' });

    expect(events.filter((e) => e.type === 'assistant.text').map((e) => e.payload['text'])).toEqual(['{"word":"weave-capture-7"}\n']);
    expect(state.conversationId).toBe(CONV);
    expect(state.structured).toEqual({ word: 'weave-capture-7' });
    expect(state.finalText).toBe('{"word":"weave-capture-7"}\n');
    expect(state.isError).toBe(false);
  });

  it('turn 1 usage is the sum of its steps; input counts cache reads, which can exceed fresh input', () => {
    const { state } = parse('turn1-tool-schema.jsonl');
    expect(state.usage).toEqual({
      inputTokens: (9137 + 2376 + 2344) + (0 + 7080 + 7407),
      cachedInputTokens: 0 + 7080 + 7407,
      outputTokens: 187 + 82 + 110,
      thinkingTokens: 142 + 41 + 89,
      contextTokens: 2344 + 7407,
      firstRequest: { freshTokens: 9137, cachedTokens: 0 },
    });
  });

  it('turn 2 (resumed): per-turn usage from its own steps, not the conversation-wide result totals', () => {
    const { state, events } = parse('turn2-resumed.jsonl', true);
    expect(events.find((e) => e.type === 'session.resumed')?.payload['sessionId']).toBe(CONV);
    expect(state.usage).toMatchObject({ inputTokens: 2468 + 7702, cachedInputTokens: 7702, outputTokens: 74, thinkingTokens: 53, contextTokens: 2468 + 7702 });
    // agy's own result usage is cumulative: turn 1's 13857 fresh input plus turn 2's 2468.
    expect(state.conversationUsage).toMatchObject({ input_tokens: 16325 });
    expect(state.structured).toEqual({ word: 'weave-capture-7' });
  });

  it('the no-login result is an auth failure', () => {
    const { state } = parse('no-login-result.jsonl');
    expect(state).toMatchObject({ isError: true, authFailed: true, usage: null });
  });
});
