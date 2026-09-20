import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import type { McpClient, McpTool } from './client.js';
import { foldMcpContent, type McpToolResult } from './result.js';

export interface McpStdioOptions {
  command: string;
  args?: string[];
  /**
   * The base environment the server is spawned with. There is deliberately no ambient inheritance:
   * the server sees only this base plus its own `env`, so the run token and the role's secrets (which
   * ride in the agent child's tool environment) can never reach it.
   */
  baseEnv?: Record<string, string>;
  /** The server's own configured environment, on top of `baseEnv`. */
  env?: Record<string, string>;
  cwd?: string;
  listTimeoutMs?: number;
  callTimeoutMs?: number;
  /** How long `close()` waits after SIGTERM before SIGKILL. */
  killGraceMs?: number;
  clientName?: string;
  onStderr?: (line: string) => void;
  /** Test seam. */
  spawnFn?: typeof spawn;
}

const PROTOCOL_VERSION = '2025-03-26';

interface Pending { resolve: (result: Record<string, unknown>) => void; reject: (err: Error) => void }

/**
 * A stdio MCP client: spawn the server, exchange newline-delimited JSON-RPC over its stdio. The
 * server is our own child, never a detached process, and `close()` reaps it by pid (the shared
 * conventions forbid pattern kills). Its stderr is forwarded as a log line, never parsed.
 */
export class McpStdioClient implements McpClient {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly decoder = new StringDecoder('utf8');
  private buf = '';
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private closed = false;
  private exited = false;

  constructor(private o: McpStdioOptions) {
    const spawnFn = o.spawnFn ?? spawn;
    this.child = spawnFn(o.command, o.args ?? [], {
      cwd: o.cwd ?? process.cwd(),
      env: { ...(o.baseEnv ?? {}), ...o.env },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    }) as ChildProcessWithoutNullStreams;
    this.child.stdout.on('data', (chunk: Buffer) => this.onData(chunk));
    this.child.stderr.on('data', (chunk: Buffer) => {
      if (!this.o.onStderr) return;
      for (const line of String(chunk).split('\n')) if (line.trim()) this.o.onStderr(line.trimEnd());
    });
    this.child.on('error', (e) => this.failAll(e));
    this.child.on('exit', () => { this.exited = true; this.failAll(new Error('MCP stdio server exited')); });
  }

  async initialize(signal: AbortSignal): Promise<void> {
    await this.request('initialize', { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: this.o.clientName ?? 'weave-agent', version: '0.1.0' } }, signal, this.o.listTimeoutMs ?? 30_000);
    this.write({ jsonrpc: '2.0', method: 'notifications/initialized' });
  }

  async listTools(signal: AbortSignal): Promise<McpTool[]> {
    const tools: McpTool[] = [];
    let cursor: string | undefined;
    do {
      const r = await this.request('tools/list', cursor ? { cursor } : {}, signal, this.o.listTimeoutMs ?? 30_000);
      for (const t of (r['tools'] as Array<Record<string, unknown>> | undefined) ?? []) {
        const ann = (t['annotations'] ?? {}) as Record<string, unknown>;
        tools.push({ name: String(t['name']), description: String(t['description'] ?? ''), inputSchema: (t['inputSchema'] as Record<string, unknown>) ?? { type: 'object' }, readOnly: ann['readOnlyHint'] === true });
      }
      cursor = typeof r['nextCursor'] === 'string' ? r['nextCursor'] : undefined;
    } while (cursor);
    return tools;
  }

  async callTool(name: string, args: Record<string, unknown>, signal: AbortSignal): Promise<McpToolResult> {
    const id = this.nextId;
    try {
      const r = await this.request('tools/call', { name, arguments: args }, signal, this.o.callTimeoutMs ?? 60_000);
      return foldMcpContent(r['content'], r['isError'] === true);
    } catch (e) {
      if (signal.aborted) { this.write({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: id, reason: 'cancelled' } }); void this.close(); }
      throw e;
    }
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    if (this.exited) return;
    const grace = this.o.killGraceMs ?? 2000;
    await new Promise<void>((resolve) => {
      const done = (): void => resolve();
      this.child.once('exit', done);
      try { this.child.kill('SIGTERM'); } catch { done(); }
      setTimeout(() => { if (!this.exited) { try { this.child.kill('SIGKILL'); } catch { /* already gone */ } } }, grace).unref();
      // Never hang the turn on a server that traps both signals.
      setTimeout(done, grace + 1000).unref();
    });
    this.failAll(new Error('MCP stdio server closed'));
  }

  private request(method: string, params: Record<string, unknown>, signal: AbortSignal, timeoutMs: number): Promise<Record<string, unknown>> {
    if (this.closed) return Promise.reject(new Error(`MCP ${method}: client closed`));
    const id = this.nextId++;
    return new Promise<Record<string, unknown>>((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`MCP ${method}: timed out after ${timeoutMs}ms`)); }, timeoutMs);
      const onAbort = (): void => { clearTimeout(timer); this.pending.delete(id); reject(signal.reason instanceof Error ? signal.reason : new Error('aborted')); };
      signal.addEventListener('abort', onAbort, { once: true });
      this.pending.set(id, {
        resolve: (r) => { clearTimeout(timer); signal.removeEventListener('abort', onAbort); resolve(r); },
        reject: (e) => { clearTimeout(timer); signal.removeEventListener('abort', onAbort); reject(e); },
      });
      this.write({ jsonrpc: '2.0', id, method, params });
    });
  }

  private write(msg: unknown): void {
    try { this.child.stdin.write(`${JSON.stringify(msg)}\n`); } catch { /* the exit handler rejects anything pending */ }
  }

  private onData(chunk: Buffer): void {
    this.buf += this.decoder.write(chunk);
    let nl: number;
    while ((nl = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, nl).trim();
      this.buf = this.buf.slice(nl + 1);
      if (!line) continue;
      let msg: Record<string, unknown>;
      try { msg = JSON.parse(line) as Record<string, unknown>; } catch { continue; }
      const id = msg['id'];
      if (typeof id !== 'number') continue;
      const p = this.pending.get(id);
      if (!p) continue;
      this.pending.delete(id);
      const err = msg['error'] as { message?: unknown } | undefined;
      if (err) p.reject(new Error(`MCP error: ${String(err.message ?? 'unknown')}`));
      else p.resolve((msg['result'] as Record<string, unknown>) ?? {});
    }
  }

  private failAll(e: Error): void {
    const all = [...this.pending.values()];
    this.pending.clear();
    for (const p of all) p.reject(e);
  }
}
