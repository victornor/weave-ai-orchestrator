import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { McpStdioClient } from './stdio.js';

/** A newline-delimited JSON-RPC MCP server. `TRAP_SIGTERM` makes it ignore SIGTERM; `HOLD` makes a call hang. */
const SERVER = `
import { createInterface } from 'node:readline';
import { writeFileSync } from 'node:fs';
if (process.env.PIDFILE) writeFileSync(process.env.PIDFILE, String(process.pid));
if (process.env.TRAP_SIGTERM === '1') process.on('SIGTERM', () => {});
const send = (o) => process.stdout.write(JSON.stringify(o) + '\\n');
process.stderr.write('server up\\n');
const rl = createInterface({ input: process.stdin });
rl.on('line', (line) => {
  const msg = JSON.parse(line);
  if (msg.method === 'initialize') return send({ jsonrpc: '2.0', id: msg.id, result: { protocolVersion: '2025-03-26', capabilities: {}, serverInfo: { name: 'fake', version: '1' } } });
  if (msg.method === 'tools/list') return send({ jsonrpc: '2.0', id: msg.id, result: { tools: [{ name: 'echo', description: 'echo back', inputSchema: { type: 'object' }, annotations: { readOnlyHint: true } }] } });
  if (msg.method === 'tools/call') {
    if (process.env.HOLD === '1') return;
    return send({ jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: 'echo:' + msg.params.arguments.text }], isError: false } });
  }
});
`;

let dir: string;
let script: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'wa-mcp-stdio-')); script = join(dir, 'server.mjs'); writeFileSync(script, SERVER); });
afterEach(() => { /* the temp dir is in the OS temp location; every child is reaped by close() */ });

const alive = (pid: number): boolean => { try { process.kill(pid, 0); return true; } catch { return false; } };
const readPid = (file: string): number | null => (existsSync(file) && readFileSync(file, 'utf8').trim() ? Number(readFileSync(file, 'utf8')) : null);
const until = async (cond: () => boolean): Promise<void> => { for (let i = 0; i < 300 && !cond(); i++) await new Promise((r) => setTimeout(r, 10)); };

describe('McpStdioClient', () => {
  it('lists and calls a tool over a stdio server, forwarding stderr as a log line', async () => {
    const stderr: string[] = [];
    const c = new McpStdioClient({ command: process.execPath, args: [script], onStderr: (l) => stderr.push(l) });
    const ac = new AbortController();
    await c.initialize(ac.signal);
    const tools = await c.listTools(ac.signal);
    expect(tools).toEqual([{ name: 'echo', description: 'echo back', inputSchema: { type: 'object' }, readOnly: true }]);
    expect(await c.callTool('echo', { text: 'hi' }, ac.signal)).toEqual({ text: 'echo:hi', isError: false });
    await until(() => stderr.length > 0);
    expect(stderr).toContain('server up');
    await c.close();
  });

  it('reaps a server that ignores SIGTERM', async () => {
    const pidfile = join(dir, 'pid');
    const c = new McpStdioClient({ command: process.execPath, args: [script], env: { TRAP_SIGTERM: '1', PIDFILE: pidfile }, killGraceMs: 50 });
    await c.initialize(new AbortController().signal);
    await until(() => readPid(pidfile) !== null);
    const pid = readPid(pidfile)!;
    expect(alive(pid)).toBe(true);
    await c.close();
    await until(() => !alive(pid));
    expect(alive(pid)).toBe(false);
  });

  it('kills the child when the turn aborts mid-call', async () => {
    const pidfile = join(dir, 'pid');
    const c = new McpStdioClient({ command: process.execPath, args: [script], env: { HOLD: '1', PIDFILE: pidfile } });
    await c.initialize(new AbortController().signal);
    await until(() => readPid(pidfile) !== null);
    const pid = readPid(pidfile)!;
    const ac = new AbortController();
    const call = c.callTool('echo', { text: 'hi' }, ac.signal);
    ac.abort(new Error('cancelled'));
    await expect(call).rejects.toThrow();
    await until(() => !alive(pid));
    expect(alive(pid)).toBe(false);
  });
});
