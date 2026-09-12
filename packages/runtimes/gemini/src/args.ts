import { join } from 'node:path';
import type { BuiltCommand, McpServerConfig, ResumeCommand, ResumeCommandInput, TurnInput } from '@weave-ai/runtime-sdk';
import { asGeminiSession, isUuid } from './session.js';

export const SETTINGS_RELATIVE_PATH = '.gemini/settings.json';
/** Above this, the head of the prompt goes on stdin (gemini prepends stdin to `-p`). */
export const MAX_ARGV_PROMPT = 96_000;

export interface GeminiBuildOpts { newSessionId: string }

export interface GeminiBuiltCommand extends BuiltCommand {
  sessionId: string;
  resumed: boolean;
}

function str(v: unknown): string | null { return typeof v === 'string' && v.length > 0 ? v : null; }

/** `.gemini/settings.json` — Gemini reads MCP servers only from settings, never from a flag. */
export function geminiSettings(mcpServers: Record<string, McpServerConfig>, base: Record<string, unknown> = {}): string {
  const servers: Record<string, unknown> = {};
  for (const [name, s] of Object.entries(mcpServers)) {
    servers[name] = s.type === 'http'
      ? { httpUrl: s.url, type: 'http', trust: true, ...(s.headers ? { headers: s.headers } : {}) }
      : { command: s.command, args: s.args ?? [], type: 'stdio', trust: true, ...(s.env ? { env: s.env } : {}) };
  }
  return `${JSON.stringify({ ...base, mcpServers: servers }, null, 2)}\n`;
}

/** Pure: TurnInput -> the exact `gemini` invocation. */
export function buildArgs(input: TurnInput, opts: GeminiBuildOpts): GeminiBuiltCommand {
  const args: string[] = ['-o', 'stream-json', '--skip-trust'];

  const prev = asGeminiSession(input.session.ref);
  const preferred = input.session.sessionId;
  const sessionId = prev ? prev.sessionId : (preferred && isUuid(preferred) ? preferred : opts.newSessionId);
  if (prev) args.push('--resume', prev.sessionId);
  else args.push('--session-id', sessionId);

  const model = str(input.model) ?? str(input.options?.['model']);
  if (model) args.push('-m', model);

  switch (input.permission.mode) {
    case 'bypass': args.push('--approval-mode', 'yolo'); break;
    case 'restricted': args.push('--approval-mode', 'plan'); break;
    default: args.push('--approval-mode', 'auto_edit');
  }

  // The worktree lives under the home (= cwd); include it explicitly when it does not.
  const wt = input.worktree?.path;
  if (wt && !wt.startsWith(input.cwd)) args.push('--include-directories', wt);

  const extra = input.options?.['extraArgs'];
  if (Array.isArray(extra)) for (const a of extra) if (typeof a === 'string') args.push(a);

  const files: Array<{ path: string; content: string }> = [];
  if (Object.keys(input.mcpServers ?? {}).length > 0) {
    files.push({ path: join(input.cwd, SETTINGS_RELATIVE_PATH), content: geminiSettings(input.mcpServers) });
  }

  const env: Record<string, string> = { ...input.env };
  if (input.configHome) env['GEMINI_CLI_HOME'] = input.configHome;

  // `-p` is appended to whatever arrived on stdin, so a long prompt splits head->stdin, tail->argv.
  let stdin: string | null = null;
  let promptArg = input.prompt;
  if (input.prompt.length > MAX_ARGV_PROMPT) {
    stdin = input.prompt.slice(0, input.prompt.length - 2000);
    promptArg = input.prompt.slice(input.prompt.length - 2000);
  }
  args.push('-p', promptArg);

  return { cmd: 'gemini', args, stdin, env, files, sessionId, resumed: Boolean(prev) };
}

/**
 * VS-249: the bare interactive `gemini --resume` invocation — drops the headless `-o stream-json
 * --skip-trust -p <prompt>` flags `buildArgs` above always sets, reusing the same `--resume`/
 * `--include-directories`/`GEMINI_CLI_HOME` facts so it cannot drift from the daemon's own resume.
 */
export function resumeCommand(input: ResumeCommandInput): ResumeCommand {
  const ref = asGeminiSession(input.session);
  const args: string[] = ['--resume', ref?.sessionId ?? ''];
  if (input.worktreePath && !input.worktreePath.startsWith(input.cwd)) args.push('--include-directories', input.worktreePath);
  if (input.model) args.push('-m', input.model);
  const env: Record<string, string> = {};
  if (input.configHome) env['GEMINI_CLI_HOME'] = input.configHome;
  return { cmd: 'gemini', args, env };
}
