// No test may read a fixture from openspec/changes/: that tree is renamed to
// openspec/changes/archive/<date>-<name> when a change lands, so a test pointed at it breaks on the
// very merge that archives its own change (VS-241). Capture bytes belong in a package fixtures
// directory next to the tests, e.g. packages/core/src/runs/fixtures/.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const REF = /openspec\/changes(?![\w-])/g;
const READ = /\b(readFile|readFileSync|readdir|readdirSync|createReadStream|fileURLToPath|existsSync)\b/;

function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    const s = statSync(p);
    if (s.isDirectory()) {
      if (e !== 'node_modules' && e !== 'dist') walk(p, out);
    } else if (/\.test\.(ts|tsx)$/.test(e)) out.push(p);
  }
  return out;
}

/**
 * A path into the moveable change tree. A bare root-relative `openspec/changes/...` string is data
 * (a fake CLI's JSON output); a traversal, a filesystem-read call on the line, or a reference with
 * a path prefix before it is a real dependency on a folder that will move.
 */
function violates(line) {
  const refs = [...line.matchAll(REF)];
  if (refs.length === 0) return false;
  const embedded = refs.some((m) => {
    const before = line[m.index - 1];
    return before !== "'" && before !== '"' && before !== '`';
  });
  return embedded || READ.test(line) || /\.\.\//.test(line);
}

let bad = 0;
for (const f of walk('packages')) {
  readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
    if (violates(line)) {
      console.error(`test fixture: ${f}:${i + 1} reaches into openspec/changes/ (moved on archive)`);
      bad++;
    }
  });
}
if (bad) { console.error(`${bad} test fixture violation(s)`); process.exit(1); }
console.log('test fixtures ok');
