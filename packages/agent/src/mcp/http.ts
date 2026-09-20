import { SseParser } from '../sse.js';

export interface McpTool { name: string; description: string; inputSchema: Record<string, unknown>; readOnly: boolean }
export interface McpHttpOptions { url: string; headers?: Record<string, string>; fetch?: typeof fetch; listTimeoutMs?: number; callTimeoutMs?: number; clientName?: string }
export const MCP_RESULT_MAX_CHARS = 50 * 1024;
const PROTOCOL_VERSION = '2025-03-26';

interface Rpc { jsonrpc: '2.0'; id?: number; result?: Record<string, unknown>; error?: { code: number; message: string }; method?: string }

/** A streamable-HTTP MCP client: JSON or SSE replies, `Mcp-Session-Id`, static headers, no OAuth. */
export class McpHttpClient {
  private nextId = 1;
  private sessionId: string | null = null;
  private readonly f: typeof fetch;
  constructor(private o: McpHttpOptions) { this.f = o.fetch ?? fetch; }

  async initialize(signal: AbortSignal): Promise<void> {
    await this.request('initialize', { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: this.o.clientName ?? 'weave-agent', version: '0.1.0' } }, signal, this.o.listTimeoutMs ?? 30_000);
    await this.post({ jsonrpc: '2.0', method: 'notifications/initialized' }, signal, false);
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

  async callTool(name: string, args: Record<string, unknown>, signal: AbortSignal): Promise<{ text: string; isError: boolean }> {
    const id = this.nextId;
    try {
      const r = await this.request('tools/call', { name, arguments: args }, signal, this.o.callTimeoutMs ?? 60_000);
      const parts = (r['content'] as Array<Record<string, unknown>> | undefined) ?? [];
      let text = parts.map((p) => (p['type'] === 'text' ? String(p['text'] ?? '') : `[${String(p['type'])} content omitted]`)).join('\n');
      if (text.length > MCP_RESULT_MAX_CHARS) text = `${text.slice(0, MCP_RESULT_MAX_CHARS)}\n[truncated at ${MCP_RESULT_MAX_CHARS} characters]`;
      return { text, isError: r['isError'] === true };
    } catch (e) {
      if (signal.aborted) void this.post({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: id, reason: 'cancelled' } } as Rpc, new AbortController().signal, false).catch(() => undefined);
      throw e;
    }
  }

  private async request(method: string, params: Record<string, unknown>, signal: AbortSignal, timeoutMs: number): Promise<Record<string, unknown>> {
    const id = this.nextId++;
    const sig = AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]);
    const res = await this.post({ jsonrpc: '2.0', id, method, params } as Rpc & { params: unknown }, sig, true);
    if (!res) throw new Error(`MCP ${method}: no response`);
    const rpc = await this.readRpc(res, id, sig);
    if (rpc.error) throw new Error(`MCP ${method}: ${rpc.error.message}`);
    return rpc.result ?? {};
  }

  private async post(body: unknown, signal: AbortSignal, expectReply: boolean): Promise<Response | null> {
    const headers: Record<string, string> = { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...this.o.headers };
    if (this.sessionId) headers['mcp-session-id'] = this.sessionId;
    const res = await this.f(this.o.url, { method: 'POST', headers, body: JSON.stringify(body), signal });
    const sid = res.headers.get('mcp-session-id');
    if (sid) this.sessionId = sid;
    if (!res.ok) throw new Error(`MCP HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
    if (!expectReply) { await res.arrayBuffer().catch(() => undefined); return null; }
    return res;
  }

  private async readRpc(res: Response, id: number, signal: AbortSignal): Promise<Rpc> {
    const type = res.headers.get('content-type') ?? '';
    if (!type.includes('text/event-stream')) return (await res.json()) as Rpc;
    const parser = new SseParser();
    const reader = res.body!.getReader();
    const pick = (events: Array<{ data: string }>): Rpc | null => {
      for (const e of events) { try { const m = JSON.parse(e.data) as Rpc; if (m.id === id) return m; } catch { /* keep reading */ } }
      return null;
    };
    for (;;) {
      if (signal.aborted) throw signal.reason ?? new Error('aborted');
      const { done, value } = await reader.read();
      if (value) { const hit = pick(parser.feed(value)); if (hit) { void reader.cancel().catch(() => undefined); return hit; } }
      if (done) { const hit = pick(parser.end()); if (hit) return hit; throw new Error('MCP stream ended without a response'); }
    }
  }
}
