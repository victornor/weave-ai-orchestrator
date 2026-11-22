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
/** Above this the prompt goes on stdin rather than argv (MAX_ARG_STRLEN headroom). */
export const MAX_ARGV_PROMPT = 96_000;

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
  // Never `--effort`: the effort is already in the model id (design §4).

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

  // A prompt flag takes the next word as its value, so `-p <prompt>` comes first after the dir. A
  // prompt too long for argv goes on stdin with a trailing valueless `-p` (unverified on 1.5.14:
  // the owner capture's `stdin-prompt` probe settles it).
  let stdin: string | null = null;
  if (input.prompt.length > MAX_ARGV_PROMPT) {
    stdin = input.prompt;
    args.push(...tail, '-p');
  } else {
    args.push('-p', input.prompt, ...tail);
  }

  return { cmd: 'agy', args, stdin, env: { ...input.env }, files, conversationId: prev?.conversationId ?? null, resumed: Boolean(prev), model, dir };
}

/** The bare interactive resume for a human's terminal: same dir and conversation, no print flags. */
export function resumeCommand(input: ResumeCommandInput): ResumeCommand {
  const ref = asAgySession(input.session);
  const args: string[] = ['--gemini_dir', agyDir(input.cwd), '--conversation', ref?.conversationId ?? ''];
  if (input.worktreePath && !input.worktreePath.startsWith(input.cwd)) args.push('--add-dir', input.worktreePath);
  if (input.model) args.push('--model', composeModelId(input.model, null));
  return { cmd: 'agy', args, env: {} };
}
