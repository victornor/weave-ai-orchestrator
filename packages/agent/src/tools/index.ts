import type { ToolSpec } from '../codec/chatCompletions.js';
import type { PermissionMode } from '../permission.js';
import type { ReadLedger } from './ledger.js';

export interface ToolCtx {
  /** The worktree, where a relative path resolves and a shell starts. */
  cwd: string;
  /** The agent home, the other allowed root for the file tools. */
  home: string;
  /** The runtime config home, used to derive the protected workspace state directory. */
  configHome?: string | undefined;
  /** The turn's permission mode; confinement and deny patterns read it. */
  mode: PermissionMode;
  /** The shell's environment. Never carries the provider key or the run token. */
  env: Record<string, string>;
  signal: AbortSignal;
  callId: string;
  /** Where a truncated output's full text goes: outside the worktree. */
  spillDir: string;
  /** The turn's read ledger: file writes compare against it. */
  ledger: ReadLedger;
  /** Whether `rg` was found on `PATH`; the search tools prefer it and fall back when false. */
  rg: boolean;
  /** Emit a `runtime` event for this call; the loop adds the call id. */
  emit(type: string, payload: Record<string, unknown>): void;
}
export interface ToolOutput { text: string; isError?: boolean; meta?: { command?: string; exitCode?: number | null } }
export interface ToolDefinition extends ToolSpec {
  /** Core tools and MCP tools share this shape. */
  readOnly?: boolean;
  run(args: Record<string, unknown>, ctx: ToolCtx): Promise<ToolOutput>;
}

export const toolSpecs = (tools: ToolDefinition[]): ToolSpec[] => tools.map(({ name, description, parameters }) => ({ name, description, parameters }));
export const errorOutput = (message: string): ToolOutput => ({ text: `Error: ${message}`, isError: true });