import { describe, expect, it, vi } from 'vitest';
import { estimateTokens, messagesTokens, RequestSizer, TOKEN_MARGIN, toolsTokens } from './tokens.js';
import type { Message } from './types.js';

// Counts the characters that reach the encoder, so the sampling test can assert on the work done.
const encoded = vi.hoisted(() => ({ chars: 0 }));
vi.mock('js-tiktoken', async (importOriginal) => {
  const actual = await importOriginal<typeof import('js-tiktoken')>();
  return {
    ...actual,
    getEncoding: (name: Parameters<typeof actual.getEncoding>[0]) => {
      const enc = actual.getEncoding(name);
      return new Proxy(enc, {
        get(target, prop) {
          if (prop === 'encode') return (text: string, ...rest: []) => { encoded.chars += text.length; return target.encode(text, ...rest); };
          const v = Reflect.get(target, prop);
          return typeof v === 'function' ? v.bind(target) : v;
        },
      });
    },
  };
});

const tool = (i: number) => ({ name: `weave_tool_${i}`, description: `Does thing ${i} in the workspace with a long enough description to cost tokens`, parameters: { type: 'object', properties: { id: { type: 'string', description: 'the id' }, note: { type: 'string' } }, required: ['id'] } });

describe('token accounting', () => {
  it('samples a long text instead of encoding it whole, so a run of one character is never encoded in full', () => {
    // Asserts the work, not the clock (VS-945): BPE is quadratic on a run of one character, so what
    // matters is that only the head and tail samples reach the encoder, however fast the runner is.
    encoded.chars = 0;
    const n = messagesTokens([{ role: 'toolResult', toolCallId: 'a', name: 'bash', text: '-'.repeat(200_000), isError: false }]);
    expect(encoded.chars).toBe(2 * 2_000);
    expect(n).toBeGreaterThan(1000);
  });
  it('counts the tool schemas: about 40 weaver tools cost thousands of tokens', () => {
    const tools = Array.from({ length: 40 }, (_, i) => tool(i));
    expect(Math.abs(toolsTokens(tools) - estimateTokens(JSON.stringify(tools)))).toBeLessThan(estimateTokens(JSON.stringify(tools)) * 0.1);
    expect(toolsTokens(tools)).toBeGreaterThan(2000);
    expect(toolsTokens([])).toBe(0);
  });
  it('estimates from parts with the margin before any response', () => {
    const tools = Array.from({ length: 40 }, (_, i) => tool(i));
    const messages: Message[] = [{ role: 'user', text: 'hello there' }];
    const sizer = new RequestSizer();
    const est = sizer.estimate({ system: 'sys', tools, messages });
    expect(est).toBe(Math.ceil((estimateTokens('sys') + toolsTokens(tools) + messagesTokens(messages)) * TOKEN_MARGIN));
    expect(est).toBeGreaterThan(toolsTokens(tools));
  });
  it('prefers the provider count once a request has been made, adding only later messages', () => {
    const sizer = new RequestSizer();
    const a: Message = { role: 'user', text: 'one' };
    const b: Message = { role: 'user', text: 'two two two' };
    sizer.observe(5000, 1);
    expect(sizer.estimate({ system: 'word '.repeat(20000), tools: [], messages: [a] })).toBe(5000);
    expect(sizer.estimate({ system: '', tools: [], messages: [a, b] })).toBe(Math.ceil(5000 + messagesTokens([b]) * TOKEN_MARGIN));
    sizer.reset();
    expect(sizer.estimate({ system: 'word '.repeat(20000), tools: [], messages: [a] })).toBeGreaterThan(5000);
  });
});
