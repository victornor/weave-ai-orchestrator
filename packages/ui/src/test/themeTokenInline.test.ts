/**
 * `@theme { --color-bg-1: var(--bg-1); }` (non-inline) computes its own value once, on `:root`, and
 * that computed value — not a live `var()` reference — is what every descendant inherits. A scoped
 * override of `--bg-1` under `.v2-root[data-theme='light']` never reaches a Tailwind utility class
 * built on `--color-bg-1`: this was VS-367, most of V2 staying on V1's dark tokens in light mode.
 * `@theme inline` makes Tailwind emit `var(--bg-1)` straight into the utility class, one level of
 * `var()`, which does re-resolve per element. Confirmed against a real Chromium render, not jsdom
 * (which does not resolve custom properties at all — see web-app-testing.md).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8');

describe('the Tailwind v4 theme mapping', () => {
  it('is declared inline, so utilities reference --bg-*/--text-*/--line-* directly', () => {
    expect(css).toMatch(/@theme\s+inline\s*\{/);
  });
});
