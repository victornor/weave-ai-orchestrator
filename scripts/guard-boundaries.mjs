// Dependency-direction guard: core must not import server/cli/runtimes/channels/surfaces; sdks only depend on shared.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
const rules = [
  { pkg: 'packages/core', forbid: ['@agent-conductor/server', '@agent-conductor/cli', '@agent-conductor/runtime-claude', '@agent-conductor/runtime-codex', '@agent-conductor/runtime-opencode', '@agent-conductor/runtime-gemini', '@agent-conductor/runtime-cursor', '@agent-conductor/channel-web', '@agent-conductor/channel-cli', '@agent-conductor/channel-telegram', '@agent-conductor/surface-headless', '@agent-conductor/surface-tmux', '@agent-conductor/surface-herdr', '@agent-conductor/surface-hyprland', '@agent-conductor/tui', '@agent-conductor/ui', '@agent-conductor/presenter'] },
  { pkg: 'packages/shared', forbid: ['@agent-conductor/'] },
  { pkg: 'packages/runtime-sdk', forbid: ['@agent-conductor/core', '@agent-conductor/db', '@agent-conductor/server'] },
  { pkg: 'packages/channel-sdk', forbid: ['@agent-conductor/core', '@agent-conductor/db', '@agent-conductor/server'] },
  { pkg: 'packages/surface-sdk', forbid: ['@agent-conductor/core', '@agent-conductor/db', '@agent-conductor/server'] },
];
function walk(dir, out = []) { for (const e of readdirSync(dir)) { const p = join(dir, e); const s = statSync(p); if (s.isDirectory()) { if (e !== 'node_modules' && e !== 'dist') walk(p, out); } else if (/\.(ts|tsx)$/.test(e)) out.push(p); } return out; }
let bad = 0;
for (const r of rules) { let files = []; try { files = walk(join(r.pkg, 'src')); } catch { continue; }
  for (const f of files) { const src = readFileSync(f, 'utf8'); for (const m of src.matchAll(/from\s+['"]([^'"]+)['"]/g)) { const spec = m[1]; for (const fb of r.forbid) { if (spec.startsWith(fb) && !(r.pkg === 'packages/shared' && false)) { console.error(`boundary: ${f} imports ${spec}`); bad++; } } } } }
if (bad) { console.error(`${bad} boundary violation(s)`); process.exit(1); } else console.log('boundaries ok');
