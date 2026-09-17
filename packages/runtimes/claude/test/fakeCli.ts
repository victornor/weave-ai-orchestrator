import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * A fake `claude` binary that speaks the `--input-format stream-json --output-format stream-json`
 * contract closely enough to test the adapter end to end without the real CLI (VS-99, forbidden by
 * the runtime-credential rule): it emits a `system:init`, and on the first `user` frame it receives
 * emits one assistant text block and a `result`. Every `user` frame is echoed back verbatim when
 * `--replay-user-messages` is among its args — the CLI's own documented acknowledgement. It exits
 * only when stdin ends, matching "stream-json input requires a readable stdin for the lifetime of
 * the session."
 *
 * Writes the script into a fresh temp dir and returns that dir, so a test can put it first on PATH
 * (`env: { PATH: dir + ':' + process.env.PATH }`) and let `launchCommand` resolve `claude` to it —
 * no adapter code needs to know a fake is involved.
 */
export function writeFakeClaudeCli(opts: { assistantText?: string; sessionId?: string; respondDelayMs?: number } = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'ac-fake-claude-'));
  const path = join(dir, 'claude');
  const sessionId = opts.sessionId ?? 'fake-cli-session';
  const text = opts.assistantText ?? 'ack';
  const delayMs = opts.respondDelayMs ?? 0;
  const script = `#!/usr/bin/env node
const readline = require('node:readline');
const replay = process.argv.slice(2).includes('--replay-user-messages');
let seenFirst = false;
process.stdout.write(JSON.stringify({ type: 'system', subtype: 'init', session_id: ${JSON.stringify(sessionId)}, model: 'fake-model', cwd: process.cwd(), permissionMode: 'default' }) + '\\n');
function respond() {
  process.stdout.write(JSON.stringify({ type: 'assistant', session_id: ${JSON.stringify(sessionId)}, message: { model: 'fake-model', role: 'assistant', content: [{ type: 'text', text: ${JSON.stringify(text)} }] } }) + '\\n');
  process.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: ${JSON.stringify(text)}, session_id: ${JSON.stringify(sessionId)}, usage: { input_tokens: 1, output_tokens: 1 } }) + '\\n');
}
const rl = readline.createInterface({ input: process.stdin, terminal: false });
rl.on('line', (line) => {
  if (!line.trim()) return;
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  if (msg.type !== 'user') return;
  if (replay) process.stdout.write(line + '\\n');
  if (seenFirst) return;
  seenFirst = true;
  if (${delayMs} > 0) setTimeout(respond, ${delayMs}); else respond();
});
rl.on('close', () => process.exit(0));
`;
  writeFileSync(path, script, { mode: 0o755 });
  chmodSync(path, 0o755);
  return dir;
}

/** A fake print-mode Claude binary for the external `/compact` command. */
export function writeFakeClaudeCompactCli(opts: { boundary?: boolean; sessionId?: string } = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'ac-fake-claude-compact-'));
  const path = join(dir, 'claude');
  const sessionId = opts.sessionId ?? 'fake-compact-session';
  const output = opts.boundary
    ? { type: 'system', subtype: 'compact_boundary', session_id: sessionId, compact_metadata: { trigger: 'manual', pre_tokens: 200_000, post_tokens: 12_000 } }
    : { type: 'result', subtype: 'success', is_error: false, result: 'already compact' };
  const script = `#!/usr/bin/env node
process.stdout.write(${JSON.stringify(JSON.stringify(output))} + '\\n');
`;
  writeFileSync(path, script, { mode: 0o755 });
  chmodSync(path, 0o755);
  return dir;
}
