import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { McpHttpClient } from './http.js';

let server: Server | undefined;
afterEach(() => new Promise<void>((r) => (server ? server.close(() => r()) : r())));

const body = (req: IncomingMessage): Promise<Record<string, unknown>> => new Promise((res) => { let s = ''; req.on('data', (c) => (s += c)); req.on('end', () => res(JSON.parse(s || '{}'))); });

async function start(sse: boolean): Promise<{ url: string; seen: Array<{ headers: IncomingMessage['headers']; msg: Record<string, unknown> }> }> {
  const seen: Array<{ headers: IncomingMessage['headers']; msg: Record<string, unknown> }> = [];
  server = createServer(async (req, res) => {
    const msg = await body(req);
    seen.push({ headers: req.headers, msg });
    const reply = (result: unknown): void => {
      const rpc = JSON.stringify({ jsonrpc: '2.0', id: msg['id'], result });
      if (sse) { res.writeHead(200, { 'content-type': 'text/event-stream', 'mcp-session-id': 'sess-1' }); res.end(`: keepalive\n\nevent: message\ndata: ${rpc}\n\n`); }
      else { res.writeHead(200, { 'content-type': 'application/json', 'mcp-session-id': 'sess-1' }); res.end(rpc); }
    };
    if (msg['method'] === 'initialize') return reply({ protocolVersion: '2025-03-26', capabilities: {}, serverInfo: { name: 'fake', version: '1' } });
    if (msg['method'] === 'tools/list') return reply({ tools: [{ name: 'weave_ticket_get', description: 'get', inputSchema: { type: 'object' }, annotations: { readOnlyHint: true } }] });
    if (msg['method'] === 'tools/call') return reply({ content: [{ type: 'text', text: 'ticket VS-1' }], isError: false });
    res.writeHead(202); res.end();
  });
  await new Promise<void>((r) => server!.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`, seen };
}

for (const sse of [false, true]) {
  describe(`McpHttpClient (${sse ? 'SSE' : 'JSON'} replies)`, () => {
    it('initializes, lists tools and calls one with the bearer header and session id', async () => {
      const { url, seen } = await start(sse);
      const c = new McpHttpClient({ url, headers: { Authorization: 'Bearer run-token' } });
      const ac = new AbortController();
      await c.initialize(ac.signal);
      expect(await c.listTools(ac.signal)).toEqual([{ name: 'weave_ticket_get', description: 'get', inputSchema: { type: 'object' }, readOnly: true }]);
      expect(await c.callTool('weave_ticket_get', { id: 'VS-1' }, ac.signal)).toEqual({ text: 'ticket VS-1', isError: false });
      const call = seen.find((s) => s.msg['method'] === 'tools/call')!;
      expect(call.headers['authorization']).toBe('Bearer run-token');
      expect(call.headers['mcp-session-id']).toBe('sess-1');
      expect(call.msg['params']).toEqual({ name: 'weave_ticket_get', arguments: { id: 'VS-1' } });
      expect(seen.some((s) => s.msg['method'] === 'notifications/initialized')).toBe(true);
    });
  });
}
