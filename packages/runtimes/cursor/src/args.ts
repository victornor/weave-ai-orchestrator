import { join } from 'node:path';
import type { BuiltCommand, McpServerConfig, TurnInput } from '@agent-conductor/runtime-sdk';
import { asCursorSession } from './session.js';

export const MCP_RELATIVE_PATH = '.cursor/mcp.json';
export const MAX_ARGV_PROMPT = 96_000;

const WORKTREE_FLAGS = new Set(['--worktree', '-w', '--worktree-base']);
const BANNED_EXACT = new Set(['acp', 'worker']);

export interface CursorBuiltCommand extends BuiltCommand {
  sessionId: string | null;
  resumed: boolean;
  liveInput: boolean;
}

function str(v: unknown): string | null { return typeof v === 'string' && v.length > 0 ? v : null; }

/** Claude's stdin frame shape (VS-99 / ADR 0012). Live cursor turns use the same wire. */
export function userFrame(text: string): string {
  return `${JSON.stringify({ type: 'user', message: { role: 'user', content: text } })}\n`;
}

export function cursorMcpConfig(mcpServers: Record<string, McpServerConfig>): string {
  const servers: Record<string, unknown> = {};
  for (const [name, s] of Object.entries(mcpServers)) {
    servers[name] = s.type === 'http'
      ? { url: s.url, ...(s.headers ? { headers: s.headers } : {}) }
      : { command: s.command, args: s.args ?? [], ...(s.env ? { env: s.env } : {}) };
  }
  return `${JSON.stringify({ mcpServers: servers }, null, 2)}\n`;
}

function pushExtra(args: string[], extra: unknown): void {
  if (!Array.isArray(extra)) return;
  for (let i = 0; i < extra.length; i++) {
    const a = extra[i];
    if (typeof a !== 'string') continue;
    if (BANNED_EXACT.has(a)) continue;
    if (a.startsWith('--worktree=') || a.startsWith('-w=')) continue;
    if (WORKTREE_FLAGS.has(a)) {
      const next = extra[i + 1];
      if (typeof next === 'string' && !next.startsWith('-')) i++;
      continue;
    }
    args.push(a);
  }
}

/** Pure: TurnInput -> the exact `cursor-agent` invocation. */
export function buildArgs(input: TurnInput): CursorBuiltCommand {
  const liveInput = input.options?.['liveInput'] !== false;
  const args: string[] = ['-p', '--output-format', 'stream-json', '--trust'];

  const prev = asCursorSession(input.session.ref);
  if (prev) args.push('--resume', prev.sessionId);

  if (input.permission.mode === 'restricted') {
    args.push('--sandbox', 'enabled');
  } else {
    args.push('--sandbox', 'disabled');
    args.push(input.permission.mode === 'bypass' ? '--yolo' : '--force');
  }

  const model = str(input.model) ?? str(input.options?.['model']);
  if (model) args.push('--model', model);

  const files: Array<{ path: string; content: string }> = [];
  const servers = input.mcpServers ?? {};
  if (Object.keys(servers).length > 0) {
    files.push({ path: join(input.cwd, MCP_RELATIVE_PATH), content: cursorMcpConfig(servers) });
    args.push('--approve-mcps');
  }

  pushExtra(args, input.options?.['extraArgs']);

  const env: Record<string, string> = { ...input.env };
  if (input.configHome) env['CURSOR_CONFIG_DIR'] = input.configHome;

  let stdin: string | null = null;
  if (liveInput) {
    stdin = userFrame(input.prompt);
  } else if (input.prompt.length > MAX_ARGV_PROMPT) {
    stdin = input.prompt;
  } else {
    args.push('--', input.prompt);
  }

  return {
    cmd: 'cursor-agent',
    args,
    stdin,
    env,
    files,
    sessionId: prev?.sessionId ?? null,
    resumed: Boolean(prev),
    liveInput,
  };
}
