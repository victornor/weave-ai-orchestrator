import { McpHttpClient } from './http.js';
import { McpStdioClient } from './stdio.js';
import type { McpImagePart, McpToolResult } from './result.js';

export type { McpImagePart, McpToolResult };

export interface McpTool { name: string; description: string; inputSchema: Record<string, unknown>; readOnly: boolean }

/** One MCP server connection. The HTTP and stdio transports implement the same surface, so the loop does not branch on transport. */
export interface McpClient {
  initialize(signal: AbortSignal): Promise<void>;
  listTools(signal: AbortSignal): Promise<McpTool[]>;
  callTool(name: string, args: Record<string, unknown>, signal: AbortSignal): Promise<McpToolResult>;
  /** Release the transport. HTTP is a no-op; stdio reaps its child. Always safe to call more than once. */
  close(): Promise<void>;
}

/** The child's view of one configured server (a narrowing of the runtime-sdk `McpServerConfig`). */
export interface McpClientConfig {
  type?: 'http' | 'stdio';
  url?: string;
  headers?: Record<string, string>;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  /** VS-621: bounds on `initialize`/`tools/list` and on `tools/call`; the transports' defaults apply when unset. */
  listTimeoutMs?: number;
  callTimeoutMs?: number;
  /** VS-621: the human's declaration that the server only reads; `restricted` keeps its tools only when true. */
  readOnly?: boolean;
}

export interface McpClientDeps {
  fetch?: typeof fetch;
  /** Stdio server stderr, as a child log line. */
  onStderr?: (line: string) => void;
  /** The base environment for a stdio server. The caller passes the plain tool base, never the ambient env. */
  env?: Record<string, string>;
}

/** Pick the transport for a config: stdio when it names a command, HTTP otherwise (the S1 shape carries only a `url`). */
export function createMcpClient(name: string, cfg: McpClientConfig, deps: McpClientDeps = {}): McpClient {
  if (cfg.type === 'stdio' || (!cfg.url && cfg.command)) {
    if (!cfg.command) throw new Error(`MCP server ${name} is stdio but names no command`);
    return new McpStdioClient({
      command: cfg.command,
      ...(cfg.args ? { args: cfg.args } : {}),
      ...(cfg.env ? { env: cfg.env } : {}),
      ...(cfg.listTimeoutMs !== undefined ? { listTimeoutMs: cfg.listTimeoutMs } : {}),
      ...(cfg.callTimeoutMs !== undefined ? { callTimeoutMs: cfg.callTimeoutMs } : {}),
      ...(deps.env ? { baseEnv: deps.env } : {}),
      ...(deps.onStderr ? { onStderr: deps.onStderr } : {}),
    });
  }
  if (!cfg.url) throw new Error(`MCP server ${name} is HTTP but names no url`);
  return new McpHttpClient({
    url: cfg.url,
    ...(cfg.headers ? { headers: cfg.headers } : {}),
    ...(cfg.listTimeoutMs !== undefined ? { listTimeoutMs: cfg.listTimeoutMs } : {}),
    ...(cfg.callTimeoutMs !== undefined ? { callTimeoutMs: cfg.callTimeoutMs } : {}),
    ...(deps.fetch ? { fetch: deps.fetch } : {}),
  });
}

/** What the Settings Test action reports: the server's tools, or why it could not be reached. */
export interface McpTestResult { ok: boolean; tools: Array<{ name: string; description: string }>; error?: string }

/**
 * VS-621: connect to a server once and list its tools, never throwing. The server's own `env` is
 * added over the passed base environment; the caller decides that base (the route passes the daemon's
 * PATH/HOME and nothing secret).
 */
export async function testMcpServer(o: { config: McpClientConfig; env?: Record<string, string>; timeoutMs?: number }): Promise<McpTestResult> {
  const timeoutMs = o.timeoutMs ?? 15_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`timed out after ${timeoutMs}ms`)), timeoutMs);
  const client = createMcpClient('test', { ...o.config, listTimeoutMs: timeoutMs, callTimeoutMs: timeoutMs }, { ...(o.env ? { env: o.env } : {}) });
  try {
    await client.initialize(controller.signal);
    const tools = await client.listTools(controller.signal);
    return { ok: true, tools: tools.map((t) => ({ name: t.name, description: t.description })) };
  } catch (e) {
    return { ok: false, tools: [], error: e instanceof Error ? e.message : String(e) };
  } finally {
    clearTimeout(timer);
    await client.close().catch(() => undefined);
  }
}
