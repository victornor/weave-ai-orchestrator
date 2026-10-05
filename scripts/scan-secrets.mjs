// Scans the working tree and every commit on every ref for secrets with gitleaks (VS-774).
// Uses a `gitleaks` binary on PATH, else the official container image. Findings are redacted, so
// the output never prints a full secret. Config and the false-positive allowlist: .gitleaks.toml.
//   pnpm scan:secrets          working tree + full history (all branches, tags, remotes)
//   pnpm scan:secrets --tree   working tree only
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const treeOnly = process.argv.includes('--tree');
const IMAGE = 'zricethezav/gitleaks:latest';

const local = spawnSync('gitleaks', ['version'], { stdio: 'ignore' }).status === 0;
const prefix = local ? { cmd: 'gitleaks', args: [], src: root } : { cmd: 'docker', args: ['run', '--rm', '-v', `${root}:/repo:ro`, IMAGE], src: '/repo' };

function run(label, sub, extra) {
  console.log(`--- ${label}`);
  const r = spawnSync(prefix.cmd, [...prefix.args, sub, ...extra, '--config', `${prefix.src}/.gitleaks.toml`, '--redact', '--no-banner'], { cwd: root, stdio: 'inherit' });
  return r.status ?? 1;
}

let failed = run('working tree', 'dir', [prefix.src]);
if (!treeOnly) failed |= run('full history', 'git', ['--log-opts=--all', prefix.src]);
process.exit(failed ? 1 : 0);
