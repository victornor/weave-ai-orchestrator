// Dependency-direction guard: core must not import server/cli/runtimes/channels/surfaces; sdks only depend on shared.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
const rules = [
  { pkg: 'packages/core', forbid: ['@openconductor/server', '@openconductor/cli', '@openconductor/runtime-claude', '@openconductor/runtime-codex', '@openconductor/runtime-opencode', '@openconductor/runtime-gemini', '@openconductor/channel-web', '@openconductor/channel-cli', '@openconductor/channel-telegram', '@openconductor/surface-headless', '@openconductor/surface-tmux', '@openconductor/surface-herdr', '@openconductor/surface-hyprland', '@openconductor/tui', '@openconductor/ui', '@openconductor/presenter'] },
  { pkg: 'packages/shared', forbid: ['@openconductor/'] },
  { pkg: 'packages/runtime-sdk', forbid: ['@openconductor/core', '@openconductor/db', '@openconductor/server'] },
  { pkg: 'packages/channel-sdk', forbid: ['@openconductor/core', '@openconductor/db', '@openconductor/server'] },
  { pkg: 'packages/surface-sdk', forbid: ['@openconductor/core', '@openconductor/db', '@openconductor/server'] },
];
function walk(dir, out = []) { for (const e of readdirSync(dir)) { const p = join(dir, e); const s = statSync(p); if (s.isDirectory()) { if (e !== 'node_modules' && e !== 'dist') walk(p, out); } else if (/\.(ts|tsx)$/.test(e)) out.push(p); } return out; }
let bad = 0;
for (const r of rules) { let files = []; try { files = walk(join(r.pkg, 'src')); } catch { continue; }
  for (const f of files) { const src = readFileSync(f, 'utf8'); for (const m of src.matchAll(/from\s+['"]([^'"]+)['"]/g)) { const spec = m[1]; for (const fb of r.forbid) { if (spec.startsWith(fb) && !(r.pkg === 'packages/shared' && false)) { console.error(`boundary: ${f} imports ${spec}`); bad++; } } } } }
if (bad) { console.error(`${bad} boundary violation(s)`); process.exit(1); } else console.log('boundaries ok');
