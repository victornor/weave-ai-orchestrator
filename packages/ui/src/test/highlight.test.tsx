/**
 * `lib/highlight.ts` (ADR 0013): the extension table, escaping when no grammar has loaded or none is
 * recognised, and the real `highlight.js` output once loaded — covering every language ADR 0013 named
 * (C#, Rust, Java, PHP, C++, HTML, JavaScript) on top of what VS-107's own tokenizer had.
 */
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { HLJSApi } from 'highlight.js';
import { highlightLine, languageForPath, useHighlighter } from '../lib/highlight';

describe('languageForPath', () => {
  it.each([
    ['src/index.ts', 'typescript'], ['src/App.tsx', 'typescript'],
    ['src/index.js', 'javascript'], ['src/App.jsx', 'javascript'],
    ['package.json', 'json'], ['config.yaml', 'yaml'], ['README.md', 'markdown'],
    ['index.css', 'css'], ['schema.sql', 'sql'], ['run.sh', 'bash'],
    ['page.html', 'xml'], ['App.razor.cs', 'csharp'], ['main.cs', 'csharp'],
    ['lib.rs', 'rust'], ['Main.java', 'java'], ['index.php', 'php'],
    ['main.cpp', 'cpp'], ['header.h', 'cpp'],
    ['image.png', null], ['Makefile', null], ['no-extension', null],
  ] as const)('%s -> %s', (path, expected) => {
    expect(languageForPath(path)).toBe(expected);
  });

  // ADR 0013: exactly captain's list, on top of VS-107's own.
  it('covers every language captain named', () => {
    for (const [path, lang] of [['a.cs', 'csharp'], ['a.rs', 'rust'], ['a.java', 'java'], ['a.php', 'php'], ['a.cpp', 'cpp'], ['a.html', 'xml'], ['a.js', 'javascript']] as const) {
      expect(languageForPath(path)).toBe(lang);
    }
  });
});

describe('highlightLine before a grammar is ready', () => {
  it('escapes the text rather than failing, when the bundle has not loaded', () => {
    expect(highlightLine(null, '<script>', 'typescript')).toBe('&lt;script&gt;');
  });

  it('escapes the text when the language is not recognised', () => {
    const hljs = { getLanguage: () => undefined } as unknown as HLJSApi;
    expect(highlightLine(hljs, 'a & b', 'cobol')).toBe('a &amp; b');
  });

  it('escapes the text when no language is given', () => {
    expect(highlightLine(null, 'a < b', null)).toBe('a &lt; b');
  });
});

describe('highlightLine once the real grammar bundle is loaded', () => {
  it.each(['csharp', 'rust', 'java', 'php', 'cpp', 'xml', 'javascript', 'typescript'] as const)(
    'tokenizes %s without throwing, reconstructing the same text',
    async (lang) => {
      const hljs = (await import('highlight.js/lib/common')).default;
      const line = lang === 'xml' ? '<div class="a">hi</div>' : 'const x = 1; // note';
      const html = highlightLine(hljs, line, lang);
      expect(html).toContain('hljs-');
      // Stripping tags and un-escaping entities recovers the original text: nothing was dropped.
      const plain = html.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"');
      expect(plain).toBe(line);
    },
  );

  it('highlights a C# line with its keyword and string', async () => {
    const hljs = (await import('highlight.js/lib/common')).default;
    const html = highlightLine(hljs, 'var s = "hi";', 'csharp');
    expect(html).toContain('hljs-keyword');
    expect(html).toContain('hljs-string');
  });
});

function Probe(): React.ReactElement {
  const hljs = useHighlighter();
  return <span>{hljs ? 'loaded' : 'loading'}</span>;
}

describe('useHighlighter', () => {
  it('loads the grammar bundle and re-renders once it resolves', async () => {
    render(<Probe />);
    await waitFor(() => expect(screen.getByText('loaded')).toBeInTheDocument());
  });
});
