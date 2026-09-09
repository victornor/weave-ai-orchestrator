import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * A fake `cursor-agent` that speaks print-mode stream-json closely enough to test live stdin
 * without the real CLI. Emits system/init; on the first user frame emits assistant + result;
 * exits when stdin ends.
 */
export function writeFakeCursorCli(opts: { assistantText?: string; sessionId?: string; respondDelayMs?: number } = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'ac-fake-cursor-'));
  const path = join(dir, 'cursor-agent');
  const sessionId = opts.sessionId ?? 'fake-cursor-session';
  const text = opts.assistantText ?? 'ack';
  const delayMs = opts.respondDelayMs ?? 0;
  const script = `#!/usr/bin/env node
const readline = require('node:readline');
let seenFirst = false;
process.stdout.write(JSON.stringify({ type: 'system', subtype: 'init', session_id: ${JSON.stringify(sessionId)}, model: 'fake-model', cwd: process.cwd(), permissionMode: 'default' }) + '\\n');
function respond() {
  process.stdout.write(JSON.stringify({ type: 'assistant', session_id: ${JSON.stringify(sessionId)}, message: { role: 'assistant', content: [{ type: 'text', text: ${JSON.stringify(text)} }] } }) + '\\n');
  process.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: ${JSON.stringify(text)}, session_id: ${JSON.stringify(sessionId)} }) + '\\n');
}
const rl = readline.createInterface({ input: process.stdin, terminal: false });
rl.on('line', (line) => {
  if (!line.trim()) return;
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  if (msg.type !== 'user') return;
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
