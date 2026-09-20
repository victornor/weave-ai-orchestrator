/**
 * `edit` (runtime-details section 5, VS-608): replace `old_string` with `new_string`, found through an
 * ordered match chain. A fuzzier stage is used only when it yields exactly one match; more than one
 * match without `replace_all` is an error. CRLF endings and a byte-order mark are preserved, the
 * write is atomic, and the result carries a ±3-line unified diff hunk that the run page renders.
 */
import { readFileSync, statSync } from 'node:fs';
import { confinePath } from './confine.js';
import { errorOutput, type ToolDefinition } from './index.js';
import { escapeRegex } from './walk.js';
import { atomicWrite } from './write.js';

export const EDIT_MAX_BYTES = 10 * 1024 * 1024;
const BOM = '\uFEFF';
const CONTEXT_LINES = 3;

interface Match { start: number; end: number }
interface Stage { name: string; find(text: string): Match[] }

function exactMatches(text: string, needle: string): Match[] {
  const out: Match[] = [];
  for (let i = text.indexOf(needle); i !== -1; i = text.indexOf(needle, i + needle.length)) out.push({ start: i, end: i + needle.length });
  return out;
}

function regexMatches(text: string, re: RegExp): Match[] {
  const out: Match[] = [];
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m[0].length === 0) { re.lastIndex += 1; continue; }
    out.push({ start: m.index, end: m.index + m[0].length });
  }
  return out;
}

const dedent = (lines: string[]): string[] => {
  const indents = lines.filter((l) => l.trim() !== '').map((l) => /^[ \t]*/.exec(l)![0].length);
  const min = indents.length ? Math.min(...indents) : 0;
  return lines.map((l) => l.slice(min));
};

/** `‘’“”` → straight quotes; every mapping is one character to one character, so offsets survive. */
const straightQuotes = (s: string): string => s.replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"');

function stagesFor(old: string): Stage[] {
  const oldLines = old.split('\n');
  return [
    { name: 'exact', find: (t) => exactMatches(t, old) },
    { name: 'line-trimmed', find: (t) => regexMatches(t, new RegExp(oldLines.map((l) => `[ \\t]*${escapeRegex(l.trim())}[ \\t]*`).join('\\n'), 'g')) },
    { name: 'whitespace-normalised', find: (t) => regexMatches(t, new RegExp(old.trim().split(/\s+/).map(escapeRegex).join('\\s+'), 'g')) },
    { name: 'indentation-flexible', find: (t) => regexMatches(t, new RegExp(dedent(oldLines).map((l) => `[ \\t]*${escapeRegex(l)}`).join('\\n'), 'g')) },
    { name: 'smart-quote-normalised', find: (t) => exactMatches(straightQuotes(t), straightQuotes(old)) },
  ];
}

/** One `@@` hunk around a replacement, with three context lines, for the transcript's diff block. */
function hunk(text: string, m: Match, replacement: string): { text: string; additions: number; deletions: number } {
  const lines = text.split('\n');
  const startLine = m.start === 0 ? 0 : text.slice(0, m.start).split('\n').length - 1;
  const removed = text.slice(m.start, m.end).split('\n');
  const added = replacement === '' ? [''] : replacement.split('\n');
  const from = Math.max(0, startLine - CONTEXT_LINES);
  const to = Math.min(lines.length, startLine + removed.length + CONTEXT_LINES);
  const head = lines.slice(from, startLine);
  const tail = lines.slice(startLine + removed.length, to);
  const body = [
    ...head.map((l) => ` ${l}`),
    ...removed.map((l) => `-${l}`),
    ...added.map((l) => `+${l}`),
    ...tail.map((l) => ` ${l}`),
  ];
  const oldCount = head.length + removed.length + tail.length;
  const newCount = head.length + added.length + tail.length;
  return { text: `@@ -${from + 1},${oldCount} +${from + 1},${newCount} @@\n${body.join('\n')}`, additions: added.length, deletions: removed.length };
}

export const editTool: ToolDefinition = {
  name: 'edit',
  description: 'Replace text in a file that was read this turn. Matches exactly first, then a small number of tolerant fallbacks; an ambiguous match is an error. Set replace_all to replace every match.',
  parameters: {
    type: 'object', additionalProperties: false, required: ['path', 'old_string', 'new_string'],
    properties: {
      path: { type: 'string' },
      old_string: { type: 'string', minLength: 1 },
      new_string: { type: 'string' },
      replace_all: { type: 'boolean', default: false },
    },
  },
  async run(args, ctx) {
    const rawPath = args['path'];
    const oldString = args['old_string'];
    const newString = args['new_string'];
    const replaceAll = args['replace_all'] === true;
    if (typeof rawPath !== 'string' || !rawPath) return errorOutput('path is required');
    if (typeof oldString !== 'string' || oldString === '') return errorOutput('old_string is required');
    if (typeof newString !== 'string') return errorOutput('new_string is required');
    if (oldString === newString) return errorOutput('old_string and new_string are identical');

    const confined = confinePath(rawPath, 'write', ctx);
    if (!confined.ok) return errorOutput(confined.error);
    const path = confined.path;

    let size: number;
    try { size = statSync(path).size; } catch { return errorOutput(`no such file or directory: ${path}`); }
    if (size > EDIT_MAX_BYTES) return errorOutput(`file is ${size} bytes; too large to edit, use bash`);
    const check = ctx.ledger.check(path);
    if (check === 'missing') return errorOutput(`file must be read before it is edited: ${path}`);
    if (check === 'stale') return errorOutput('file changed since it was read; read it again');

    const raw = readFileSync(path, 'utf8');
    const hadBom = raw.startsWith(BOM);
    const body = hadBom ? raw.slice(BOM.length) : raw;
    const crlf = body.includes('\r\n');
    const text = body.replace(/\r\n/g, '\n');
    const replacement = newString.replace(/\r\n/g, '\n');

    let chosen: { stage: string; matches: Match[] } | null = null;
    for (const stage of stagesFor(oldString)) {
      const matches = stage.find(text);
      if (matches.length === 0) continue;
      if (matches.length > 1 && !replaceAll) return errorOutput(`${matches.length} matches for the given old_string; add more context or set replace_all`);
      chosen = { stage: stage.name, matches };
      break;
    }
    if (!chosen) return errorOutput('old_string was not found in the file');

    const hunks = chosen.matches.map((m) => hunk(text, m, replacement));
    let next = text;
    for (const m of [...chosen.matches].sort((a, b) => b.start - a.start)) next = next.slice(0, m.start) + replacement + next.slice(m.end);

    const encoded = (hadBom ? BOM : '') + (crlf ? next.replace(/\n/g, '\r\n') : next);
    try { atomicWrite(path, Buffer.from(encoded, 'utf8')); } catch (e) { return errorOutput(`could not write ${path}: ${(e as Error).message}`); }
    ctx.ledger.refresh(path, Buffer.from(encoded, 'utf8'));

    const additions = hunks.reduce((n, h) => n + h.additions, 0);
    const deletions = hunks.reduce((n, h) => n + h.deletions, 0);
    const diff = hunks.map((h) => h.text).join('\n');
    ctx.emit('file.changed', { path, changeType: 'modified', additions, deletions, diff });
    return { text: `Edited ${path}: ${chosen.matches.length} replacement(s)\n${diff}` };
  },
};