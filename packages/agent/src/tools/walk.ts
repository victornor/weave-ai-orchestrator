/**
 * The built-in directory walker behind `grep`/`glob` when `rg` is absent (runtime-details section 5,
 * VS-608). It reads `.gitignore` files per directory and matches a small glob dialect (`*`, `**`,
 * `?`); it is slower than `rg` and is only the fallback.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

export interface WalkEntry { path: string; rel: string; mtimeMs: number; size: number }

export const escapeRegex = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** `*` (within a segment), `**` (across segments) and `?`, anchored to the whole path. */
export function globToRegExp(pattern: string): RegExp {
  let re = '';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i]!;
    if (c === '*') {
      if (pattern[i + 1] === '*') { re += '.*'; i += 1; if (pattern[i + 1] === '/') i += 1; }
      else re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else re += escapeRegex(c);
  }
  return new RegExp(`^${re}$`);
}

interface IgnoreRule { re: RegExp; negate: boolean; dirOnly: boolean }

function parseIgnore(dir: string): IgnoreRule[] {
  let text: string;
  try { text = readFileSync(join(dir, '.gitignore'), 'utf8'); } catch { return []; }
  const rules: IgnoreRule[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const negate = line.startsWith('!');
    const body = negate ? line.slice(1) : line;
    const dirOnly = body.endsWith('/');
    const pattern = dirOnly ? body.slice(0, -1) : body;
    const anchored = pattern.includes('/');
    rules.push({ negate, dirOnly, re: globToRegExp(anchored ? pattern : `**/${pattern}`) });
  }
  return rules;
}

function ignored(rel: string, isDir: boolean, rules: IgnoreRule[]): boolean {
  let result = false;
  for (const r of rules) {
    if (r.dirOnly && !isDir) continue;
    if (r.re.test(rel) || r.re.test(rel.split('/').pop() ?? rel)) result = !r.negate;
  }
  return result;
}

/** Every file under `root`, skipping `.git` and anything a `.gitignore` excludes. */
export function walk(root: string): WalkEntry[] {
  const out: WalkEntry[] = [];
  const visit = (dir: string, inherited: IgnoreRule[]): void => {
    const rules = [...inherited, ...parseIgnore(dir)];
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = join(dir, e.name);
      const rel = relative(root, full).split(sep).join('/');
      if (e.isDirectory()) {
        if (e.name === '.git') continue;
        if (ignored(rel, true, rules)) continue;
        visit(full, rules);
      } else if (e.isFile()) {
        if (ignored(rel, false, rules)) continue;
        try { const st = statSync(full); out.push({ path: full, rel, mtimeMs: st.mtimeMs, size: st.size }); } catch { /* vanished */ }
      }
    }
  };
  visit(root, []);
  return out;
}