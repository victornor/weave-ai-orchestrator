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
      ...(deps.env ? { baseEnv: deps.env } : {}),
      ...(deps.onStderr ? { onStderr: deps.onStderr } : {}),
    });
  }
  if (!cfg.url) throw new Error(`MCP server ${name} is HTTP but names no url`);
  return new McpHttpClient({ url: cfg.url, ...(cfg.headers ? { headers: cfg.headers } : {}), ...(deps.fetch ? { fetch: deps.fetch } : {}) });
}
