import { join } from 'node:path';
import type { BuiltCommand, ResumeCommand, ResumeCommandInput, TurnInput } from '@weave-ai/runtime-sdk';
import { runTmpDir } from '@weave-ai/runtime-sdk';
import { asClaudeSession, isUuid } from './session.js';

/** Tools left available in `restricted` posture (no command/code execution, no network fetch). */
export const RESTRICTED_TOOLS = ['Read', 'Glob', 'Grep', 'TodoWrite', 'Task'] as const;

/** Prompts longer than this go on stdin instead of argv (ARG_MAX headroom) — only when live input is off. */
export const MAX_ARGV_PROMPT = 96_000;

export interface ClaudeBuildOpts {
  /** UUID to use when this turn starts a new session. Caller generates it (keeps buildArgs pure). */
  newSessionId: string;
  /** Scratch dir for mcp-config / system-prompt files. Defaults to os.tmpdir()/weave-ai-<runId>. */
  tmpDir?: string;
}

export interface ClaudeBuiltCommand extends BuiltCommand {
  /** The session id this turn will run under (new or resumed) — persist it as the session ref. */
  sessionId: string;
  resumed: boolean;
  /**
   * `true` unless `input.options.liveInput === false`. A live turn runs on
   * `--input-format stream-json`, has no prompt operand, and `stdin` is the turn's first `user`
   * frame — meant to be written with the channel left open, not ended, so more frames can follow.
   */
  liveInput: boolean;
}

function str(v: unknown): string | null { return typeof v === 'string' && v.length > 0 ? v : null; }

/** The turn's prompt as its first stdin frame, on the wire shape the CLI itself documents (VS-99). */
export function userFrame(text: string): string {
  return `${JSON.stringify({ type: 'user', message: { role: 'user', content: text } })}\n`;
}

/** Pure: TurnInput -> the exact `claude` invocation. No I/O; `files` is written by the adapter. */
export function buildArgs(input: TurnInput, opts: ClaudeBuildOpts): ClaudeBuiltCommand {
  const tmp = opts.tmpDir ?? runTmpDir(input.runId);
  const files: Array<{ path: string; content: string }> = [];
  const liveInput = input.options?.['liveInput'] !== false;
  // The prompt (non-live only) goes immediately after the fixed head: several later flags are
  // variadic (--allowedTools, --disallowedTools, --mcp-config, --tools) and would swallow a
  // trailing operand.
  const head: string[] = liveInput
    ? ['-p', '--output-format', 'stream-json', '--verbose', '--input-format', 'stream-json', '--replay-user-messages']
    : ['-p', '--output-format', 'stream-json', '--verbose', '--input-format', 'text'];
  const args: string[] = [];

  // A stored ref always means "resume that conversation" (a relaunch resumes too, §7.4).
  const resume = asClaudeSession(input.session.ref);
  const preferred = input.session.sessionId;
  const sessionId = resume ? resume.sessionId : (preferred && isUuid(preferred) ? preferred : opts.newSessionId);
  if (resume) {
    args.push('--resume', resume.sessionId);
    if (resume.fork) args.push('--fork-session');
  } else {
    args.push('--session-id', sessionId);
  }

  if (input.systemPrompt.mode === 'inject' && input.systemPrompt.text.trim().length > 0) {
    const path = join(tmp, 'system-prompt.md');
    files.push({ path, content: input.systemPrompt.text });
    const replace = input.options?.['systemPromptMode'] === 'replace';
    args.push(replace ? '--system-prompt-file' : '--append-system-prompt-file', path);
  }

  if (input.outputSchema) args.push('--json-schema', JSON.stringify(input.outputSchema));

  const servers = Object.entries(input.mcpServers ?? {});
  if (servers.length > 0) {
    const path = join(tmp, 'mcp-config.json');
    const mcpServers: Record<string, unknown> = {};
    for (const [name, s] of servers) {
      mcpServers[name] = s.type === 'http'
        ? { type: 'http', url: s.url, ...(s.headers ? { headers: s.headers } : {}) }
        : { type: 'stdio', command: s.command, args: s.args ?? [], ...(s.env ? { env: s.env } : {}) };
    }
    files.push({ path, content: JSON.stringify({ mcpServers }, null, 2) });
    args.push('--mcp-config', path, '--strict-mcp-config');
  }

  switch (input.permission.mode) {
    case 'bypass':
      args.push('--permission-mode', 'bypassPermissions', '--allow-dangerously-skip-permissions');
      break;
    case 'restricted':
      args.push('--permission-mode', 'dontAsk', '--restricted', '--tools', RESTRICTED_TOOLS.join(','));
      break;
    default:
      args.push('--permission-mode', 'auto');
  }
  // `dontAsk` denies anything not explicitly allowed, MCP tools included — so the
  // control-plane server must be allowlisted or the agent cannot call weave_* at all
  // (verified against claude 2.1.258).
  const allowed = [...(input.permission.allowedTools ?? [])];
  if (input.permission.mode === 'restricted') {
    for (const name of Object.keys(input.mcpServers ?? {})) {
      const tool = `mcp__${name}`;
      if (!allowed.includes(tool)) allowed.push(tool);
    }
  }
  if (allowed.length > 0) args.push('--allowedTools', ...allowed);
  if (input.permission.deniedTools?.length) args.push('--disallowedTools', ...input.permission.deniedTools);

  const model = str(input.model) ?? str(input.options?.['model']);
  if (model) args.push('--model', model);
  const effort = str(input.effort) ?? str(input.options?.['effort']);
  if (effort) args.push('--effort', effort);
  if (typeof input.limits.maxTurns === 'number') args.push('--max-turns', String(input.limits.maxTurns));
  if (typeof input.limits.maxBudgetUsd === 'number') args.push('--max-budget-usd', String(input.limits.maxBudgetUsd));

  // The worktree lives under the home (= cwd); only add it when it is somewhere else.
  const wt = input.worktree?.path;
  if (wt && !wt.startsWith(input.cwd)) args.push('--add-dir', wt);

  const settingSources = str(input.options?.['settingSources']);
  if (settingSources) args.push('--setting-sources', settingSources);

  const extra = input.options?.['extraArgs'];
  if (Array.isArray(extra)) for (const a of extra) if (typeof a === 'string') args.push(a);

  const env: Record<string, string> = { ...input.env };
  if (input.configHome) env['CLAUDE_CONFIG_DIR'] = input.configHome;

  let stdin: string | null;
  if (liveInput) {
    stdin = userFrame(input.prompt);
  } else if (input.prompt.length > MAX_ARGV_PROMPT) {
    stdin = input.prompt;
  } else {
    stdin = null;
    head.push(input.prompt);
  }

  return { cmd: 'claude', args: [...head, ...args], stdin, env, files, sessionId, resumed: Boolean(resume), liveInput };
}

/**
 * VS-249: the bare interactive `claude --resume` invocation for a human's own terminal — never the
 * headless `-p --output-format stream-json` form `buildArgs` above produces. Reuses `asClaudeSession`
 * (the same session-ref parsing `buildArgs` uses) and the same `CLAUDE_CONFIG_DIR`/`--add-dir` facts,
 * so this cannot silently drift from what a daemon-run turn would resume into.
 */
export function resumeCommand(input: ResumeCommandInput): ResumeCommand {
  const ref = asClaudeSession(input.session);
  const args: string[] = ['--resume', ref?.sessionId ?? ''];
  if (input.worktreePath && !input.worktreePath.startsWith(input.cwd)) args.push('--add-dir', input.worktreePath);
  if (input.model) args.push('--model', input.model);
  const env: Record<string, string> = {};
  if (input.configHome) env['CLAUDE_CONFIG_DIR'] = input.configHome;
  return { cmd: 'claude', args, env };
}
