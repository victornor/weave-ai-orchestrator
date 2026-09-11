import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** A fake `codex` that answers `debug models --bundled` with captured JSON (or fails). */
export function writeFakeCodexCli(opts: { stdout?: string; stderr?: string; exitCode?: number } = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'ac-fake-codex-models-'));
  const path = join(dir, 'codex');
  const stdout = opts.stdout ?? '';
  const stderr = opts.stderr ?? '';
  const exitCode = opts.exitCode ?? 0;
  const script = `#!/usr/bin/env node
const argv = process.argv.slice(2).join(' ');
if (argv !== 'debug models --bundled') {
  process.stderr.write('unexpected argv: ' + argv);
  process.exit(2);
}
process.stdout.write(${JSON.stringify(stdout)});
process.stderr.write(${JSON.stringify(stderr)});
process.exit(${exitCode});
`;
  writeFileSync(path, script, { mode: 0o755 });
  chmodSync(path, 0o755);
  return dir;
}
