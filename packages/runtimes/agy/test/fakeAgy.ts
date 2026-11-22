import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const fixture = (name: string): string => readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8');

/**
 * A fake `agy` (never the real CLI: the runtime-credential rule). It reads MCP servers the way agy
 * 1.5.14 was observed to in a sandbox: from `<--gemini_dir>/config/mcp_config.json`, or from
 * `$HOME/.gemini/config/mcp_config.json` when the flag is absent; `--gemini_dir` must precede the
 * subcommand. Modes:
 *   ok          honours --gemini_dir; a `-p` turn reports the MCP servers it loaded as `structured_output`
 *   ignore-dir  ignores --gemini_dir (a future agy that dropped the flag but still parses it)
 *   reject-dir  rejects --gemini_dir like an unknown flag
 *   auth        prints the captured no-login prompt on stderr, then waits 60 s like the real one
 *   auth-result prints the captured `authentication failed or timed out` result and exits 1
 *   replay      prints the owner-captured turn 1 stream, or turn 2 when given `--conversation`
 * Every invocation's argv is appended to $FAKE_AGY_LOG as one JSON line.
 */
export function writeFakeAgy(mode: 'ok' | 'ignore-dir' | 'reject-dir' | 'auth' | 'auth-result' | 'replay', opts: { conversationId?: string } = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'ac-fake-agy-'));
  const path = join(dir, 'agy');
  const script = `#!/usr/bin/env node
const fs = require('node:fs');
const MODE = ${JSON.stringify(mode)};
const AUTH_STDERR = ${JSON.stringify(fixture('no-login.stderr.txt'))};
const AUTH_RESULT = ${JSON.stringify(fixture('no-login-result.jsonl'))};
const TURN1 = ${JSON.stringify(fixture('turn1-tool-schema.jsonl'))};
const TURN2 = ${JSON.stringify(fixture('turn2-resumed.jsonl'))};
let argv = process.argv.slice(2);
if (process.env.FAKE_AGY_LOG) fs.appendFileSync(process.env.FAKE_AGY_LOG, JSON.stringify(argv) + '\\n');
if (argv[0] === '--version') { process.stdout.write('1.5.14\\n'); process.exit(0); }
let gd = (process.env.HOME || '') + '/.gemini';
if (argv[0] === '--gemini_dir') {
  if (MODE === 'reject-dir') { process.stderr.write('Error: flags provided but not defined: -gemini_dir\\n'); process.exit(2); }
  if (MODE !== 'ignore-dir') gd = argv[1];
  argv = argv.slice(2);
}
let servers = {};
try { servers = JSON.parse(fs.readFileSync(gd + '/config/mcp_config.json', 'utf8')).mcpServers || {}; } catch {}
const names = Object.keys(servers);
if (argv[0] === 'mcp' && argv[1] === 'list') {
  if (names.length === 0) { process.stdout.write('No MCP servers configured.\\n'); process.exit(0); }
  process.stdout.write('NAME               TYPE   STATUS   COMMAND/URL\\n');
  for (const n of names) process.stdout.write(n.padEnd(Math.max(19, n.length + 2)) + 'stdio  enabled  true\\n');
  process.exit(0);
}
if (MODE === 'auth') { process.stderr.write(AUTH_STDERR.split('Error:')[0]); setTimeout(() => process.exit(1), 60000); return; }
if (MODE === 'auth-result') { process.stderr.write(AUTH_STDERR); process.stdout.write(AUTH_RESULT, () => process.exit(1)); return; }
if (MODE === 'replay') { process.stdout.write(argv.includes('--conversation') ? TURN2 : TURN1, () => process.exit(0)); return; }
const i = argv.indexOf('--conversation');
const conv = i >= 0 ? argv[i + 1] : ${JSON.stringify(opts.conversationId ?? 'conv-1')};
// Only fields the captured result carries; usage lives on step events (see the replay mode).
const result = { conversation_id: conv, status: 'SUCCESS', response: 'done', structured_output: { mcpServers: names, gemini_dir: gd } };
process.stdout.write(JSON.stringify({ event: 'result', result }) + '\\n', () => process.exit(0));
`;
  writeFileSync(path, script);
  chmodSync(path, 0o755);
  return dir;
}
