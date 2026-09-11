import { join } from 'node:path';
import type { BuiltCommand, McpServerConfig, ResumeCommand, ResumeCommandInput, TurnInput } from '@agent-conductor/runtime-sdk';
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
  if (input.configHome) {
    env['XDG_CONFIG_HOME'] = input.configHome;
    env['XDG_DATA_HOME'] = input.configHome;
    env['HOME'] = input.configHome;
  }

  // The message is positional; `--` keeps a prompt that starts with `-` out of yargs' hands.
  args.push('--', input.prompt);

  return { cmd: 'opencode', args, stdin: null, env, files, sessionId: prev?.sessionId ?? null, resumed: Boolean(prev) };
}

/**
 * VS-249: the bare interactive OpenCode invocation — drops the headless `run --format json --dir
 * ... -- <prompt>` subcommand `buildArgs` above always uses, reusing the same `-s <sessionId>`/
 * `HOME`+`XDG_*` facts so it cannot drift from the daemon's own resume. OpenCode's own interactive
 * TUI has no `run` subcommand at all, so — unlike Claude/Cursor/Gemini, whose `--resume` flag is
 * reused as-is — this could not be confirmed against the real CLI (forbidden from inside a ticket)
 * and should be treated as best-effort until the daemon's owner confirms it against a real
 * `opencode -s <id>`. The caller (the core command-construction module, not this function) is
 * responsible for pinning `MISE_*` back to the daemon's own roots when it builds a human's resume
 * command, per `pinHostMiseRoots` (`@agent-conductor/runtime-sdk`) — this function only sets the
 * overlay `HOME`/`XDG_*` values themselves, exactly as `buildArgs` above does.
 */
export function resumeCommand(input: ResumeCommandInput): ResumeCommand {
  const ref = asOpenCodeSession(input.session);
  const args: string[] = ['-s', ref?.sessionId ?? ''];
  if (input.model) args.push('-m', input.model);
  const env: Record<string, string> = {};
  if (input.configHome) {
    env['HOME'] = input.configHome;
    env['XDG_CONFIG_HOME'] = input.configHome;
    env['XDG_DATA_HOME'] = input.configHome;
  }
  return { cmd: 'opencode', args, env };
}
