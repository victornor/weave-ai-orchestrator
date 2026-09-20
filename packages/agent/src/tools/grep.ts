/**
 * `grep` (runtime-details section 5, VS-608): `rg` when it is on `PATH`, otherwise the built-in
 * walker. Both produce the same rows — the parity test asserts it — so ordering is normalised by the
 * tool rather than left to the traversal.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { confinePath } from './confine.js';
import { errorOutput, type ToolDefinition } from './index.js';
import { globToRegExp, walk } from './walk.js';

export const GREP_MAX_ROWS = 1000;

export function rgAvailable(): boolean {
  try { return spawnSync('rg', ['--version'], { stdio: 'ignore' }).status === 0; } catch { return false; }
}

type OutputMode = 'content' | 'files_with_matches' | 'count';
interface Matches { path: string; lines: number[] }
interface SearchOpts { ignoreCase: boolean; glob?: string | undefined }

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, Math.floor(n)));

function rgMatches(pattern: string, root: string, opts: SearchOpts): Matches[] | { error: string } {
  const args = ['-n', '--no-heading', '--max-columns', '500', '--hidden', '-g', '!.git'];
  if (opts.ignoreCase) args.push('-i');
  if (opts.glob) args.push('-g', opts.glob);
  args.push('--', pattern, root);
  const r = spawnSync('rg', args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  if (r.status !== 0 && r.status !== 1) return { error: (r.stderr || 'rg failed').trim().split('\n')[0] ?? 'rg failed' };
  const byFile = new Map<string, number[]>();
  for (const row of r.stdout.split('\n')) {
    const m = /^(.*?):(\d+):/.exec(row);
    if (!m) continue;
    const path = m[1]!;
    byFile.set(path, [...(byFile.get(path) ?? []), Number(m[2])]);
  }
  return [...byFile].map(([path, lines]) => ({ path, lines }));
}

function builtinMatches(pattern: string, root: string, isFile: boolean, opts: SearchOpts): Matches[] | { error: string } {
  let re: RegExp;
  try { re = new RegExp(pattern, opts.ignoreCase ? 'i' : ''); } catch (e) { return { error: (e as Error).message }; }
  const globRe = opts.glob ? globToRegExp(opts.glob) : null;
  const entries: Array<{ path: string; rel: string }> = isFile ? [{ path: root, rel: root }] : walk(root).map((e) => ({ path: e.path, rel: e.rel }));
  const out: Matches[] = [];
  for (const entry of entries) {
    if (globRe) {
      const name = entry.rel.split('/').pop() ?? entry.rel;
      if (!globRe.test(opts.glob?.includes('/') ? entry.rel : name)) continue;
    }
    let text: string;
    try { text = readFileSync(entry.path, 'utf8'); } catch { continue; }
    if (text.includes('\u0000')) continue;
    const lines: number[] = [];
    text.split('\n').forEach((line, i) => { if (re.test(line)) lines.push(i + 1); });
    if (lines.length) out.push({ path: entry.path, lines });
  }
  return out;
}

export const grepTool: ToolDefinition = {
  name: 'grep',
  description: 'Search file contents with a regular expression. Uses ripgrep when available. output_mode is content, files_with_matches or count.',
  readOnly: true,
  parameters: {
    type: 'object', additionalProperties: false, required: ['pattern'],
    properties: {
      pattern: { type: 'string', description: 'regular expression' },
      path: { type: 'string', description: 'file or directory to search; defaults to the worktree' },
      glob: { type: 'string', description: 'file filter, e.g. *.ts' },
      ignore_case: { type: 'boolean' },
      output_mode: { type: 'string', enum: ['content', 'files_with_matches', 'count'], default: 'content' },
      context: { type: 'integer', minimum: 0, maximum: 10 },
      head_limit: { type: 'integer', minimum: 1, maximum: GREP_MAX_ROWS, default: 100 },
    },
  },
  async run(args, ctx) {
    const pattern = args['pattern'];
    if (typeof pattern !== 'string' || !pattern) return errorOutput('pattern is required');
    const mode = (typeof args['output_mode'] === 'string' ? args['output_mode'] : 'content') as OutputMode;
    const headLimit = typeof args['head_limit'] === 'number' ? clamp(args['head_limit'], 1, GREP_MAX_ROWS) : 100;
    const context = typeof args['context'] === 'number' ? clamp(args['context'], 0, 10) : 0;
    const glob = typeof args['glob'] === 'string' && args['glob'] ? args['glob'] : undefined;

    const confined = confinePath(typeof args['path'] === 'string' && args['path'] ? args['path'] : '.', 'read', ctx);
    if (!confined.ok) return errorOutput(confined.error);
    const root = confined.path;
    let isFile: boolean;
    try { isFile = statSync(root).isFile(); } catch { return errorOutput(`no such file or directory: ${root}`); }

    const opts: SearchOpts = { ignoreCase: args['ignore_case'] === true, glob };
    const found = ctx.rg ? rgMatches(pattern, root, opts) : builtinMatches(pattern, root, isFile, opts);
    if ('error' in found) return errorOutput(found.error);

    let rows: string[];
    if (mode === 'files_with_matches') {
      const withMtime = found.map((f) => ({ path: f.path, mtimeMs: mtime(f.path) }));
      withMtime.sort((a, b) => b.mtimeMs - a.mtimeMs || (a.path < b.path ? -1 : 1));
      rows = withMtime.map((f) => f.path);
    } else if (mode === 'count') {
      rows = found.map((f) => `${f.path}:${f.lines.length}`).sort();
    } else {
      rows = [];
      for (const f of [...found].sort((a, b) => (a.path < b.path ? -1 : 1))) {
        const matchLines = [...new Set(f.lines)].sort((a, b) => a - b);
        const wanted = new Set<number>();
        for (const l of matchLines) for (let i = l - context; i <= l + context; i++) if (i >= 1) wanted.add(i);
        let file: string[] | null = null;
        try { file = readFileSync(f.path, 'utf8').split('\n'); } catch { file = null; }
        for (const l of [...wanted].sort((a, b) => a - b)) {
          const body = file?.[l - 1];
          if (body === undefined) continue;
          rows.push(`${f.path}${matchLines.includes(l) ? ':' : '-'}${l}:${body}`);
        }
      }
    }

    const capped = rows.slice(0, headLimit);
    const truncated = rows.length > capped.length ? `\n[truncated: ${rows.length - capped.length} more results]` : '';
    const body = capped.join('\n') + truncated;
    return { text: body === '' ? '(no matches)' : body };
  },
};

function mtime(path: string): number {
  try { return statSync(path).mtimeMs; } catch { return 0; }
}