import { join } from 'node:path';
import type { BuiltCommand, McpServerConfig, ResumeCommand, ResumeCommandInput, TurnInput } from '@agent-conductor/runtime-sdk';
import { runTmpDir } from '@agent-conductor/runtime-sdk';
import { asCodexSession } from './session.js';

export interface CodexBuildOpts { tmpDir?: string }

export interface CodexBuiltCommand extends BuiltCommand {
  /** Thread being resumed/forked, or null for a new thread (id arrives in `thread.started`). */
  threadId: string | null;
  mode: 'new' | 'resume' | 'fork';
  /** File `-o` writes the final assistant message to. */
  lastMessagePath: string;
}

function str(v: unknown): string | null { return typeof v === 'string' && v.length > 0 ? v : null; }
/** A `-c key=value` override; the value half is TOML, so strings are quoted. */
function toml(value: string): string { return JSON.stringify(value); }

function envVarName(server: string): string {
  return `AC_MCP_TOKEN_${server.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;
}

/** `-c mcp_servers.<name>....` overrides for one server, plus any env the token needs. */
export function mcpOverrides(name: string, s: McpServerConfig): { args: string[]; env: Record<string, string> } {
  const args: string[] = [];
  const env: Record<string, string> = {};
  const push = (k: string, v: string) => { args.push('-c', `mcp_servers.${name}.${k}=${v}`); };
  if (s.type === 'http') {
    push('url', toml(s.url ?? ''));
    for (const [h, v] of Object.entries(s.headers ?? {})) {
      const bearer = h.toLowerCase() === 'authorization' ? /^Bearer\s+(.+)$/i.exec(v)?.[1] : undefined;
      if (bearer) {
        // Keep the token out of argv (and out of `ps`): pass it through the environment.
        const key = envVarName(name);
        env[key] = bearer;
        push('bearer_token_env_var', toml(key));
      } else {
        push(`http_headers.${h}`, toml(v));
      }
    }
  } else {
    push('command', toml(s.command ?? ''));
    if (s.args?.length) push('args', JSON.stringify(s.args));
    for (const [k, v] of Object.entries(s.env ?? {})) push(`env.${k}`, toml(v));
  }
  return { args, env };
}

/** TOML fallback for `CODEX_HOME/config.toml` when per-invocation `-c` is not wanted. */
export function mcpConfigToml(servers: Record<string, McpServerConfig>): string {
  const lines: string[] = ['# written by AgentConductor before each turn; do not edit'];
  for (const [name, s] of Object.entries(servers)) {
    lines.push('', `[mcp_servers.${name}]`);
    if (s.type === 'http') {
      lines.push(`url = ${toml(s.url ?? '')}`);
      const headers = Object.entries(s.headers ?? {});
      if (headers.length > 0) {
        lines.push(`[mcp_servers.${name}.http_headers]`);
        for (const [h, v] of headers) lines.push(`${JSON.stringify(h)} = ${toml(v)}`);
      }
    } else {
      lines.push(`command = ${toml(s.command ?? '')}`);
      if (s.args?.length) lines.push(`args = ${JSON.stringify(s.args)}`);
    }
  }
  return `${lines.join('\n')}\n`;
}

/** Pure: TurnInput -> the exact `codex exec` invocation. */
export function buildArgs(input: TurnInput, opts: CodexBuildOpts = {}): CodexBuiltCommand {
  const tmp = opts.tmpDir ?? runTmpDir(input.runId);
  const files: Array<{ path: string; content: string }> = [];
  const env: Record<string, string> = { ...input.env };
  if (input.configHome) env['CODEX_HOME'] = input.configHome;

  const prev = asCodexSession(input.session.ref);
  const mode: CodexBuiltCommand['mode'] = prev ? (prev.fork ? 'fork' : 'resume') : 'new';
  const args: string[] = ['exec'];
  if (mode === 'resume') args.push('resume', prev!.threadId);
  else if (mode === 'fork') args.push('fork', prev!.threadId);

  args.push('--json', '--skip-git-repo-check');
  // `-C` exists on `codex exec` only; resume/fork inherit the spawned process cwd.
  if (mode === 'new') args.push('-C', input.cwd);

  // Sandbox: a flag on `exec`, the equivalent config key on resume/fork.
  if (input.permission.mode === 'bypass') {
    args.push('--dangerously-bypass-approvals-and-sandbox');
  } else {
    const sandbox = input.permission.mode === 'restricted' ? 'read-only' : 'workspace-write';
    if (mode === 'new') args.push('--sandbox', sandbox);
    else args.push('-c', `sandbox_mode=${toml(sandbox)}`);
  }

  const model = str(input.model) ?? str(input.options?.['model']);
  if (model) args.push('-m', model);
  const effort = str(input.effort) ?? str(input.options?.['effort']);
  if (effort) args.push('-c', `model_reasoning_effort=${toml(effort)}`);

  const servers = Object.entries(input.mcpServers ?? {});
  const viaFile = input.options?.['mcpViaConfigFile'] === true;
  if (servers.length > 0) {
    if (viaFile && input.configHome) {
      files.push({ path: join(input.configHome, 'config.toml'), content: mcpConfigToml(input.mcpServers) });
    } else {
      for (const [name, s] of servers) {
        const o = mcpOverrides(name, s);
        args.push(...o.args);
        Object.assign(env, o.env);
      }
    }
  }

  if (input.outputSchema) {
    const path = join(tmp, 'output-schema.json');
    files.push({ path, content: JSON.stringify(input.outputSchema, null, 2) });
    args.push('--output-schema', path);
  }
  const lastMessagePath = join(tmp, 'last-message.txt');
  args.push('-o', lastMessagePath);

  const extra = input.options?.['extraArgs'];
  if (Array.isArray(extra)) for (const a of extra) if (typeof a === 'string') args.push(a);

  // `-` makes codex read the prompt from stdin, so no length limit and nothing leaks into argv.
  args.push('-');

  return { cmd: 'codex', args, stdin: input.prompt, env, files, threadId: prev?.threadId ?? null, mode, lastMessagePath };
}

/**
 * VS-249: the bare interactive `codex resume <threadId>` invocation — distinct from `codex exec
 * resume <id>` above, which is the headless, scripted form. Codex's own `exec resume`/`exec fork`
 * inherit the spawned process's cwd rather than taking `-C` (see the comment on `mode === 'new'`
 * above); the interactive form is assumed to do the same. Unlike Claude/Cursor/Gemini's flag-based
 * `--resume`, Codex's resume is a subcommand — its exact interactive spelling could not be confirmed
 * against the real CLI (forbidden from inside a ticket); this mirrors the one Codex subcommand shape
 * already used for headless resume and should be treated as best-effort until the daemon's owner
 * confirms it against a real `codex resume <id>`.
 */
export function resumeCommand(input: ResumeCommandInput): ResumeCommand {
  const ref = asCodexSession(input.session);
  const args: string[] = ['resume', ref?.threadId ?? ''];
  const env: Record<string, string> = {};
  if (input.configHome) env['CODEX_HOME'] = input.configHome;
  return { cmd: 'codex', args, env };
}
