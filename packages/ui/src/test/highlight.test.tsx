/**
 * `lib/highlight.ts` (ADR 0013; VS-445): the extension/file-name table, plain-text escaping before a
 * grammar has loaded or when none is recognised, lazy per-language registration, and the real
 * `highlight.js` output once a grammar is in. The languages captain named for VS-445 (TypeScript,
 * Python, Go, C#, YAML, shell) are exercised here alongside the originals.
 */
import { render, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { highlightLine, isLanguageLoaded, languageForPath, loadLanguage, useHighlighter } from '../lib/highlight';

describe('languageForPath', () => {
  it.each([
    ['src/index.ts', 'typescript'], ['src/App.tsx', 'typescript'], ['src/a.mts', 'typescript'],
    ['src/index.js', 'javascript'], ['src/App.jsx', 'javascript'], ['src/a.cjs', 'javascript'],
    ['script.py', 'python'], ['main.go', 'go'], ['lib.rs', 'rust'], ['main.cs', 'csharp'],
    ['Main.java', 'java'], ['Main.kt', 'kotlin'], ['App.swift', 'swift'], ['app.rb', 'ruby'],
    ['index.php', 'php'], ['main.c', 'c'], ['header.h', 'c'], ['main.cpp', 'cpp'], ['x.hpp', 'cpp'],
    ['Main.scala', 'scala'], ['main.dart', 'dart'], ['x.lua', 'lua'], ['schema.sql', 'sql'],
    ['run.sh', 'bash'], ['run.zsh', 'bash'], ['run.fish', 'bash'], ['run.ps1', 'powershell'],
    ['config.yaml', 'yaml'], ['config.yml', 'yaml'], ['Cargo.toml', 'ini'], ['setup.ini', 'ini'],
    ['package.json', 'json'], ['tsconfig.jsonc', 'json'], ['pom.xml', 'xml'], ['page.html', 'xml'],
    ['index.css', 'css'], ['app.scss', 'scss'], ['app.less', 'less'], ['README.md', 'markdown'],
    ['schema.graphql', 'graphql'], ['api.proto', 'protobuf'], ['change.diff', 'diff'],
    ['nginx.conf', 'nginx'],
    ['image.png', null], ['no-extension', null], ['archive.tar.gz', null],
    // highlight.js ships no HCL/Terraform grammar, so these stay plain text rather than guessing.
    ['main.tf', null], ['vars.hcl', null],
  ] as const)('%s -> %s', (path, expected) => {
    expect(languageForPath(path)).toBe(expected);
  });

  it('matches well-known file names with no usable extension', () => {
    for (const [path, lang] of [
      ['Dockerfile', 'dockerfile'], ['deploy/Dockerfile', 'dockerfile'], ['app.dockerfile', 'dockerfile'],
      ['Makefile', 'makefile'], ['GNUmakefile', 'makefile'], ['rules.mk', 'makefile'],
      ['.env', 'ini'], ['.env.local', 'ini'], ['.bashrc', 'bash'], ['.zshrc', 'bash'],
    ] as const) {
      expect(languageForPath(path)).toBe(lang);
    }
  });
});

describe('highlightLine before a grammar is ready', () => {
  it('escapes the text when no language is given', () => {
    expect(highlightLine('a < b', null)).toBe('a &lt; b');
  });

  it('escapes the text when the language is not recognised', () => {
    expect(highlightLine('a & b', 'cobol')).toBe('a &amp; b');
  });

  it('escapes a recognised language whose grammar has not loaded yet', () => {
    expect(isLanguageLoaded('r')).toBe(false);
    expect(highlightLine('x <- 1', 'r')).toBe('x &lt;- 1');
  });
});

describe('lazy grammars', () => {
  it('registers a grammar on first use only, then the line gains hljs- spans', async () => {
    expect(isLanguageLoaded('perl')).toBe(false);
    expect(highlightLine('my $x = 1;', 'perl')).toBe('my $x = 1;');
    await loadLanguage('perl');
    expect(isLanguageLoaded('perl')).toBe(true);
    expect(highlightLine('my $x = 1;', 'perl')).toContain('hljs-');
  });

  it('a second load for the same language resolves without re-registering', async () => {
    await expect(loadLanguage('perl')).resolves.toBeUndefined();
  });

  it.each([
    'typescript', 'javascript', 'python', 'go', 'rust', 'csharp', 'java', 'kotlin', 'swift',
    'ruby', 'php', 'cpp', 'xml', 'yaml', 'bash', 'powershell', 'scala', 'dart', 'lua', 'sql',
    'json', 'scss', 'markdown', 'graphql', 'protobuf', 'diff', 'dockerfile',
  ] as const)('tokenizes %s without throwing, reconstructing the same text', async (lang) => {
    await loadLanguage(lang);
    const line = FIXTURE_LINES[lang] ?? 'const x = 1; // note';
    const html = highlightLine(line, lang);
    expect(html).toContain('hljs-');
    // Stripping tags and un-escaping entities recovers the original text: nothing was dropped.
    const plain = html.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"');
    expect(plain).toBe(line);
  });

  it('highlights a C# line with its keyword and string', async () => {
    await loadLanguage('csharp');
    const html = highlightLine('var s = "hi";', 'csharp');
    expect(html).toContain('hljs-keyword');
    expect(html).toContain('hljs-string');
  });

  it('has a bundled grammar for every language the path table can name', async () => {
    // A missing loader makes `loadLanguage` reject rather than silently rendering plain text.
    const names = [
      'typescript', 'javascript', 'python', 'go', 'rust', 'csharp', 'java', 'kotlin', 'swift',
      'ruby', 'php', 'c', 'cpp', 'scala', 'dart', 'lua', 'perl', 'r', 'vbnet', 'vbscript', 'sql',
      'bash', 'powershell', 'yaml', 'ini', 'json', 'xml', 'css', 'scss', 'less', 'markdown',
      'graphql', 'protobuf', 'dockerfile', 'makefile', 'nginx', 'diff',
    ];
    for (const name of names) await expect(loadLanguage(name)).resolves.toBeUndefined();
  });
});

const FIXTURE_LINES: Partial<Record<string, string>> = {
  xml: '<div class="a">hi</div>',
  go: 'const x = 1 // note',
  python: 'import os  # note',
  ruby: 'x = 1 # note',
  kotlin: 'val x = 1 // note',
  swift: 'let x = 1 // note',
  yaml: 'name: value # note',
  bash: 'echo "hi" # note',
  dockerfile: 'FROM node:20',
  diff: '+added line',
  sql: 'SELECT * FROM t; -- note',
  json: '{"a": 1}',
  markdown: '# Title',
};

function Probe(): React.ReactElement {
  const highlight = useHighlighter('ruby');
  return <span data-testid="probe" dangerouslySetInnerHTML={{ __html: highlight('x = 1 # note') }} />;
}

describe('useHighlighter', () => {
  it('re-renders with hljs spans once the grammar lands', async () => {
    const { getByTestId } = render(<Probe />);
    await waitFor(() => expect(getByTestId('probe').querySelector('[class*="hljs-"]')).not.toBeNull());
  });

  it('escapes immediately for an unknown language, loading nothing', () => {
    function Unknown(): React.ReactElement {
      const highlight = useHighlighter(null);
      return <span data-testid="unknown" dangerouslySetInnerHTML={{ __html: highlight('a < b') }} />;
    }
    const { getByTestId } = render(<Unknown />);
    expect(getByTestId('unknown').textContent).toBe('a < b');
  });
});