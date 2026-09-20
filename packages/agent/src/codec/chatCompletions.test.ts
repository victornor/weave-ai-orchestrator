import { describe, expect, it } from 'vitest';
import { assemble, fixtureNames, readFixture } from '../fixtures.js';
import { buildRequest, classifyHttp, StreamReducer } from './chatCompletions.js';
import type { Message } from '../types.js';

describe('byte-split property', () => {
  for (const name of fixtureNames()) {
    it(`${name}: every split point assembles the same message`, () => {
      const bytes = new Uint8Array(readFixture(name));
      const whole = assemble([bytes]);
      for (let i = 0; i <= bytes.length; i++) expect(assemble([bytes.slice(0, i), bytes.slice(i)])).toEqual(whole);
    });
  }
});

const run = (name: string) => assemble([new Uint8Array(readFixture(name))]);

describe('stream quirks', () => {
  it('assembles one call when the id repeats on every chunk, and reads reasoning_content and usage on the finish chunk', () => {
    const r = run('gateway-deepseek-tool.sse');
    expect(r.calls).toEqual([{ id: 'call_00_JAdkP4IsD8rE3vN0DbZE2474', name: 'get_time', argsText: '{"city":"Paris"}' }]);
    expect(r.thinking).toBe('Theuser wantsthe time.');
    expect(r.finishReason).toBe('tool_calls');
    expect(r.usage).toMatchObject({ promptTokens: 36, completionTokens: 47, cachedTokens: 0, reasoningTokens: 33 });
    expect(r.model).toBe('deepseek-v4.1-flash');
  });
  it('assembles a call whose id is sent once, with usage on a separate empty-choices chunk', () => {
    const r = run('gateway-gpt-tool.sse');
    expect(r.calls).toEqual([{ id: 'call_0apGXhMPlFpIxx9CftUCctGl', name: 'get_time', argsText: '{"city":"Paris"}' }]);
    expect(r.usage).toMatchObject({ promptTokens: 12, completionTokens: 16 });
  });
  it('takes whole arguments in one delta and records the model the provider reports', () => {
    const r = run('zai-tool-whole-args.sse');
    expect(r.calls[0]).toMatchObject({ name: 'get_time', argsText: '{"city":"Paris"}' });
    expect(r.model).toBe('glm-5.3-flash');
    expect(r.usage).toMatchObject({ promptTokens: 12, completionTokens: 30 });
  });
  it('reads reasoning once when both reasoning and reasoning_details are sent, and survives finish_reason on two chunks', () => {
    const r = run('openrouter-tool-two-finish.sse');
    expect(r.thinking).toBe('Let see');
    expect(r.calls).toHaveLength(1);
    expect(r.calls[0]!.argsText).toBe('{"city":"Paris"}');
    expect(r.usage?.promptTokens).toBe(14);
  });
  it('decodes multi-byte text', () => {
    const r = run('mock-text.sse');
    expect(r.text).toBe('Héllo wörld — 日本語');
    expect(r.calls).toEqual([]);
  });
  it('opens a new call for a different id at the same index, and stringifies object arguments', () => {
    const r = run('mock-parallel-quirks.sse');
    expect(r.calls.map((c) => [c.id, c.name, c.argsText])).toEqual([['call_a', 'read', '{"path":"a"}'], ['call_b', 'read', '{"path":"b"}'], ['call_c', 'bash', '{"command":"true"}']]);
  });
  it('decides tools ran from the assembled calls, not from finish_reason', () => {
    const r = run('mock-parallel-quirks.sse');
    expect(r.finishReason).toBe('stop');
    expect(r.calls).toHaveLength(3);
  });
  it('surfaces an error object inside a 200 stream, keeping the text before it', () => {
    const r = run('mock-error-in-stream.sse');
    expect(r.error).toMatchObject({ message: 'upstream exploded', code: '500', type: 'server_error' });
    expect(r.text).toBe('par');
  });
  it('turns empty arguments into {} and generates an id when the provider sends none', () => {
    const red = new StreamReducer({}, 'call_r1');
    red.push({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { name: 'read', arguments: '' } }] } }] });
    expect(red.result().calls).toEqual([{ id: 'call_r1_1', name: 'read', argsText: '{}' }]);
  });
  it('reports partials for text, reasoning and tool input', () => {
    const got: string[] = [];
    const red = new StreamReducer({ onText: (d) => got.push(`t:${d}`), onThinking: (d) => got.push(`k:${d}`), onToolInput: (id, d) => got.push(`i:${id}:${d}`) });
    red.push({ choices: [{ delta: { reasoning: 'r', content: 'c', tool_calls: [{ index: 0, id: 'x', function: { name: 'n', arguments: 'a' } }] } }] });
    expect(got).toEqual(['t:c', 'k:r', 'i:x:a']);
  });
});

describe('request body', () => {
  const messages: Message[] = [
    { role: 'user', text: 'hi' },
    { role: 'assistant', content: [{ type: 'text', text: '' }, { type: 'toolCall', id: 'c1', name: 'read', args: { path: 'a' } }] },
    { role: 'toolResult', toolCallId: 'c1', name: 'read', text: 'ok', isError: false },
  ];
  it('omits every parameter nobody set', () => {
    const body = buildRequest({ model: 'm', system: 's', messages, tools: [], options: {} });
    for (const k of ['temperature', 'top_p', 'max_tokens', 'max_completion_tokens', 'tools', 'frequency_penalty', 'presence_penalty', 'seed', 'stop']) expect(body).not.toHaveProperty(k);
    expect(body['stream']).toBe(true);
  });
  it('sends the set parameters, with the cap as max_tokens', () => {
    const body = buildRequest({ model: 'm', system: '', messages: [], tools: [{ name: 't', description: 'd', parameters: { type: 'object' } }], options: { temperature: 0.2, topP: 0.9, maxOutputTokens: 100 } });
    expect(body).toMatchObject({ temperature: 0.2, top_p: 0.9, max_tokens: 100 });
    expect(body).not.toHaveProperty('max_completion_tokens');
    expect((body['tools'] as unknown[])[0]).toEqual({ type: 'function', function: { name: 't', description: 'd', parameters: { type: 'object' } } });
  });
  it('encodes an assistant tool call with null content and a tool result as role tool', () => {
    const wire = buildRequest({ model: 'm', system: 's', messages, tools: [], options: {} })['messages'] as Array<Record<string, unknown>>;
    expect(wire[0]).toEqual({ role: 'system', content: 's' });
    expect(wire[2]).toEqual({ role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'read', arguments: '{"path":"a"}' } }] });
    expect(wire[3]).toEqual({ role: 'tool', tool_call_id: 'c1', content: 'ok' });
  });
});

describe('classifyHttp', () => {
  it('classifies 402 as quota, not a bad request', () => {
    expect(classifyHttp(402, '{"error":{"message":"Insufficient Balance","type":"unknown_error","code":"invalid_request_error"}}')).toMatchObject({ family: 'provider_quota', code: 'quota_exhausted', message: 'Insufficient Balance' });
  });
  it('maps the common statuses', () => {
    expect(classifyHttp(401, '{}').family).toBe('auth');
    expect(classifyHttp(429, '{}', 1500)).toMatchObject({ family: 'transient_upstream', retryAfterMs: 1500 });
    expect(classifyHttp(503, 'down').family).toBe('transient_upstream');
    expect(classifyHttp(400, '{"error":{"message":"maximum context length exceeded"}}').code).toBe('context_overflow');
    expect(classifyHttp(404, '{}').code).toBe('model_not_found');
  });
});
