/**
 * Pure: TurnInput -> the exact `agy` invocation (VS-995, built against agy 1.5.14).
 *
 * Every invocation names the agent's own config dir with `--gemini_dir`, a root flag 1.5.14
 * accepts but leaves out of `--help`. It moves the whole `.gemini` tree — `config/mcp_config.json`,
 * plugins, hooks, global rules, settings and conversations — so a worker never loads the machine
 * owner's `~/.gemini` (whose `mcp_config.json` lists personal servers). `--settings` cannot do this:
 * it rejects `mcpServers` ("unknown setting"). See ADR 0025 and `isolation.ts`, which refuses the
 * runtime when the flag stops isolating.
 */
import { isAbsolute, join, resolve } from 'node:path';
import type { BuiltCommand, McpServerConfig, ResumeCommand, ResumeCommandInput, TurnInput } from '@weave-ai/runtime-sdk';
import { composeModelId } from './models.js';
import { asAgySession } from './session.js';

/** The per-agent config dir inside the agent home. Always absolute: agy resolves a relative one itself. */
export const AGY_DIR_NAME = '.agy';
/**
 * Above this many bytes the prompt goes in a file instead of argv: Linux caps one argument at
 * MAX_ARG_STRLEN (131072 bytes). agy 1.5.14 cannot take it on stdin instead — a valueless trailing
 * `-p` is rejected (`flag needs an argument: -p`, exit 2; owner capture, fixtures/valueless-p.stderr.txt).
 */
export const MAX_ARGV_PROMPT = 120_000;

export function agyDir(home: string): string {
  return join(isAbsolute(home) ? home : resolve(home), AGY_DIR_NAME);
}

/** Where agy reads MCP servers from, inside a `--gemini_dir`. */
export function mcpConfigPath(dir: string): string { return join(dir, 'config', 'mcp_config.json'); }

/** `config/mcp_config.json` holding exactly `servers` — the whole MCP surface of the turn. */
export function mcpConfigJson(servers: Record<string, McpServerConfig>): string {
  const mcpServers: Record<string, unknown> = {};
  for (const [name, s] of Object.entries(servers)) {
    mcpServers[name] = s.type === 'http'
      ? { url: s.url, ...(s.headers ? { headers: s.headers } : {}) }
      : { command: s.command, args: s.args ?? [], ...(s.env ? { env: s.env } : {}) };
  }
  return `${JSON.stringify({ mcpServers }, null, 2)}\n`;
}

/** Where an over-long prompt is written for one run. */
export function promptFilePath(dir: string, runId: string): string {
  return join(dir, 'prompts', `${runId.replace(/[^\w.-]/g, '_')}.md`);
}

export function longPromptPointer(path: string): string {
  return `This turn's prompt is too long for the command line, so it is in the file ${path}. Read that whole file first, then follow it exactly as if it were this message.`;
}

export interface AgyBuiltCommand extends BuiltCommand {
  /** The resumed conversation, or null on a first turn (the id then comes from the stream). */
  conversationId: string | null;
  resumed: boolean;
  /** The exact `--model` value sent, or null when none was set. */
  model: string | null;
  /** The `--gemini_dir` this command runs under. */
  dir: string;
}

function str(v: unknown): string | null { return typeof v === 'string' && v.length > 0 ? v : null; }

export function buildArgs(input: TurnInput): AgyBuiltCommand {
  const dir = agyDir(input.cwd);
  const args: string[] = ['--gemini_dir', dir];
  const tail: string[] = ['--output-format', 'stream-json'];

  if (input.outputSchema) tail.push('--json-schema', JSON.stringify(input.outputSchema));

  const prev = asAgySession(input.session.ref);
  if (prev) tail.push('--conversation', prev.conversationId);

  const requested = str(input.model) ?? str(input.options?.['model']);
  const effort = str(input.effort) ?? str(input.options?.['effort']);
  const model = requested ? composeModelId(requested, effort) : null;
  if (model) tail.push('--model', model);
  // Never `--effort`. agy 1.5.14 refuses a variant id combined with `--effort` outright, before the
  // model is reached — `error: invalid model selection (--model "gemini-4-neon-high" --effort "low"):
  // --model gemini-4-neon-high conflicts with --effort=low`, exit 1 (owner capture,
  // fixtures/model-effort-conflict.stderr.txt). The effort is already in the id (design §4).

  switch (input.permission.mode) {
    case 'bypass': tail.push('--dangerously-skip-permissions'); break;
    case 'restricted': tail.push('--mode', 'plan'); break;
    default: tail.push('--mode', 'accept-edits');
  }

  const wt = input.worktree?.path;
  if (wt && !wt.startsWith(input.cwd)) tail.push('--add-dir', wt);

  const extra = input.options?.['extraArgs'];
  if (Array.isArray(extra)) for (const a of extra) if (typeof a === 'string') tail.push(a);

  const files: Array<{ path: string; content: string }> = [
    { path: mcpConfigPath(dir), content: mcpConfigJson(input.mcpServers ?? {}) },
  ];

  // `-p <prompt>` comes first after the dir. A prompt too long for one argv entry is written to a
  // file in the agent's own dir and `-p` tells the agent to read it before anything else.
  let promptArg = input.prompt;
  if (Buffer.byteLength(input.prompt, 'utf8') > MAX_ARGV_PROMPT) {
    const path = promptFilePath(dir, input.runId);
    files.push({ path, content: input.prompt });
    promptArg = longPromptPointer(path);
  }
  args.push('-p', promptArg, ...tail);

  return { cmd: 'agy', args, stdin: null, env: { ...input.env }, files, conversationId: prev?.conversationId ?? null, resumed: Boolean(prev), model, dir };
}

/** The bare interactive resume for a human's terminal: same dir and conversation, no print flags. */
export function resumeCommand(input: ResumeCommandInput): ResumeCommand {
  const ref = asAgySession(input.session);
  const args: string[] = ['--gemini_dir', agyDir(input.cwd), '--conversation', ref?.conversationId ?? ''];
  if (input.worktreePath && !input.worktreePath.startsWith(input.cwd)) args.push('--add-dir', input.worktreePath);
  if (input.model) args.push('--model', composeModelId(input.model, null));
  return { cmd: 'agy', args, env: {} };
}
