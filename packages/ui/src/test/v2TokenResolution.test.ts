/**
 * VS-386: a Tailwind utility built on the `@theme` mapping reads its value at `:root`, so the scoped
 * `.v2-root[data-theme]` overrides never reached `text-text-1` / `text-text-strong` and V2's dark
 * primary titles resolved to the light ink (invisible on the dark ground) whenever `<html>` was
 * light. `@theme inline` makes Tailwind emit the token `var()` directly into the utility class,
 * one level, which re-resolves against `.v2-root` per element.
 *
 * Pinned at the source because jsdom does not resolve custom properties (see web-app-testing.md);
 * the real resolution was confirmed against Chromium in the ticket's rendered check.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8');

describe('V2 token utility resolution', () => {
  it('maps the Mono tokens through an inline @theme, so utilities re-resolve per element', () => {
    expect(css).toMatch(/@theme\s+inline\s*\{/);
    expect(css).not.toMatch(/@theme\s*\{/);
  });
});
