/**
 * `glob` (runtime-details section 5, VS-608): up to 100 paths, newest first, `rg --files` when `rg`
 * is on `PATH` and the built-in walker otherwise.
 */
import { spawnSync } from 'node:child_process';
import { statSync } from 'node:fs';
import { confinePath } from './confine.js';
import { errorOutput, type ToolDefinition } from './index.js';
import { globToRegExp, walk } from './walk.js';

export const GLOB_MAX_PATHS = 100;

function rgFiles(pattern: string, root: string): string[] | { error: string } {
  const r = spawnSync('rg', ['--files', '--hidden', '-g', '!.git', '-g', pattern, root], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  if (r.status !== 0 && r.status !== 1) return { error: (r.stderr || 'rg failed').trim().split('\n')[0] ?? 'rg failed' };
  return r.stdout.split('\n').filter(Boolean);
}

export const globTool: ToolDefinition = {
  name: 'glob',
  description: 'List files matching a glob pattern (e.g. src/**/*.ts), newest first.',
  readOnly: true,
  parameters: {
    type: 'object', additionalProperties: false, required: ['pattern'],
    properties: {
      pattern: { type: 'string', description: 'e.g. src/**/*.ts' },
      path: { type: 'string', description: 'directory to search; defaults to the worktree' },
    },
  },
  async run(args, ctx) {
    const pattern = args['pattern'];
    if (typeof pattern !== 'string' || !pattern) return errorOutput('pattern is required');
    const confined = confinePath(typeof args['path'] === 'string' && args['path'] ? args['path'] : '.', 'read', ctx);
    if (!confined.ok) return errorOutput(confined.error);
    const root = confined.path;

    let paths: string[];
    if (ctx.rg) {
      const found = rgFiles(pattern, root);
      if (!Array.isArray(found)) return errorOutput(found.error);
      paths = found;
    } else {
      const re = globToRegExp(pattern);
      paths = walk(root).filter((e) => re.test(pattern.includes('/') ? e.rel : (e.rel.split('/').pop() ?? e.rel))).map((e) => e.path);
    }

    const withMtime = paths.map((p) => ({ p, mtimeMs: mtime(p) }));
    withMtime.sort((a, b) => b.mtimeMs - a.mtimeMs || (a.p < b.p ? -1 : 1));
    const shown = withMtime.slice(0, GLOB_MAX_PATHS);
    const note = withMtime.length > shown.length ? `\n[truncated: ${withMtime.length - shown.length} more paths]` : '';
    return { text: shown.map((x) => x.p).join('\n') + note };
  },
};

function mtime(path: string): number {
  try { return statSync(path).mtimeMs; } catch { return 0; }
}