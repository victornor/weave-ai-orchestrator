// No bare console.* outside cli/tui/scripts (use the logger).
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
const allow = ['packages/cli', 'packages/tui', 'packages/ui'];
function walk(dir, out = []) { for (const e of readdirSync(dir)) { const p = join(dir, e); const s = statSync(p); if (s.isDirectory()) { if (e !== 'node_modules' && e !== 'dist') walk(p, out); } else if (/\.(ts|tsx)$/.test(e) && !/\.test\.ts$/.test(e)) out.push(p); } return out; }
let bad = 0;
for (const f of walk('packages')) { if (allow.some(a => f.startsWith(a))) continue; const src = readFileSync(f, 'utf8'); const lines = src.split('\n'); lines.forEach((l, i) => { if (/\bconsole\.(log|warn|error|info|debug)\(/.test(l) && !/oc-allow-console/.test(l)) { console.error(`console: ${f}:${i + 1}`); bad++; } }); }
if (bad) { console.error(`${bad} console violation(s)`); process.exit(1); } else console.log('console ok');
