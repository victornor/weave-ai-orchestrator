/**
 * Test-only helper: writes a fake `openspec` executable so the adapter can be exercised without the real
 * binary (it is not installed in CI on this machine). Cases are matched first-hit, by "all these tokens are
 * present in argv", so more specific cases (`list --specs`) must be listed before broader ones (`list`).
 * Not exported from the package index.
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export interface FakeCase {
  /** argv tokens that must all be present for this case to fire. */
  match: string[];
  /** JSON document to print (a `root.path` of cwd is injected unless the doc carries one or `root` is null). */
  json?: unknown;
  /** Raw stdout, used instead of `json` (for --version and malformed-output cases). */
  stdout?: string;
  exit?: number;
  /** Force the injected `root.path`; null disables injection. */
  root?: string | null;
}
export interface FakeCall { argv: string[]; cwd: string; env: Record<string, string | undefined> }
export interface FakeBin { path: string; calls(): FakeCall[] }

export function writeFakeOpenspec(path: string, cases: FakeCase[]): FakeBin {
  const log = `${path}.calls.jsonl`;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(log, '');
  const src = [
    '#!/usr/bin/env node',
    `const CASES = ${JSON.stringify(cases)};`,
    `const LOG = ${JSON.stringify(log)};`,
    'const ARGV = process.argv.slice(2);',
    "import('node:fs').then((fs) => {",
    "  try { fs.appendFileSync(LOG, JSON.stringify({ argv: ARGV, cwd: process.cwd(), env: { CI: process.env.CI, NO_COLOR: process.env.NO_COLOR, OPENSPEC_TELEMETRY: process.env.OPENSPEC_TELEMETRY, OPENSPEC_NO_UPDATE_CHECK: process.env.OPENSPEC_NO_UPDATE_CHECK } }) + '\\n'); } catch (e) { /* ignore */ }",
    '  const hit = CASES.find((c) => c.match.every((m) => ARGV.includes(m)));',
    "  if (!hit) { process.stderr.write('fake openspec: no case for ' + ARGV.join(' ') + '\\n'); process.exit(97); }",
    "  if (typeof hit.stdout === 'string') process.stdout.write(hit.stdout);",
    '  else if (hit.json !== undefined && hit.json !== null) {',
    '    let doc = hit.json;',
    "    if (typeof doc === 'object' && !Array.isArray(doc) && !('root' in doc) && hit.root !== null) doc = Object.assign({ root: { path: hit.root || process.cwd() } }, doc);",
    '    process.stdout.write(JSON.stringify(doc));',
    '  }',
    '  process.exit(hit.exit || 0);',
    '});',
    '',
  ].join('\n');
  writeFileSync(path, src);
  chmodSync(path, 0o755);
  return {
    path,
    calls: () => (existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter((l) => l.trim().length > 0).map((l) => JSON.parse(l) as FakeCall) : []),
  };
}
