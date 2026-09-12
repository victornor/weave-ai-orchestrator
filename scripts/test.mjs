// Root test gate: always run the core/server suite AND the UI suite, then exit
// non-zero if either failed. The previous `vitest run && pnpm --filter ui test`
// skipped the UI suite whenever the first command was red (VS-214).
import { spawnSync } from 'node:child_process';

const suites = [
  { name: 'core/server', command: 'pnpm', args: ['exec', 'vitest', 'run'] },
  { name: 'ui', command: 'pnpm', args: ['--filter', '@weave-ai/ui', 'test'] },
];

const failed = [];
for (const suite of suites) {
  console.log(`\n--- ${suite.name} suite ---\n`);
  const r = spawnSync(suite.command, suite.args, { stdio: 'inherit', env: process.env });
  if (r.error) {
    console.error(`FAILED: ${suite.name} suite could not start: ${r.error.message}`);
    failed.push(suite.name);
    continue;
  }
  if ((r.status ?? 1) !== 0) failed.push(suite.name);
}

if (failed.length > 0) {
  console.error(`\nFAILED: ${failed.join(' and ')} suite${failed.length > 1 ? 's' : ''}`);
  process.exit(1);
}
console.log('\n--- both suites passed ---\n');
