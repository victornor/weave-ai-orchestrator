import { closeSync, openSync, readFileSync, readSync, readdirSync, statSync } from 'node:fs';
import { errorOutput, type ToolDefinition } from './index.js';
import { confinePath } from './confine.js';

export const READ_MAX_LINES = 2000;
export const READ_MAX_BYTES = 50 * 1024;
export const READ_MAX_LINE_CHARS = 2000;
const DIR_MAX_ENTRIES = 500;
const FILE_MAX_BYTES = 64 * 1024 * 1024;

export const readTool: ToolDefinition = {
  name: 'read',
  description: 'Read a file (numbered lines, paged with offset and limit) or list a directory.',
  readOnly: true,
  parameters: {
    type: 'object', additionalProperties: false, required: ['path'],
    properties: {
      path: { type: 'string', description: 'File or directory, absolute or relative to the worktree' },
      offset: { type: 'integer', minimum: 1, description: '1-based first line' },
      limit: { type: 'integer', minimum: 1, maximum: READ_MAX_LINES },
    },
  },
  async run(args, ctx) {
    if (typeof args['path'] !== 'string' || !args['path']) return errorOutput('path is required');
    const confined = confinePath(args['path'], 'read', ctx);
    if (!confined.ok) return errorOutput(confined.error);
    const path = confined.path;
    let st;
    try { st = statSync(path); } catch { return errorOutput(`no such file or directory: ${path}`); }
    if (st.isDirectory()) {
      const names = readdirSync(path, { withFileTypes: true }).map((e) => (e.isDirectory() ? `${e.name}/` : e.name)).sort();
      const shown = names.slice(0, DIR_MAX_ENTRIES);
      return { text: shown.join('\n') + (names.length > shown.length ? `\n[showing ${shown.length} of ${names.length} entries]` : '') };
    }
    if (st.size > FILE_MAX_BYTES) return errorOutput(`file is ${st.size} bytes; too large to read, use bash`);
    if (isBinary(path, st.size)) return errorOutput('binary file');
    ctx.ledger.record(path);
    const offset = typeof args['offset'] === 'number' ? Math.max(1, Math.floor(args['offset'])) : 1;
    const limit = typeof args['limit'] === 'number' ? Math.min(READ_MAX_LINES, Math.max(1, Math.floor(args['limit']))) : READ_MAX_LINES;
    const lines = readFileSync(path, 'utf8').split('\n');
    if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
    const total = lines.length;
    if (offset > total && total > 0) return errorOutput(`offset ${offset} is past the end of the file (${total} lines)`);
    const rows: string[] = [];
    let bytes = 0;
    let last = offset - 1;
    for (let i = offset - 1; i < total && rows.length < limit; i++) {
      let line = lines[i]!;
      if (line.length > READ_MAX_LINE_CHARS) line = `${line.slice(0, READ_MAX_LINE_CHARS)}… [line truncated, ${line.length} chars]`;
      const row = `${i + 1}\t${line}`;
      if (bytes + row.length + 1 > READ_MAX_BYTES && rows.length > 0) break;
      rows.push(row);
      bytes += row.length + 1;
      last = i + 1;
    }
    const footer = last < total ? `\n[showing lines ${offset}-${last} of ${total}; call read with offset=${last + 1}]` : '';
    return { text: rows.join('\n') + footer };
  },
};

function isBinary(path: string, size: number): boolean {
  const n = Math.min(size, 8192);
  if (n === 0) return false;
  const buf = Buffer.alloc(n);
  const fd = openSync(path, 'r');
  try { readSync(fd, buf, 0, n, 0); } finally { closeSync(fd); }
  return buf.includes(0);
}
