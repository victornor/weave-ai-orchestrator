import { join } from 'node:path';
import type { BuiltCommand, McpServerConfig, TurnInput } from '@openconductor/runtime-sdk';
import { asOpenCodeSession } from './session.js';

export const CONFIG_RELATIVE_PATH = '.opencode/opencode.json';

export interface OpenCodeBuiltCommand extends BuiltCommand {
  sessionId: string | null;
  resumed: boolean;
}

function str(v: unknown): string | null { return typeof v === 'string' && v.length > 0 ? v : null; }

/** `.opencode/opencode.json` — the only place OpenCode reads MCP servers from (no CLI flag). */
export function opencodeConfig(mcpServers: Record<string, McpServerConfig>, base: Record<string, unknown> = {}): string {
  const mcp: Record<string, unknown> = {};
  for (const [name, s] of Object.entries(mcpServers)) {
    mcp[name] = s.type === 'http'
      ? { type: 'remote', url: s.url, enabled: true, ...(s.headers ? { headers: s.headers } : {}) }
      : { type: 'local', command: [s.command ?? '', ...(s.args ?? [])], enabled: true, ...(s.env ? { environment: s.env } : {}) };
  }
  return `${JSON.stringify({ $schema: 'https://opencode.ai/config.json', ...base, ...(Object.keys(mcp).length > 0 ? { mcp } : {}) }, null, 2)}\n`;
}

/** Pure: TurnInput -> the exact `opencode run` invocation. */
export function buildArgs(input: TurnInput): OpenCodeBuiltCommand {
  const args: string[] = ['run', '--format', 'json', '--dir', input.cwd];

  const prev = asOpenCodeSession(input.session.ref);
  if (prev) {
    args.push('-s', prev.sessionId);
    if (prev.fork) args.push('--fork');
  }

  const model = str(input.model) ?? str(input.options?.['model']);
  if (model) args.push('-m', model);
  const effort = str(input.effort) ?? str(input.options?.['effort']);
  if (effort) args.push('--variant', effort);
  const agent = str(input.options?.['agent']);
  if (agent) args.push('--agent', agent);

  // OpenCode has one approval switch; `restricted` simply leaves it off.
  if (input.permission.mode === 'auto' || input.permission.mode === 'bypass') args.push('--auto');

  const extra = input.options?.['extraArgs'];
  if (Array.isArray(extra)) for (const a of extra) if (typeof a === 'string') args.push(a);

  const files: Array<{ path: string; content: string }> = [];
  if (Object.keys(input.mcpServers ?? {}).length > 0) {
    files.push({ path: join(input.cwd, CONFIG_RELATIVE_PATH), content: opencodeConfig(input.mcpServers) });
  }

  const env: Record<string, string> = { ...input.env };
  if (input.configHome) { env['XDG_CONFIG_HOME'] = input.configHome; env['XDG_DATA_HOME'] = input.configHome; }

  // The message is positional; `--` keeps a prompt that starts with `-` out of yargs' hands.
  args.push('--', input.prompt);

  return { cmd: 'opencode', args, stdin: null, env, files, sessionId: prev?.sessionId ?? null, resumed: Boolean(prev) };
}
