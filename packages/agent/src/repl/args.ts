import type { ReplOptions } from './main.js';

export const REPL_USAGE = `Usage: weave-agent [options]   (also: weave repl [options])

Run the built-in agent yourself in this terminal.

  -p, --print <prompt>     run one turn, print the final text, exit with its exit code
  -c, --continue           continue the newest session started in this directory
      --resume <id>        resume a session by id, id prefix or its number in /sessions
      --provider <id>      provider id (workspace, agent.yaml, or a name for --base-url)
      --base-url <url>     an OpenAI-compatible endpoint; key from WEAVE_LLM_<PROVIDER>_KEY
      --preset <name>      provider preset for --base-url (default openai-compatible)
      --model <id>         model id, or provider/model
      --context-window <n> the model's context window in tokens (when the endpoint does not say)
      --permission <mode>  auto (default), restricted (read-only) or bypass
      --workspace-dir <d>  read providers and MCP servers from this workspace
      --verbose            with -p, show tool calls and events on stderr
  -h, --help               this text
`;

const VALUE_FLAGS: Record<string, keyof ReplOptions> = { '-p': 'prompt', '--print': 'prompt', '--resume': 'resume', '--provider': 'provider', '--base-url': 'baseUrl', '--preset': 'preset', '--model': 'model', '--context-window': 'contextWindow', '--permission': 'permission', '--workspace-dir': 'workspaceDir' };

/** Parse the REPL's own flags. Kept here (not in the CLI's commander) so the agent package can be started on its own, as the pty tests do. */
export function parseReplArgs(argv: readonly string[]): { opts: ReplOptions } | { help: true } | { error: string } {
  const opts: Record<string, unknown> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    const eq = a.startsWith('--') ? a.indexOf('=') : -1;
    const flag = eq > 0 ? a.slice(0, eq) : a;
    if (flag === '-h' || flag === '--help') return { help: true };
    if (flag === '-c' || flag === '--continue') { opts['continue'] = true; continue; }
    if (flag === '--verbose') { opts['verbose'] = true; continue; }
    const key = VALUE_FLAGS[flag];
    if (!key) return { error: `unknown option ${a}` };
    const value = eq > 0 ? a.slice(eq + 1) : argv[++i];
    if (value === undefined) return { error: `${flag} needs a value` };
    opts[key] = value;
  }
  return { opts: opts as ReplOptions };
}
