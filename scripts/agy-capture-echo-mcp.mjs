#!/usr/bin/env node
// VS-995: a minimal stdio MCP server for scripts/capture-agy-fixtures.sh. One tool, `echo`, that
// returns its `text` argument. Every request it receives is appended to $CAPTURE_MCP_LOG, so the
// capture records exactly what `agy` sent (method, arguments, `_meta`). Newline-delimited JSON-RPC.
import { appendFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

const logPath = process.env.CAPTURE_MCP_LOG;
const record = (line) => { if (logPath) appendFileSync(logPath, `${line}\n`); };
const send = (msg) => process.stdout.write(`${JSON.stringify(msg)}\n`);

const TOOL = {
  name: 'echo',
  description: 'Returns the given text unchanged.',
  inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
};

createInterface({ input: process.stdin }).on('line', (line) => {
  if (!line.trim()) return;
  record(line);
  let req;
  try { req = JSON.parse(line); } catch { return; }
  const { id, method, params } = req;
  if (id === undefined || id === null) return; // a notification
  switch (method) {
    case 'initialize':
      send({ jsonrpc: '2.0', id, result: { protocolVersion: params?.protocolVersion ?? '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'capture', version: '1.0.0' } } });
      return;
    case 'ping':
      send({ jsonrpc: '2.0', id, result: {} });
      return;
    case 'tools/list':
      send({ jsonrpc: '2.0', id, result: { tools: [TOOL] } });
      return;
    case 'tools/call': {
      const text = String(params?.arguments?.text ?? '');
      send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text }] } });
      return;
    }
    default:
      send({ jsonrpc: '2.0', id, error: { code: -32601, message: `method not found: ${method}` } });
  }
});
