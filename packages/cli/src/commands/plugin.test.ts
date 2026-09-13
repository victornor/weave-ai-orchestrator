/** `weave plugin purge-data <pluginId>` against a stub daemon (VS-334). */
import { createServer, type Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildProgram } from '../program.js';
import { configureOutput } from '../output.js';

interface Call { method: string; path: string }

let server: Server | null = null;
let url = '';
let calls: Call[] = [];

beforeEach(async () => {
  calls = [];
  server = createServer((req, res) => {
    const path = (req.url ?? '').split('?')[0]!;
    calls.push({ method: req.method ?? '', path });
    if (req.method === 'DELETE' && path === '/api/w/ws1/plugin-data/notes') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ pluginId: 'notes', removed: 3 }));
      return;
    }
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: { code: 'not_found', message: `no stub for ${req.method} ${path}`, retryable: false } }));
  });
  await new Promise<void>((r) => server!.listen(0, '127.0.0.1', () => r()));
  const addr = server.address();
  url = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
});

afterEach(async () => {
  await new Promise<void>((r) => server?.close(() => r()));
  server = null;
  process.exitCode = undefined;
});

async function cli(...argv: string[]): Promise<string> {
  let out = '';
  const spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => { out += String(chunk); return true; });
  try {
    await buildProgram().parseAsync(['node', 'weave', '--url', url, '--no-color', '-w', 'ws1', ...argv], { from: 'node' });
  } finally {
    spy.mockRestore();
    configureOutput({ json: false });
  }
  return out;
}

describe('weave plugin purge-data', () => {
  it('calls DELETE /api/w/:ws/plugin-data/:pluginId and reports the removed count', async () => {
    const out = await cli('plugin', 'purge-data', 'notes');
    expect(calls).toEqual([{ method: 'DELETE', path: '/api/w/ws1/plugin-data/notes' }]);
    expect(out).toContain('notes');
    expect(out).toContain('3');
    expect(process.exitCode).toBeUndefined();
  });
});
