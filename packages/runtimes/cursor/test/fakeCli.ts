import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * A fake `cursor-agent` that speaks print-mode stream-json from an argv prompt
 * (or closed stdin) without the real CLI.
 */
export function writeFakeCursorCli(opts: { assistantText?: string; sessionId?: string } = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'ac-fake-cursor-'));
  const path = join(dir, 'cursor-agent');
  const sessionId = opts.sessionId ?? 'fake-cursor-session';
  const text = opts.assistantText ?? 'ack';
  const script = `#!/usr/bin/env node
const dash = process.argv.indexOf('--');
const argvPrompt = dash >= 0 ? process.argv.slice(dash + 1).join(' ') : '';
function respond() {
  process.stdout.write(JSON.stringify({ type: 'system', subtype: 'init', session_id: ${JSON.stringify(sessionId)}, model: 'fake-model', cwd: process.cwd(), permissionMode: 'default' }) + '\\n');
  process.stdout.write(JSON.stringify({ type: 'assistant', session_id: ${JSON.stringify(sessionId)}, message: { role: 'assistant', content: [{ type: 'text', text: ${JSON.stringify(text)} }] } }) + '\\n');
  process.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: ${JSON.stringify(text)}, session_id: ${JSON.stringify(sessionId)} }) + '\\n');
  process.exit(0);
}
if (argvPrompt.length > 0) respond();
else {
  let buf = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (c) => { buf += c; });
  process.stdin.on('end', () => respond());
}
`;
  writeFileSync(path, script, { mode: 0o755 });
  chmodSync(path, 0o755);
  return dir;
}
