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
 * With `stream: true` it also emits the `--include-partial-messages` `stream_event` lines around the
 * assistant line (VS-599). With `--input-format text` (the headless form) it answers once on
 * startup, since that form closes stdin and carries the prompt on argv.
 *
 * Writes the script into a fresh temp dir and returns that dir, so a test can put it first on PATH
 * (`env: { PATH: dir + ':' + process.env.PATH }`) and let `launchCommand` resolve `claude` to it —
 * no adapter code needs to know a fake is involved.
 */
export function writeFakeClaudeCli(opts: { assistantText?: string; sessionId?: string; respondDelayMs?: number; stream?: boolean } = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'ac-fake-claude-'));
  const path = join(dir, 'claude');
  const sessionId = opts.sessionId ?? 'fake-cli-session';
  const text = opts.assistantText ?? 'ack';
  const delayMs = opts.respondDelayMs ?? 0;
  const stream = opts.stream === true;
  const script = `#!/usr/bin/env node
const readline = require('node:readline');
const replay = process.argv.slice(2).includes('--replay-user-messages');
const SID = ${JSON.stringify(sessionId)};
const TEXT = ${JSON.stringify(text)};
let seenFirst = false;
process.stdout.write(JSON.stringify({ type: 'system', subtype: 'init', session_id: SID, model: 'fake-model', cwd: process.cwd(), permissionMode: 'default' }) + '\\n');
function respond() {
  if (${stream}) {
    const MID = 'msg_fake_1';
    const se = (event) => JSON.stringify({ type: 'stream_event', event, session_id: SID, parent_tool_use_id: null, uuid: 'fake-uuid' }) + '\\n';
    process.stdout.write(se({ type: 'message_start', message: { id: MID, role: 'assistant', content: [] } }));
    process.stdout.write(se({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }));
    process.stdout.write(se({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: TEXT } }));
    process.stdout.write(JSON.stringify({ type: 'assistant', session_id: SID, message: { model: 'fake-model', id: MID, role: 'assistant', content: [{ type: 'text', text: TEXT }] } }) + '\\n');
    process.stdout.write(se({ type: 'content_block_stop', index: 0 }));
    process.stdout.write(se({ type: 'message_stop' }));
  } else {
    process.stdout.write(JSON.stringify({ type: 'assistant', session_id: SID, message: { model: 'fake-model', role: 'assistant', content: [{ type: 'text', text: TEXT }] } }) + '\\n');
  }
  process.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: TEXT, session_id: SID, usage: { input_tokens: 1, output_tokens: 1 } }) + '\\n');
}
const ARGV = process.argv.slice(2);
const NON_LIVE = ARGV[ARGV.indexOf('--input-format') + 1] === 'text';
if (NON_LIVE) {
  // The headless form carries the prompt on argv and closes stdin, so answer immediately and let
  // the process end with the event loop (no readline, which would exit on the immediate EOF).
  respond();
} else {
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
}
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
