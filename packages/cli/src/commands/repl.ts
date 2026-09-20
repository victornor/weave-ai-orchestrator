/** `weave repl` (also `weave-agent`): the built-in agent in your terminal (VS-626). */
import type { Command } from 'commander';
import { runOneShot, runRepl, type ReplOptions } from '@weave-ai/agent';

export function register(program: Command): void {
  program
    .command('repl')
    .description('run the built-in agent yourself, in this terminal (also installed as `weave-agent`)')
    .option('-p, --print <prompt>', 'run one turn, print the final text and exit with its exit code')
    .option('-c, --continue', 'continue the most recent session started in this directory')
    .option('--resume <id>', 'resume a session by id, id prefix or its number in /sessions')
    .option('--provider <id>', 'provider id (from the workspace or agent.yaml, or a name for --base-url)')
    .option('--base-url <url>', 'an OpenAI-compatible endpoint; the key is read from WEAVE_LLM_<PROVIDER>_KEY')
    .option('--preset <name>', 'provider preset for --base-url (default openai-compatible)')
    .option('--model <id>', 'model id, or provider/model')
    .option('--context-window <tokens>', "the model's context window in tokens, when the endpoint does not report one")
    .option('--permission <mode>', 'auto (default), restricted (read-only) or bypass')
    .option('--workspace-dir <dir>', 'read providers and MCP servers from this workspace instead of the nearest one')
    .option('--verbose', 'with -p, show tool calls and events on stderr', false)
    .action(async (opts: Record<string, unknown>) => {
      const o: ReplOptions = {
        ...(typeof opts['print'] === 'string' ? { prompt: opts['print'] } : {}),
        ...(opts['continue'] === true ? { continue: true } : {}),
        ...(typeof opts['resume'] === 'string' ? { resume: opts['resume'] } : {}),
        ...(typeof opts['provider'] === 'string' ? { provider: opts['provider'] } : {}),
        ...(typeof opts['baseUrl'] === 'string' ? { baseUrl: opts['baseUrl'] } : {}),
        ...(typeof opts['preset'] === 'string' ? { preset: opts['preset'] } : {}),
        ...(typeof opts['model'] === 'string' ? { model: opts['model'] } : {}),
        ...(typeof opts['contextWindow'] === 'string' ? { contextWindow: opts['contextWindow'] } : {}),
        ...(typeof opts['permission'] === 'string' ? { permission: opts['permission'] } : {}),
        ...(typeof opts['workspaceDir'] === 'string' ? { workspaceDir: opts['workspaceDir'] } : {}),
        verbose: opts['verbose'] === true,
      };
      const io = { stdout: (s: string) => { process.stdout.write(s); }, stderr: (s: string) => { process.stderr.write(s); }, env: process.env, cwd: process.cwd() };
      const ac = new AbortController();
      const onSig = (): void => ac.abort();
      if (o.prompt !== undefined) {
        process.once('SIGINT', onSig); process.once('SIGTERM', onSig);
        process.exitCode = await runOneShot(o, io, ac.signal);
      } else {
        process.exitCode = await runRepl(o, io);
      }
      // A stdio MCP server or a slow socket must not keep a finished command alive.
      process.stdout.write('', () => process.exit(process.exitCode ?? 0));
    });
}
