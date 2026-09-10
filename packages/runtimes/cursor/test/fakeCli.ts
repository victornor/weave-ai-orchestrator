import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * A fake `cursor-agent` that speaks print-mode stream-json from an argv prompt
 * (or closed stdin) without the real CLI. Reports back whatever `--model` it was given (or
 * `Auto` when none was passed), like a correctly-functioning CLI would — a test that wants to
 * exercise the model-mismatch check passes `reportedModel` to override that. A test exercising the
 * unknown-model rejection path passes `unknownModelRejection` to have the CLI exit non-zero with
 * that text on stderr instead of responding normally.
 */
export function writeFakeCursorCli(opts: { assistantText?: string; sessionId?: string; reportedModel?: string; unknownModelRejection?: string } = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'ac-fake-cursor-'));
  const path = join(dir, 'cursor-agent');
  const sessionId = opts.sessionId ?? 'fake-cursor-session';
  const text = opts.assistantText ?? 'ack';
  const reportedModelOverride = opts.reportedModel;
  const rejection = opts.unknownModelRejection;
  const script = `#!/usr/bin/env node
const dash = process.argv.indexOf('--');
const argvPrompt = dash >= 0 ? process.argv.slice(dash + 1).join(' ') : '';
const modelFlag = process.argv.indexOf('--model');
const requestedModel = modelFlag >= 0 ? process.argv[modelFlag + 1] : 'Auto';
const reportedModel = ${reportedModelOverride !== undefined ? JSON.stringify(reportedModelOverride) : 'requestedModel'};
function reject() {
  process.stderr.write(${JSON.stringify(rejection ?? '')});
  process.exit(1);
}
function respond() {
  process.stdout.write(JSON.stringify({ type: 'system', subtype: 'init', session_id: ${JSON.stringify(sessionId)}, model: reportedModel, cwd: process.cwd(), permissionMode: 'default' }) + '\\n');
  process.stdout.write(JSON.stringify({ type: 'assistant', session_id: ${JSON.stringify(sessionId)}, message: { role: 'assistant', content: [{ type: 'text', text: ${JSON.stringify(text)} }] } }) + '\\n');
  process.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: ${JSON.stringify(text)}, session_id: ${JSON.stringify(sessionId)} }) + '\\n');
  process.exit(0);
}
const finish = ${rejection !== undefined ? 'reject' : 'respond'};
if (argvPrompt.length > 0) finish();
else {
  let buf = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (c) => { buf += c; });
  process.stdin.on('end', () => finish());
}
`;
  writeFileSync(path, script, { mode: 0o755 });
  chmodSync(path, 0o755);
  return dir;
}

/**
 * A fake `cursor-agent` that responds to `--list-models` with a configurable payload (or exits
 * non-zero with `stderr` to exercise the failure/fallback path). `countFile`, when given, gets one
 * byte appended on every invocation, letting a test assert exactly how many times the CLI spawned.
 */
export function writeFakeCursorCliListModels(opts: { stdout?: string; stderr?: string; exitCode?: number; countFile?: string } = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'ac-fake-cursor-models-'));
  const path = join(dir, 'cursor-agent');
  const stdout = opts.stdout ?? '';
  const stderr = opts.stderr ?? '';
  const exitCode = opts.exitCode ?? 0;
  const countFile = opts.countFile;
  const script = `#!/usr/bin/env node
${countFile ? `try { require('node:fs').appendFileSync(${JSON.stringify(countFile)}, 'x'); } catch {}` : ''}
process.stdout.write(${JSON.stringify(stdout)});
process.stderr.write(${JSON.stringify(stderr)});
process.exit(${exitCode});
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
