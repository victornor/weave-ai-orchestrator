#!/usr/bin/env node
import { parseReplArgs, REPL_USAGE } from './args.js';
import { runOneShot } from './main.js';
import { runRepl } from './terminal.js';

/** The agent package's own entry: `weave-agent` without the CLI. Tests start it from source; the installed command is the CLI's `weave repl`. */
async function main(): Promise<number> {
  const parsed = parseReplArgs(process.argv.slice(2));
  if ('help' in parsed) { process.stdout.write(REPL_USAGE); return 0; }
  if ('error' in parsed) { process.stderr.write(`weave-agent: ${parsed.error}\n${REPL_USAGE}`); return 2; }
  const io = { stdout: (s: string) => { process.stdout.write(s); }, stderr: (s: string) => { process.stderr.write(s); }, env: process.env, cwd: process.cwd() };
  if (parsed.opts.prompt !== undefined) {
    const ac = new AbortController();
    process.once('SIGINT', () => ac.abort()); process.once('SIGTERM', () => ac.abort());
    return runOneShot(parsed.opts, io, ac.signal);
  }
  return runRepl(parsed.opts, io);
}
main().then((code) => { process.exitCode = code; process.stdout.write('', () => process.exit(code)); });
