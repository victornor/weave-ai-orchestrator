/**
 * VS-445: the syntax palette must be its own ink, not the accent or status palettes — Mono greys
 * those out, which is exactly what left every code token the same colour. VS-457 merged V2's delta
 * into the one stylesheet, so there is a single pair of dark/light blocks to check.
 * Pinned at the source because jsdom does not resolve custom properties (see [[web-app-testing]]);
 * the real resolution was confirmed against Chromium in the ticket's rendered check.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8');

const TOKENS = [
  '--syntax-keyword', '--syntax-string', '--syntax-number', '--syntax-function', '--syntax-type',
  '--syntax-comment', '--syntax-attr', '--syntax-builtin', '--syntax-meta', '--syntax-punctuation',
] as const;

/** The declaration block that starts at `selector`, up to its closing brace. */
function block(selector: string): string {
  const start = css.indexOf(selector);
  if (start < 0) throw new Error(`no selector ${selector}`);
  return css.slice(start, css.indexOf('}', start));
}

function token(selector: string, name: string): string | undefined {
  return new RegExp(`${name}\\s*:\\s*([^;]+);`).exec(block(selector))?.[1]?.trim();
}

function isGrey(value: string): boolean {
  const m = /^#([0-9a-f]{6})$/i.exec(value.trim());
  if (!m) return true;
  const n = parseInt(m[1]!, 16);
  return ((n >> 16) & 255) === ((n >> 8) & 255) && ((n >> 8) & 255) === (n & 255);
}

const DARK = "[data-theme='dark'] {";
const LIGHT = "[data-theme='light'] {";

describe('the syntax palette', () => {
  it.each([
    ['dark', DARK],
    ['light', LIGHT],
  ])('defines every token with a distinct, non-grey value in %s', (_label, selector) => {
    const values = TOKENS.map((t) => token(selector, t));
    for (const value of values) {
      expect(value).toBeDefined();
      expect(isGrey(value!)).toBe(false);
    }
    expect(new Set(values).size).toBe(TOKENS.length);
  });

  it('maps every token through the inline @theme so utilities re-resolve per element', () => {
    for (const t of TOKENS) expect(css).toContain(`--color-${t.slice(2)}: var(${t})`);
  });

  it('never borrows the accent or status palettes for a token colour', () => {
    // Every `.hljs-*` colour assignment lives under `.ac-code`; none may reference accent/status.
    const from = css.indexOf('.ac-code .hljs-keyword');
    const rules = css.slice(from, css.indexOf('.hljs-emphasis'));
    expect(from).toBeGreaterThan(-1);
    expect(rules).not.toMatch(/var\(--(accent|status)/);
    expect(rules).toContain('var(--syntax-keyword)');
    expect(rules).toContain('var(--syntax-string)');
  });
});
