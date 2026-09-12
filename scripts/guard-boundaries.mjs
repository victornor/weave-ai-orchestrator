// Dependency-direction guard: core must not import server/cli/runtimes/channels/surfaces; sdks only depend on shared.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
const rules = [
  { pkg: 'packages/core', forbid: ['@weave-ai/server', '@weave-ai/cli', '@weave-ai/runtime-claude', '@weave-ai/runtime-codex', '@weave-ai/runtime-opencode', '@weave-ai/runtime-gemini', '@weave-ai/runtime-cursor', '@weave-ai/channel-web', '@weave-ai/channel-cli', '@weave-ai/channel-telegram', '@weave-ai/surface-headless', '@weave-ai/surface-tmux', '@weave-ai/surface-herdr', '@weave-ai/surface-hyprland', '@weave-ai/tui', '@weave-ai/ui', '@weave-ai/presenter'] },
  { pkg: 'packages/shared', forbid: ['@weave-ai/'] },
  { pkg: 'packages/runtime-sdk', forbid: ['@weave-ai/core', '@weave-ai/db', '@weave-ai/server'] },
  { pkg: 'packages/channel-sdk', forbid: ['@weave-ai/core', '@weave-ai/db', '@weave-ai/server'] },
  { pkg: 'packages/surface-sdk', forbid: ['@weave-ai/core', '@weave-ai/db', '@weave-ai/server'] },
];
function walk(dir, out = []) { for (const e of readdirSync(dir)) { const p = join(dir, e); const s = statSync(p); if (s.isDirectory()) { if (e !== 'node_modules' && e !== 'dist') walk(p, out); } else if (/\.(ts|tsx)$/.test(e)) out.push(p); } return out; }
let bad = 0;
for (const r of rules) { let files = []; try { files = walk(join(r.pkg, 'src')); } catch { continue; }
  for (const f of files) { const src = readFileSync(f, 'utf8'); for (const m of src.matchAll(/from\s+['"]([^'"]+)['"]/g)) { const spec = m[1]; for (const fb of r.forbid) { if (spec.startsWith(fb) && !(r.pkg === 'packages/shared' && false)) { console.error(`boundary: ${f} imports ${spec}`); bad++; } } } } }
if (bad) { console.error(`${bad} boundary violation(s)`); process.exit(1); } else console.log('boundaries ok');
