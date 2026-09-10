import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * A fake `cursor-agent` that speaks print-mode stream-json from an argv prompt
 * (or closed stdin) without the real CLI. Reports back whatever `--model` it was given (or
 * `Auto` when none was passed), like a correctly-functioning CLI would — a test that wants to
 * exercise the model-mismatch check passes `reportedModel` to override that.
 */
export function writeFakeCursorCli(opts: { assistantText?: string; sessionId?: string; reportedModel?: string } = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'ac-fake-cursor-'));
  const path = join(dir, 'cursor-agent');
  const sessionId = opts.sessionId ?? 'fake-cursor-session';
  const text = opts.assistantText ?? 'ack';
  const reportedModelOverride = opts.reportedModel;
  const script = `#!/usr/bin/env node
const dash = process.argv.indexOf('--');
const argvPrompt = dash >= 0 ? process.argv.slice(dash + 1).join(' ') : '';
const modelFlag = process.argv.indexOf('--model');
const requestedModel = modelFlag >= 0 ? process.argv[modelFlag + 1] : 'Auto';
const reportedModel = ${reportedModelOverride !== undefined ? JSON.stringify(reportedModelOverride) : 'requestedModel'};
function respond() {
  process.stdout.write(JSON.stringify({ type: 'system', subtype: 'init', session_id: ${JSON.stringify(sessionId)}, model: reportedModel, cwd: process.cwd(), permissionMode: 'default' }) + '\\n');
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

/** A fake `cursor-agent` that spawns and never writes anything to stdout/stderr, and never exits on its own (VS-187: the zero-output hang VS-167 found). */
export function writeSilentFakeCursorCli(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ac-fake-cursor-silent-'));
  const path = join(dir, 'cursor-agent');
  writeFileSync(path, '#!/usr/bin/env node\nsetInterval(() => {}, 3600_000);\n', { mode: 0o755 });
  chmodSync(path, 0o755);
  return dir;
}
