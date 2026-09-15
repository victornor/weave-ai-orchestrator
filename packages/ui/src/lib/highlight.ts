/**
 * Syntax highlighting for every file-edit preview (VS-107 / ADR 0013; VS-445): `highlight.js`'s
 * core plus one grammar imported on first use, so the main bundle carries no grammars and a
 * language loads only when a file of that type first appears. The old `lib/common` bundle was a
 * fixed 36 languages and could not reach past them.
 *
 * A line whose path maps to no language, or one asked for before its grammar has loaded, renders
 * as escaped plain text: correct, not degraded — the same rule the diff viewer already follows for
 * a binary or too-large file.
 */
import { useEffect, useMemo, useState } from 'react';
import type { HLJSApi, LanguageFn } from 'highlight.js';

/**
 * One dynamic import per grammar `languageForPath` can name. An explicit map rather than
 * `import(\`highlight.js/lib/languages/${lang}\`)` because Vite can only statically analyse a
 * relative dynamic specifier: a bare-package template literal is left untouched in a browser build
 * and fails at runtime. Each entry becomes its own lazy chunk, so no grammar is in the main bundle.
 */
const GRAMMARS: Record<string, () => Promise<{ default: LanguageFn }>> = {
  typescript: () => import('highlight.js/lib/languages/typescript'),
  javascript: () => import('highlight.js/lib/languages/javascript'),
  python: () => import('highlight.js/lib/languages/python'),
  go: () => import('highlight.js/lib/languages/go'),
  rust: () => import('highlight.js/lib/languages/rust'),
  csharp: () => import('highlight.js/lib/languages/csharp'),
  java: () => import('highlight.js/lib/languages/java'),
  kotlin: () => import('highlight.js/lib/languages/kotlin'),
  swift: () => import('highlight.js/lib/languages/swift'),
  ruby: () => import('highlight.js/lib/languages/ruby'),
  php: () => import('highlight.js/lib/languages/php'),
  c: () => import('highlight.js/lib/languages/c'),
  cpp: () => import('highlight.js/lib/languages/cpp'),
  scala: () => import('highlight.js/lib/languages/scala'),
  dart: () => import('highlight.js/lib/languages/dart'),
  lua: () => import('highlight.js/lib/languages/lua'),
  perl: () => import('highlight.js/lib/languages/perl'),
  r: () => import('highlight.js/lib/languages/r'),
  vbnet: () => import('highlight.js/lib/languages/vbnet'),
  vbscript: () => import('highlight.js/lib/languages/vbscript'),
  sql: () => import('highlight.js/lib/languages/sql'),
  bash: () => import('highlight.js/lib/languages/bash'),
  powershell: () => import('highlight.js/lib/languages/powershell'),
  yaml: () => import('highlight.js/lib/languages/yaml'),
  ini: () => import('highlight.js/lib/languages/ini'),
  json: () => import('highlight.js/lib/languages/json'),
  xml: () => import('highlight.js/lib/languages/xml'),
  css: () => import('highlight.js/lib/languages/css'),
  scss: () => import('highlight.js/lib/languages/scss'),
  less: () => import('highlight.js/lib/languages/less'),
  markdown: () => import('highlight.js/lib/languages/markdown'),
  graphql: () => import('highlight.js/lib/languages/graphql'),
  protobuf: () => import('highlight.js/lib/languages/protobuf'),
  dockerfile: () => import('highlight.js/lib/languages/dockerfile'),
  makefile: () => import('highlight.js/lib/languages/makefile'),
  nginx: () => import('highlight.js/lib/languages/nginx'),
  diff: () => import('highlight.js/lib/languages/diff'),
};

let core: HLJSApi | null = null;
let corePromise: Promise<HLJSApi> | null = null;
const registered = new Set<string>();
const loadingLangs = new Map<string, Promise<void>>();

function loadCore(): Promise<HLJSApi> {
  corePromise ??= import('highlight.js/lib/core').then((m) => (core = m.default));
  return corePromise;
}

/** The cached core, or null until the first `loadLanguage`/`highlightLine` needs it. */
export function getHighlighter(): HLJSApi | null {
  return core;
}

/** Registers a grammar on first use (and caches it); a second call for the same language reuses the same promise. */
export function loadLanguage(lang: string): Promise<void> {
  if (registered.has(lang)) return Promise.resolve();
  let pending = loadingLangs.get(lang);
  if (!pending) {
    pending = loadCore().then(async (hljs) => {
      const loader = GRAMMARS[lang];
      if (!loader) throw new Error(`no highlight.js grammar bundled for ${lang}`);
      const mod = await loader();
      hljs.registerLanguage(lang, mod.default);
      registered.add(lang);
    });
    loadingLangs.set(lang, pending);
  }
  return pending;
}

/** True once a language's grammar is registered and can highlight. */
export function isLanguageLoaded(lang: string): boolean {
  return registered.has(lang);
}

/**
 * Extension to `highlight.js` language id. Every value is a grammar `highlight.js` ships; anything
 * it does not ship (see the delivery note — `toml`, `hcl`/`terraform`, `fish`) maps to the nearest
 * grammar that exists rather than being guessed at, and an extension not here renders plain text.
 */
const EXTENSIONS: Record<string, string> = {
  ts: 'typescript', tsx: 'typescript', mts: 'typescript', cts: 'typescript',
  js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
  py: 'python', pyi: 'python', pyw: 'python',
  go: 'go',
  rs: 'rust',
  cs: 'csharp', csx: 'csharp',
  java: 'java',
  kt: 'kotlin', kts: 'kotlin',
  swift: 'swift',
  rb: 'ruby', rake: 'ruby',
  php: 'php',
  c: 'c', h: 'c',
  cpp: 'cpp', cc: 'cpp', cxx: 'cpp', cpp2: 'cpp', hpp: 'cpp', hh: 'cpp', hxx: 'cpp', inl: 'cpp',
  scala: 'scala', sc: 'scala',
  dart: 'dart',
  lua: 'lua',
  pl: 'perl', pm: 'perl',
  r: 'r',
  vb: 'vbnet', vbs: 'vbscript',
  sql: 'sql',
  sh: 'bash', bash: 'bash', zsh: 'bash', fish: 'bash', ksh: 'bash', env: 'ini',
  ps1: 'powershell', psm1: 'powershell', psd1: 'powershell',
  yaml: 'yaml', yml: 'yaml',
  toml: 'ini', ini: 'ini', conf: 'ini', cfg: 'ini', properties: 'ini',
  json: 'json', jsonc: 'json',
  xml: 'xml', html: 'xml', htm: 'xml', svg: 'xml', xsl: 'xml', xhtml: 'xml',
  css: 'css', scss: 'scss', less: 'less',
  md: 'markdown', markdown: 'markdown', mdx: 'markdown',
  graphql: 'graphql', gql: 'graphql',
  proto: 'protobuf',
  diff: 'diff', patch: 'diff',
};

/** Well-known file names that carry their own language but no usable extension. */
const FILENAMES: Record<string, string> = {
  dockerfile: 'dockerfile',
  containerfile: 'dockerfile',
  makefile: 'makefile',
  gnumakefile: 'makefile',
  'nginx.conf': 'nginx',
  '.bashrc': 'bash',
  '.zshrc': 'bash',
  '.profile': 'bash',
  '.bash_profile': 'bash',
};

/** Extension or well-known file name to `highlight.js` language id; null when nothing matches. */
export function languageForPath(path: string): string | null {
  const base = (path.split(/[\\/]/).pop() ?? path).toLowerCase();
  const byName = FILENAMES[base];
  if (byName) return byName;
  if (base.startsWith('dockerfile') || base.endsWith('.dockerfile') || base.startsWith('containerfile')) return 'dockerfile';
  if (base.startsWith('makefile') || base.endsWith('.mk')) return 'makefile';
  if (base.startsWith('.env')) return 'ini';
  const m = /\.([a-zA-Z0-9]+)$/.exec(base);
  if (!m) return null;
  return EXTENSIONS[m[1]!] ?? null;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * One line's highlighted markup, safe for `dangerouslySetInnerHTML` — `highlight.js` escapes the
 * source text itself, the same trust boundary `lib/markdown.ts` already renders through. Escapes
 * when the language is unknown or its grammar has not loaded yet.
 */
export function highlightLine(text: string, lang: string | null): string {
  const hljs = core;
  if (!hljs || !lang || !hljs.getLanguage(lang)) return escapeHtml(text);
  try {
    return hljs.highlight(text, { language: lang, ignoreIllegals: true }).value;
  } catch {
    return escapeHtml(text);
  }
}

/**
 * Loads the language's grammar on first use and re-renders once it resolves; a module-level cache
 * means every caller after the first gets it synchronously. A `null` language never loads anything.
 * The returned function is stable per (language, readiness), so `Code`'s `dangerouslySetInnerHTML`
 * memo is not invalidated on every render.
 */
export function useHighlighter(lang: string | null): (text: string) => string {
  const [readyFor, setReadyFor] = useState<string | null>(() => (lang && isLanguageLoaded(lang) ? lang : null));
  useEffect(() => {
    if (!lang) { setReadyFor(null); return; }
    if (isLanguageLoaded(lang)) { setReadyFor(lang); return; }
    setReadyFor(null);
    let alive = true;
    loadLanguage(lang).then(
      () => { if (alive) setReadyFor(lang); },
      () => { if (alive) setReadyFor(null); },
    );
    return () => { alive = false; };
  }, [lang]);
  const ready = lang !== null && readyFor === lang;
  return useMemo(() => (text: string) => highlightLine(text, ready ? lang : null), [lang, ready]);
}