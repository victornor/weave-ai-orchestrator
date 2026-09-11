/**
 * VS-249: a cheap, coarse "did anything change under this runtime's config home" signal — the
 * newest modification time found by a shallow scan, as a comparable string. This deliberately does
 * not know or parse any runtime's specific session-file layout (only the daemon's runtime
 * credential/session directory as a whole, `ctx.paths.runtimesHome/<runtime>`, already used for
 * `CLAUDE_CONFIG_DIR` etc.) — broader than the exact session file alone. A write anywhere in that
 * tree (the session file, a credential refresh, a cache write) counts as activity; the only
 * consequence of that breadth is a hold being kept open a little longer than strictly necessary,
 * never one that is genuinely still in use being closed out from under the human using it.
 */
import { readdirSync, statSync, type Dirent } from 'node:fs';
import { join } from 'node:path';

const MAX_DEPTH = 6;

export function sessionActivitySignal(configHome: string): string | null {
  let newest = 0;
  const scan = (dir: string, depth: number): void => {
    if (depth > MAX_DEPTH) return;
    let entries: Dirent[];
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = join(dir, e.name);
      if (e.isDirectory()) { scan(p, depth + 1); continue; }
      try {
        const st = statSync(p);
        if (st.mtimeMs > newest) newest = st.mtimeMs;
      } catch { /* file vanished mid-scan; skip it */ }
    }
  };
  scan(configHome, 0);
  return newest > 0 ? String(newest) : null;
}
