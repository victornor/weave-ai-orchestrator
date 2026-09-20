import type { ToolSpec } from '../codec/chatCompletions.js';

export interface ToolCtx {
  /** The worktree, where a relative path resolves and a shell starts. */
  cwd: string;
  /** The shell's environment. Never carries the provider key or the run token. */
  env: Record<string, string>;
  signal: AbortSignal;
  callId: string;
  /** Where a truncated output's full text goes: outside the worktree. */
  spillDir: string;
}
export interface ToolOutput { text: string; isError?: boolean; meta?: { command?: string; exitCode?: number | null } }
export interface ToolDefinition extends ToolSpec {
  /** Core tools and MCP tools share this shape. */
  readOnly?: boolean;
  run(args: Record<string, unknown>, ctx: ToolCtx): Promise<ToolOutput>;
}

export const toolSpecs = (tools: ToolDefinition[]): ToolSpec[] => tools.map(({ name, description, parameters }) => ({ name, description, parameters }));
export const errorOutput = (message: string): ToolOutput => ({ text: `Error: ${message}`, isError: true });
