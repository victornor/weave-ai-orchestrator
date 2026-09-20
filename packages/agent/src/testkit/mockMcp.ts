import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface MockMcp {
  url: string;
  calls: Array<{ name: string; args: Record<string, unknown>; headers: IncomingMessage['headers'] }>;
  close(): Promise<void>;
}

/** A minimal streamable-HTTP MCP server (JSON replies) for loop tests. `handler` may hold a call open to test cancel, or return raw content parts. */
export async function startMockMcp(tools: Array<{ name: string; description?: string }>, handler: (name: string, args: Record<string, unknown>) => Promise<string | Array<Record<string, unknown>>> | string | Array<Record<string, unknown>>): Promise<MockMcp> {
  const calls: MockMcp['calls'] = [];
  const sockets = new Set<import('node:net').Socket>();
  const server: Server = createServer((req, res) => {
    let s = '';
    req.on('data', (c) => (s += c));
    req.on('end', async () => {
      const msg = JSON.parse(s || '{}') as { id?: number; method: string; params?: { name: string; arguments: Record<string, unknown> } };
      const ok = (result: unknown): void => { res.writeHead(200, { 'content-type': 'application/json', 'mcp-session-id': 's1' }); res.end(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result })); };
      if (msg.method === 'initialize') return ok({ protocolVersion: '2025-03-26', capabilities: {}, serverInfo: { name: 'mock', version: '1' } });
      if (msg.method === 'tools/list') return ok({ tools: tools.map((t) => ({ name: t.name, description: t.description ?? t.name, inputSchema: { type: 'object', properties: {} } })) });
      if (msg.method === 'tools/call') {
        calls.push({ name: msg.params!.name, args: msg.params!.arguments, headers: req.headers });
        const out = await handler(msg.params!.name, msg.params!.arguments);
        const content = typeof out === 'string' ? [{ type: 'text', text: out }] : out;
        return ok({ content, isError: false });
      }
      res.writeHead(202); res.end();
    });
  });
  server.on('connection', (sock) => { sockets.add(sock); sock.on('close', () => sockets.delete(sock)); });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`, calls, close: () => new Promise<void>((r) => { for (const sock of sockets) sock.destroy(); server.close(() => r()); }) };
}
