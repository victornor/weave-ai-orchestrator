import { createHash } from 'node:crypto';
import { join } from 'node:path';
import type { BuiltCommand, McpServerConfig, ResumeCommand, ResumeCommandInput, TurnInput } from '@weave-ai/runtime-sdk';
import { runTmpDir } from '@weave-ai/runtime-sdk';
import { asCodexSession } from './session.js';

export interface CodexBuildOpts { tmpDir?: string; configExists?: boolean; modelContextWindowTokens?: number }
/**
 * `mcp_servers.<name>.default_tools_approval_mode` (Rust `AppToolApproval`) is a different key from
 * `approval_policy`. Its variants are `auto`, `prompt`, `writes`, `approve`; `never` is an
 * `approval_policy` variant and the CLI refuses to load a config that puts it here. `approve` is the
 * auto-approval variant, which is what a headless worker needs for its run-scoped MCP server;
 * `auto` would still prompt for the daemon's unannotated tools.
 */
type McpApprovalMode = 'approve';

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
function key(value: string): string { return /^[A-Za-z0-9_-]+$/.test(value) ? value : toml(value); }

function inlineTable(values: Record<string, string>): string {
  return `{${Object.entries(values).map(([k, v]) => `${key(k)}=${toml(v)}`).join(',')}}`;
}

function envVarName(server: string): string {
  const suffix = createHash('sha256').update(server).digest('hex').slice(0, 12).toUpperCase();
  return `AC_MCP_TOKEN_${server.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_${suffix}`;
}

/** `-c mcp_servers.<name>....` overrides for one server, plus any env the token needs. */
export function mcpOverrides(name: string, s: McpServerConfig, approvalMode?: McpApprovalMode): { args: string[]; env: Record<string, string> } {
  if (!/^[A-Za-z0-9_-]+$/.test(name)) throw new Error('codex: MCP server names must contain only letters, numbers, underscores or hyphens');
  const args: string[] = [];
  const env: Record<string, string> = {};
  const push = (k: string, v: string) => { args.push('-c', `mcp_servers.${key(name)}.${k}=${v}`); };
  if (s.type === 'http') {
    push('url', toml(s.url ?? ''));
    const headers: Record<string, string> = {};
    for (const [h, v] of Object.entries(s.headers ?? {})) {
      const bearer = h.toLowerCase() === 'authorization' ? /^Bearer\s+(.+)$/i.exec(v)?.[1] : undefined;
      if (bearer) {
        // Keep the token out of argv (and out of `ps`): pass it through the environment.
        const key = envVarName(name);
        env[key] = bearer;
        push('bearer_token_env_var', toml(key));
      } else {
        headers[h] = v;
      }
    }
    if (Object.keys(headers).length) push('http_headers', inlineTable(headers));
  } else {
    push('command', toml(s.command ?? ''));
    if (s.args?.length) push('args', JSON.stringify(s.args));
    if (Object.keys(s.env ?? {}).length) push('env', inlineTable(s.env ?? {}));
  }
  if (approvalMode) push('default_tools_approval_mode', toml(approvalMode));
  // Codex serializes calls to a server that does not declare this, so every weave_* call became its
  // own round trip — and each round trip re-sends the whole session window. The control-plane server
  // is concurrency-safe (the daemon serializes its own writes), so allow the model to batch
  // independent calls into one response.
  push('supports_parallel_tool_calls', 'true');
  return { args, env };
}

/** TOML fallback for `CODEX_HOME/config.toml` when per-invocation `-c` is not wanted. */
export function mcpConfigToml(servers: Record<string, McpServerConfig>, tokenEnv?: Record<string, string>, approvalMode?: McpApprovalMode): string {
  const lines: string[] = ['# written by Weave AI before each turn; do not edit'];
  for (const [name, s] of Object.entries(servers)) {
    lines.push('', `[mcp_servers.${key(name)}]`);
    if (s.type === 'http') {
      lines.push(`url = ${toml(s.url ?? '')}`);
      const headers = Object.entries(s.headers ?? {}).filter(([h, v]) => {
        const bearer = h.toLowerCase() === 'authorization' ? /^Bearer\s+(.+)$/i.exec(v)?.[1] : undefined;
        if (!bearer || !tokenEnv) return true;
        const tokenKey = envVarName(name);
        tokenEnv[tokenKey] = bearer;
        lines.push(`bearer_token_env_var = ${toml(tokenKey)}`);
        return false;
      });
      if (headers.length > 0) {
        lines.push(`[mcp_servers.${key(name)}.http_headers]`);
        for (const [h, v] of headers) lines.push(`${JSON.stringify(h)} = ${toml(v)}`);
      }
    } else {
      lines.push(`command = ${toml(s.command ?? '')}`);
      if (s.args?.length) lines.push(`args = ${JSON.stringify(s.args)}`);
      if (Object.keys(s.env ?? {}).length) {
        lines.push(`[mcp_servers.${key(name)}.env]`);
        for (const [k, v] of Object.entries(s.env ?? {})) lines.push(`${key(k)} = ${toml(v)}`);
      }
    }
    if (approvalMode) lines.push(`default_tools_approval_mode = ${toml(approvalMode)}`);
    // See mcpOverrides: without this Codex serializes every call to the server.
    lines.push('supports_parallel_tool_calls = true');
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
    // Codex defaults headless invocations to approval_policy="never".  `auto` is
    // the sandboxed worker posture, not the bypass posture, so it also needs the
    // matching automatic approval policy to let its run-scoped MCP server answer.
    if (input.permission.mode === 'auto') args.push('-c', `approval_policy=${toml('on-request')}`);
  }

  const model = str(input.model) ?? str(input.options?.['model']);
  if (model) args.push('-m', model);
  const effort = str(input.effort) ?? str(input.options?.['effort']);
  if (effort) args.push('-c', `model_reasoning_effort=${toml(effort)}`);

  const positiveInteger = (option: string, value: unknown): number => {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) throw new Error(`codex: ${option} must be a positive integer`);
    return value;
  };
  args.push('-c', `tool_output_token_limit=${positiveInteger('toolOutputTokenLimit', input.options?.['toolOutputTokenLimit'] ?? 4096)}`);
  const percent = input.options?.['compactionPercent'] ?? 60;
  if (typeof percent !== 'number' || !Number.isFinite(percent) || percent <= 0 || percent > 100) throw new Error('codex: compactionPercent must be greater than 0 and at most 100');
  const configuredWindow = input.options?.['contextWindowTokens'];
  const window = configuredWindow === undefined ? opts.modelContextWindowTokens : positiveInteger('contextWindowTokens', configuredWindow);
  if (configuredWindow !== undefined) args.push('-c', `model_context_window=${window}`);
  const explicitLimit = input.options?.['autoCompactTokenLimit'];
  if (explicitLimit !== undefined) {
    args.push('-c', `model_auto_compact_token_limit=${positiveInteger('autoCompactTokenLimit', explicitLimit)}`);
  } else if (window !== undefined) {
    args.push('-c', `model_auto_compact_token_limit=${Math.max(1, Math.floor(window * percent / 100))}`);
  }
  // Unknown window: preserve the CLI's threshold instead of guessing a model's capacity.

  const servers = Object.entries(input.mcpServers ?? {});
  const viaFile = input.options?.['mcpViaConfigFile'] === true;
  const mcpApprovalMode: McpApprovalMode | undefined = input.permission.mode === 'bypass' ? undefined : 'approve';
  if (servers.length > 0) {
    if (viaFile && input.configHome && !opts.configExists) {
      files.push({ path: join(input.configHome, 'config.toml'), content: mcpConfigToml(input.mcpServers, env, mcpApprovalMode) });
    } else {
      for (const [name, s] of servers) {
        const o = mcpOverrides(name, s, mcpApprovalMode);
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
