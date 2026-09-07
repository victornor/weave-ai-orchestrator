/**
 * Syntax highlighting for the PR diff viewer (VS-107 / ADR 0013): `highlight.js`'s own curated
 * `common` bundle (36 languages — every one this repository and the C#/React project elsewhere in
 * this workspace need), loaded once, lazily, on first use — never part of the app's main bundle.
 *
 * A file whose extension is not in `EXTENSIONS`, or a line highlighted before the bundle has loaded,
 * renders as escaped plain text: correct, not degraded, the same rule the diff viewer already
 * follows for a binary or too-large file.
 */
import { useEffect, useState } from 'react';
import type { HLJSApi } from 'highlight.js';

let cached: HLJSApi | null = null;
let loading: Promise<HLJSApi> | null = null;

function loadHljs(): Promise<HLJSApi> {
  loading ??= import('highlight.js/lib/common').then((m) => {
    cached = m.default;
    return cached;
  });
  return loading;
}

/** Extension to `highlight.js/lib/common` language id. Anything not here renders unhighlighted. */
const EXTENSIONS: Record<string, string> = {
  ts: 'typescript', tsx: 'typescript', mts: 'typescript', cts: 'typescript',
  js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
  json: 'json',
  yaml: 'yaml', yml: 'yaml',
  md: 'markdown', markdown: 'markdown',
  css: 'css', scss: 'scss', less: 'less',
  sql: 'sql',
  sh: 'bash', bash: 'bash', zsh: 'bash',
  html: 'xml', htm: 'xml', xml: 'xml', svg: 'xml',
  cs: 'csharp',
  rs: 'rust',
  java: 'java',
  php: 'php',
  c: 'cpp', h: 'cpp', cpp: 'cpp', cc: 'cpp', cxx: 'cpp', hpp: 'cpp',
  go: 'go',
  py: 'python',
  rb: 'ruby',
  swift: 'swift',
  kt: 'kotlin', kts: 'kotlin',
  lua: 'lua',
  pl: 'perl',
  r: 'r',
  vb: 'vbnet',
  graphql: 'graphql',
  ini: 'ini',
};

export function languageForPath(path: string): string | null {
  const m = /\.([a-zA-Z0-9]+)$/.exec(path);
  if (!m) return null;
  return EXTENSIONS[m[1]!.toLowerCase()] ?? null;
}

/** Loads the grammar bundle on first use and re-renders once it resolves; a module-level cache means every caller after the first gets it synchronously. */
export function useHighlighter(): HLJSApi | null {
  const [hljs, setHljs] = useState<HLJSApi | null>(cached);
  useEffect(() => {
    if (cached) { setHljs(cached); return; }
    let alive = true;
    loadHljs().then((h) => { if (alive) setHljs(h); });
    return () => { alive = false; };
  }, []);
  return hljs;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * One line's highlighted markup, safe for `dangerouslySetInnerHTML` — `highlight.js` escapes the
 * source text itself, the same trust boundary `lib/markdown.ts` already renders through.
 */
export function highlightLine(hljs: HLJSApi | null, text: string, lang: string | null): string {
  if (!hljs || !lang || !hljs.getLanguage(lang)) return escapeHtml(text);
  try {
    return hljs.highlight(text, { language: lang, ignoreIllegals: true }).value;
  } catch {
    return escapeHtml(text);
  }
}
