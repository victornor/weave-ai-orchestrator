import { join } from 'node:path';
import type { BuiltCommand, McpServerConfig, ResumeCommand, ResumeCommandInput, TurnInput } from '@weave-ai/runtime-sdk';
import { asOpenCodeSession } from './session.js';

export const CONFIG_RELATIVE_PATH = '.opencode/opencode.json';

export interface OpenCodeBuiltCommand extends BuiltCommand {
  sessionId: string | null;
  resumed: boolean;
  /** `--fork`: the server driver has no fork route it was verified against, so a fork uses `run`. */
  forked: boolean;
}

function str(v: unknown): string | null { return typeof v === 'string' && v.length > 0 ? v : null; }

/**
 * VS-462: OpenCode's own built-in tools (docs: Tools). OpenCode ignores an `allowedTools` list, so
 * an interactive session's opening turn disables all of them through the config's `tools` switch
 * and leaves only the MCP control-plane tools — read the ticket and post one comment, nothing else.
 */
export const OPENCODE_NATIVE_TOOLS = ['bash', 'edit', 'write', 'read', 'grep', 'glob', 'lsp', 'apply_patch', 'skill', 'todowrite', 'webfetch', 'websearch', 'question', 'task'] as const;

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
  const base: Record<string, unknown> = {};
  if (input.permission.firstTurn) {
    const tools: Record<string, boolean> = {};
    for (const name of OPENCODE_NATIVE_TOOLS) tools[name] = false;
    base['tools'] = tools;
  }
  if (Object.keys(input.mcpServers ?? {}).length > 0 || Object.keys(base).length > 0) {
    files.push({ path: join(input.cwd, CONFIG_RELATIVE_PATH), content: opencodeConfig(input.mcpServers, base) });
  }

  const env: Record<string, string> = { ...input.env };
  if (input.configHome) {
    // VS-436: every XDG root, not only config/data — the child env is the daemon's whole
    // environment with this overlay on top (`childEnv`), so any root left unset is inherited from
    // the host user. opencode keeps its recent-model/variant state in XDG_STATE_HOME.
    env['XDG_CONFIG_HOME'] = input.configHome;
    env['XDG_DATA_HOME'] = input.configHome;
    env['XDG_STATE_HOME'] = input.configHome;
    env['XDG_CACHE_HOME'] = input.configHome;
    env['HOME'] = input.configHome;
  }

  // The message is positional; `--` keeps a prompt that starts with `-` out of yargs' hands.
  args.push('--', input.prompt);

  return { cmd: 'opencode', args, stdin: null, env, files, sessionId: prev?.sessionId ?? null, resumed: Boolean(prev), forked: Boolean(prev?.fork) };
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
 * command, per `pinHostMiseRoots` (`@weave-ai/runtime-sdk`) — this function only sets the
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
    env['XDG_STATE_HOME'] = input.configHome;
    env['XDG_CACHE_HOME'] = input.configHome;
  }
  return { cmd: 'opencode', args, env };
}
