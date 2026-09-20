import { describe, expect, it } from 'vitest';
import { buildRequest } from './chatCompletions.js';
import { applyParams, completeCompat, parseExtraHeaders, ThinkTagSplitter, toWireMessages, wireIdMap, type Compat } from './params.js';
import { assemble, readFixture } from '../fixtures.js';
import type { Message } from '../types.js';

const compat = (c: Parameters<typeof completeCompat>[0] = {}): Compat => completeCompat(c);
const build = (over: { compat?: Parameters<typeof completeCompat>[0]; options?: Record<string, unknown>; effort?: string; messages?: Message[]; tools?: boolean; system?: string } = {}) => {
  const warnings: string[] = [];
  const body = buildRequest({ model: 'm', system: over.system ?? '', messages: over.messages ?? [{ role: 'user', text: 'hi' }], tools: over.tools === false ? [] : [{ name: 't', description: 'd', parameters: { type: 'object' } }], options: over.options ?? {}, compat: compat(over.compat), ...(over.effort ? { effort: over.effort } : {}), warnings });
  return { body, warnings };
};

describe('parameters', () => {
  it('sends every named parameter under its wire name when set', () => {
    const { body } = build({ options: { temperature: 0.3, topP: 0.8, frequencyPenalty: 0.5, presencePenalty: -0.5, maxOutputTokens: 256, seed: 7, stop: ['END'], toolChoice: 'required', parallelToolCalls: false, responseFormat: 'json_object' } });
    expect(body).toMatchObject({ temperature: 0.3, top_p: 0.8, frequency_penalty: 0.5, presence_penalty: -0.5, max_tokens: 256, seed: 7, stop: ['END'], tool_choice: 'required', parallel_tool_calls: false, response_format: { type: 'json_object' } });
  });
  it('sends none of them when nothing is set', () => {
    const { body } = build();
    for (const k of ['temperature', 'top_p', 'frequency_penalty', 'presence_penalty', 'max_tokens', 'max_completion_tokens', 'seed', 'stop', 'tool_choice', 'parallel_tool_calls', 'response_format', 'reasoning_effort', 'reasoning']) expect(body).not.toHaveProperty(k);
  });
  it('maxTokensParam max_tokens sends max_tokens and never max_completion_tokens; the other spelling is the reverse', () => {
    const a = build({ compat: { maxTokensParam: 'max_tokens' }, options: { maxOutputTokens: 50 } }).body;
    expect(a['max_tokens']).toBe(50); expect(a).not.toHaveProperty('max_completion_tokens');
    const b = build({ compat: { maxTokensParam: 'max_completion_tokens' }, options: { maxOutputTokens: 50 } }).body;
    expect(b['max_completion_tokens']).toBe(50); expect(b).not.toHaveProperty('max_tokens');
  });
  it('omitParams never appear, in either spelling and even through extraBody', () => {
    const { body } = build({ compat: { omitParams: ['temperature', 'topP', 'foo'] }, options: { temperature: 1, topP: 0.5, extraBody: '{"foo":1,"bar":2,"top_p":0.1}' } });
    expect(body).not.toHaveProperty('temperature'); expect(body).not.toHaveProperty('top_p'); expect(body).not.toHaveProperty('foo');
    expect(body['bar']).toBe(2);
  });
  it('omitParams can strip a structural key such as stream_options', () => {
    expect(build({ compat: { omitParams: ['stream_options'] } }).body).not.toHaveProperty('stream_options');
  });
  it('streamUsage decides whether stream_options is sent', () => {
    expect(build().body['stream_options']).toEqual({ include_usage: true });
    expect(build({ compat: { streamUsage: 'always' } }).body).not.toHaveProperty('stream_options');
    expect(build({ compat: { streamUsage: 'never' } }).body).not.toHaveProperty('stream_options');
  });
  it('systemRole names the role of the instructions', () => {
    expect((build({ system: 'be brief', compat: { systemRole: 'developer' } }).body['messages'] as Array<Record<string, unknown>>)[0]).toEqual({ role: 'developer', content: 'be brief' });
    expect((build({ system: 'be brief' }).body['messages'] as Array<Record<string, unknown>>)[0]).toEqual({ role: 'system', content: 'be brief' });
  });
  it('maps effort per effortParam and effortMap, and sends nothing when the param is none or effort is unset', () => {
    expect(build({ effort: 'high', compat: { reasoning: { effortParam: 'reasoning_effort' } } }).body['reasoning_effort']).toBe('high');
    expect(build({ effort: 'max', compat: { reasoning: { effortParam: 'reasoning.effort', effortMap: { max: 'high' } } } }).body['reasoning']).toEqual({ effort: 'high' });
    expect(build({ effort: 'high' }).body).not.toHaveProperty('reasoning_effort');
    expect(build({ compat: { reasoning: { effortParam: 'reasoning_effort' } } }).body).not.toHaveProperty('reasoning_effort');
  });
  it('tools flags: strict, parallel, choice; unsupported tools sends no tools and no tool parameters', () => {
    const tools = (build({ compat: { tools: { strict: true } } }).body['tools'] as Array<{ function: Record<string, unknown> }>)[0]!;
    expect(tools.function['strict']).toBe(true);
    const noParallel = build({ compat: { tools: { parallel: false } }, options: { parallelToolCalls: true } });
    expect(noParallel.body).not.toHaveProperty('parallel_tool_calls'); expect(noParallel.warnings.join()).toMatch(/compat\.tools\.parallel/);
    const noChoice = build({ compat: { tools: { choice: ['auto'] } }, options: { toolChoice: 'required' } });
    expect(noChoice.body).not.toHaveProperty('tool_choice'); expect(noChoice.warnings.join()).toMatch(/toolChoice/);
    const off = build({ compat: { tools: { supported: false } }, options: { toolChoice: 'auto', parallelToolCalls: true } }).body;
    for (const k of ['tools', 'tool_choice', 'parallel_tool_calls']) expect(off).not.toHaveProperty(k);
  });
  it('responseFormat is sent only when the endpoint lists it', () => {
    const r = build({ compat: { responseFormat: [] }, options: { responseFormat: 'json_object' } });
    expect(r.body).not.toHaveProperty('response_format'); expect(r.warnings).toHaveLength(1);
  });
  it('seedParam renames the seed and stopMax truncates the stop list with a warning', () => {
    const r = build({ compat: { seedParam: 'random_seed', stopMax: 2 }, options: { seed: 3, stop: ['a', 'b', 'c'] } });
    expect(r.body).toMatchObject({ random_seed: 3, stop: ['a', 'b'] }); expect(r.body).not.toHaveProperty('seed'); expect(r.warnings.join()).toMatch(/stopMax/);
  });
  it('an invalid extraBody is ignored with a warning, never sent half-parsed', () => {
    const r = build({ options: { extraBody: '{nope' } });
    expect(r.warnings.join()).toMatch(/not valid JSON/); expect(r.body).not.toHaveProperty('nope');
    expect(build({ options: { extraBody: '[1]' } }).warnings.join()).toMatch(/not a JSON object/);
  });
  it('parses extraHeaders lines and reports a line with no colon', () => {
    expect(parseExtraHeaders(['X-A: 1', 'X-B:two:2', 'bad'])).toEqual({ headers: { 'X-A': '1', 'X-B': 'two:2' }, errors: ['extraHeaders entry "bad" is not "Name: value"'] });
  });
  it('applyParams alone is a pure body writer', () => {
    const body: Record<string, unknown> = {};
    expect(applyParams(body, { temperature: 0 }, compat(), null, false).warnings).toEqual([]);
    expect(body).toEqual({ temperature: 0 });
  });
});

describe('message shape flags', () => {
  const history: Message[] = [
    { role: 'user', text: 'first' },
    { role: 'assistant', content: [{ type: 'thinking', text: 'old thoughts' }, { type: 'toolCall', id: 'old_1', name: 'read', args: {}, raw: '{}' }] },
    { role: 'toolResult', toolCallId: 'old_1', name: 'read', text: 'r1', isError: false },
    { role: 'assistant', content: [{ type: 'text', text: 'done' }] },
    { role: 'user', text: 'second' },
    { role: 'assistant', content: [{ type: 'thinking', text: 'new thoughts' }, { type: 'toolCall', id: 'new_1', name: 'read', args: {}, raw: '{}' }] },
    { role: 'toolResult', toolCallId: 'new_1', name: 'read', text: 'r2', isError: false },
  ];
  const assistants = (c: Compat): Array<Record<string, unknown>> => toWireMessages(history, c).filter((m) => m['role'] === 'assistant');

  it('passBack reasoning_content echoes thinking on the current turn\'s tool steps only', () => {
    const a = assistants(compat({ reasoning: { passBack: 'reasoning_content' } }));
    expect(a.map((m) => m['reasoning_content'])).toEqual([undefined, undefined, 'new thoughts']);
  });
  it('passBack all echoes every assistant message that thought; none echoes nothing', () => {
    expect(assistants(compat({ reasoning: { passBack: 'all' } })).map((m) => m['reasoning_content'])).toEqual(['old thoughts', undefined, 'new thoughts']);
    expect(assistants(compat()).some((m) => 'reasoning_content' in m)).toBe(false);
  });
  it('emptyContent picks null or an empty string for an assistant message with only tool calls', () => {
    expect(assistants(compat())[0]!['content']).toBeNull();
    expect(assistants(compat({ emptyContent: 'empty' }))[0]!['content']).toBe('');
  });
  it('strictAlternation puts an empty assistant turn between a tool result and a user message', () => {
    const roles = (c: Compat): string[] => toWireMessages([{ role: 'assistant', content: [{ type: 'toolCall', id: 'a', name: 'n', args: {} }] }, { role: 'toolResult', toolCallId: 'a', name: 'n', text: 'x', isError: false }, { role: 'user', text: 'u' }], c).map((m) => m['role'] as string);
    expect(roles(compat())).toEqual(['assistant', 'tool', 'user']);
    expect(roles(compat({ strictAlternation: true }))).toEqual(['assistant', 'tool', 'assistant', 'user']);
  });
  it('idFormat alnum9 maps calls and their results to the same nine alphanumeric characters; safe64 keeps a safe subset', () => {
    const msgs: Message[] = [
      { role: 'assistant', content: [{ type: 'toolCall', id: 'call_00_JAdkP4IsD8rE3vN0DbZE2474', name: 'a', args: {} }, { type: 'toolCall', id: 'x.y/z', name: 'b', args: {} }] },
      { role: 'toolResult', toolCallId: 'call_00_JAdkP4IsD8rE3vN0DbZE2474', name: 'a', text: '', isError: false },
    ];
    const wire = toWireMessages(msgs, compat({ tools: { idFormat: 'alnum9' } }));
    const callId = (wire[0]!['tool_calls'] as Array<{ id: string }>)[0]!.id;
    expect(callId).toMatch(/^[a-z0-9]{9}$/);
    expect(wire[1]!['tool_call_id']).toBe(callId);
    expect(wireIdMap(msgs, 'safe64').get('x.y/z')).toBe('x_y_z');
    expect(wireIdMap(msgs, 'any').size).toBe(0);
  });
});

describe('think tags', () => {
  it('splits <think> out of content across chunk boundaries', () => {
    const s = new ThinkTagSplitter();
    const parts = ['Hi <thi', 'nk>plan', ' more</th', 'ink> answer <', 'b>'];
    const out = { text: '', thinking: '' };
    for (const p of parts) { const r = s.push(p); out.text += r.text; out.thinking += r.thinking; }
    const f = s.flush(); out.text += f.text; out.thinking += f.thinking;
    expect(out).toEqual({ text: 'Hi  answer <b>', thinking: 'plan more' });
  });
});

describe('recorded captures agree with the flags the presets name', () => {
  it('Z.ai ignores max_completion_tokens and honours max_tokens (real probe 5.1)', () => {
    const f = JSON.parse(readFixture('real-zai-max-tokens.json').toString('utf8')) as Record<string, { usage: { completion_tokens: number }; choices: Array<{ finish_reason: string }> }>;
    expect(f['max_completion_tokens_16']!.usage.completion_tokens).toBeGreaterThan(16);
    expect(f['max_completion_tokens_16']!.choices[0]!.finish_reason).toBe('stop');
    expect(f['max_tokens_16']!.usage.completion_tokens).toBe(16);
    expect(f['max_tokens_16']!.choices[0]!.finish_reason).toBe('length');
  });
  it('a named reasoning field reads only that field (real OpenRouter capture carries reasoning and reasoning_details)', () => {
    const bytes = new Uint8Array(readFixture('real-openrouter-tool.sse'));
    const reason = (field: 'reasoning' | 'reasoning_content' | 'none') => assembleWith(bytes, field).thinking;
    expect(reason('reasoning').startsWith('The user wants')).toBe(true);
    expect(reason('reasoning_content')).toBe('');
    expect(reason('none')).toBe('');
  });
});

import { SseParser } from '../sse.js';
import { StreamReducer } from './chatCompletions.js';
function assembleWith(bytes: Uint8Array, field: 'reasoning' | 'reasoning_content' | 'none') {
  const parser = new SseParser(); const red = new StreamReducer({}, 'c', { reasoningField: field });
  for (const e of [...parser.feed(bytes), ...parser.end()]) if (e.data !== '[DONE]') red.push(JSON.parse(e.data));
  return red.result();
}
void assemble;
