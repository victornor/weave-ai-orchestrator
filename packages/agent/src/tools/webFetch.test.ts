import { describe, expect, it } from 'vitest';
import type { Resolver, Transfer } from '../net/ssrf.js';
import { ReadLedger } from './ledger.js';
import { htmlToText, WEB_FETCH_RESULT_MAX_CHARS, makeWebFetchTool } from './webFetch.js';
import type { ToolCtx } from './index.js';

const PUB = '93.184.216.34';
const publicResolve: Resolver = async () => [{ address: PUB, family: 4 }];

const ctx = (): ToolCtx => ({ cwd: '.', home: '.', mode: 'auto', env: {}, signal: new AbortController().signal, callId: 'c1', spillDir: '.', ledger: new ReadLedger(), rg: false, emit: () => undefined });

const toolWith = (transfer: Transfer, resolve: Resolver = publicResolve) => makeWebFetchTool({ transfer, resolve });
const reply = (body: string, contentType: string, status = 200): Transfer => () => Promise.resolve({ status, statusText: 'OK', headers: { 'content-type': contentType }, body: Buffer.from(body) });

describe('web_fetch', () => {
  it('returns a public page as text with a status line', async () => {
    const tool = toolWith(reply('<html><body><h1>Hello &amp; welcome</h1><p>Body text</p></body></html>', 'text/html'));
    const out = await tool.run({ url: 'http://example.test/' }, ctx());
    expect(out.isError).toBeFalsy();
    expect(out.text).toMatch(/^HTTP 200 OK http:\/\/example\.test\//);
    expect(out.text).toContain('Hello & welcome');
    expect(out.text).toContain('Body text');
  });

  it('drops script and style content', () => {
    const text = htmlToText('<style>.x{color:red}</style><script>evil()</script><p>safe</p>');
    expect(text).toBe('safe');
    expect(text).not.toContain('evil');
  });

  it('refuses a binary content type', async () => {
    const tool = toolWith(reply('PNGDATA', 'image/png'));
    const out = await tool.run({ url: 'http://example.test/a.png' }, ctx());
    expect(out.isError).toBe(true);
    expect(out.text).toContain('binary content type');
  });

  it('caps an over-long body with a marker', async () => {
    const tool = toolWith(reply('x'.repeat(WEB_FETCH_RESULT_MAX_CHARS + 5000), 'text/plain'));
    const out = await tool.run({ url: 'http://example.test/big' }, ctx());
    expect(out.text.length).toBeLessThan(WEB_FETCH_RESULT_MAX_CHARS + 100);
    expect(out.text).toContain(`[truncated at ${WEB_FETCH_RESULT_MAX_CHARS} characters]`);
  });

  it('marks a body cut at the read cap', async () => {
    const tool = toolWith((req) => Promise.resolve({ status: 200, statusText: 'OK', headers: { 'content-type': 'text/plain' }, body: Buffer.from('x'.repeat(req.maxBytes)), truncated: true }));
    const out = await tool.run({ url: 'http://example.test/big', max_bytes: 1024 }, ctx());
    expect(out.isError).toBeFalsy();
    expect(out.text).toContain('[output truncated at 1024 bytes]');
  });

  it('refuses a private target with the range named', async () => {
    const tool = toolWith(reply('nope', 'text/plain'), async () => [{ address: '10.0.0.1', family: 4 }]);
    const out = await tool.run({ url: 'http://internal.test/' }, ctx());
    expect(out.isError).toBe(true);
    expect(out.text).toContain('web_fetch refused private address');
  });

  it('refuses an invalid url', async () => {
    const tool = toolWith(reply('', 'text/plain'));
    expect((await tool.run({ url: 'not a url' }, ctx())).isError).toBe(true);
    expect((await tool.run({}, ctx())).isError).toBe(true);
  });
});
