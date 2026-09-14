/** The V2 theme: the Mono contrast rule in the token sheet, and the choice's own storage key. */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readV2Theme, writeV2Theme } from '../v2/theme';

const css = readFileSync(resolve(process.cwd(), 'src/v2/v2.css'), 'utf8');

/** The declaration block that starts at `selector`, up to its closing brace. */
function block(selector: string): string {
  const start = css.indexOf(selector);
  if (start < 0) throw new Error(`no selector ${selector}`);
  return css.slice(start, css.indexOf('}', start));
}

function token(selector: string, name: string): string | undefined {
  return new RegExp(`${name}\\s*:\\s*([^;]+);`).exec(block(selector))?.[1]?.trim();
}

describe('the Mono token set', () => {
  it('collapses --text-4 into --text-3 in both themes (HANDOFF §2)', () => {
    for (const selector of ['.v2-root {\n  /* Dark', ".v2-root[data-theme='light']"]) {
      const three = token(selector, '--text-3');
      const four = token(selector, '--text-4');
      expect(three).toBeDefined();
      expect(four).toBe(three);
    }
  });

  it('keeps the near-black dark ground the design names', () => {
    expect(token('.v2-root {\n  /* Dark', '--bg-0')).toBe('#050506');
    expect(token('.v2-root {\n  /* Dark', '--bg-1')).toBe('#0b0b0d');
    expect(token('.v2-root {\n  /* Dark', '--bg-2')).toBe('#101012');
  });

  it('scopes every selector to the V2 root, so nothing can leak into V1', () => {
    const selectors = css
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/@keyframes[\s\S]*?}\s*}/g, '')
      .match(/[^{}]+\{/g)
      ?.map((s) => s.slice(0, -1).trim())
      .filter((s) => s.length > 0 && !s.startsWith('from') && !s.startsWith('to'));
    expect(selectors?.length).toBeGreaterThan(0);
    for (const selector of selectors ?? []) {
      for (const part of selector.split(',')) {
        // `.v2-root …` for token/utility scoping, `.v2-*` for the V2 primitives; V1 has neither.
        expect(part.trim().startsWith('.v2-')).toBe(true);
      }
    }
  });
});

describe('the V2 theme choice', () => {
  afterEach(() => localStorage.clear());

  it('round-trips under its own key', () => {
    writeV2Theme('light');
    expect(readV2Theme()).toBe('light');
    expect(localStorage.getItem('conductor.theme')).toBeNull();
  });
});

/**
 * The values `themeVars()` in Weave.dc.html writes over the design's base block. The base block's
 * indigo accent, green done and purple merging are exactly what Mono replaces, so pinning these
 * stops a later edit falling back to them (VS-343 review).
 */
describe('the Mono palette', () => {
  const dark = '.v2-root {\n  /* Dark';
  const light = ".v2-root[data-theme='light']";

  it('keeps the accent and the link greyscale in both themes', () => {
    expect(token(dark, '--accent')).toBe('#3d4148');
    expect(token(dark, '--accent-link')).toBe('#c6cad1');
    expect(token(light, '--accent')).toBe('#3d4148');
    expect(token(light, '--accent-link')).toBe('#3d4148');
  });

  it('derives the accent tints from the grey, not the indigo', () => {
    expect(token(dark, '--accent-tint')).toBe('rgb(61 65 72 / 0.13)');
    expect(token(dark, '--accent-edge')).toBe('rgb(61 65 72 / 0.34)');
    expect(token(light, '--accent-tint')).toBe('rgb(61 65 72 / 0.09)');
    expect(token(light, '--focus-ring')).toBe('rgb(61 65 72 / 0.18)');
  });

  it('keeps done and merging greyscale, not green and purple', () => {
    expect(token(dark, '--status-done')).toBe('#7c828b');
    expect(token(dark, '--status-merging')).toBe('#8a8f98');
    expect(token(light, '--status-done')).toBe('#565a61');
    expect(token(light, '--status-merging')).toBe('#4e535b');
  });

  it('gives diffs their own green/red tints, not the greyscale done (VS-419)', () => {
    for (const selector of [dark, light]) {
      const add = token(selector, '--diff-add-bg');
      const remove = token(selector, '--diff-remove-bg');
      expect(add).toBeDefined();
      expect(remove).toBeDefined();
      expect(add).not.toContain('--status');
      expect(remove).not.toContain('--status');
      expect(add).not.toBe(remove);
    }
    expect(token(dark, '--diff-add-bg')).not.toBe(token(dark, '--status-done'));
    expect(token(light, '--diff-remove-bg')).not.toBe(token(light, '--status-done'));
  });

  it('gives the dark Approve a near-white ready fill and a grey blocked one (VS-422)', () => {
    expect(token(dark, '--approve')).toBe('#f2f3f5');
    expect(token(dark, '--approve-ink')).toBe('#0b0b0d');
    const blocked = token(dark, '--approve-blocked');
    expect(blocked).toBeDefined();
    expect(blocked).not.toBe(token(dark, '--approve'));
    expect(token(dark, '--approve-blocked-ink')).toBeDefined();
  });

  it('leaves the light Approve and the clean-review green unchanged (VS-422)', () => {
    expect(token(light, '--approve')).toBe('#15803d');
    expect(token(light, '--approve-ink')).toBe('#ffffff');
    expect(token(dark, '--review-clean')).toBe('#34d399');
    expect(token(light, '--review-clean')).toBe('#15803d');
  });

  it('keeps hue only on working, needs-you and blocked', () => {
    expect(token(dark, '--status-working')).toBe('#e9a23b');
    expect(token(dark, '--status-needs-you')).toBe('#7c87f0');
    expect(token(dark, '--status-blocked')).toBe('#ff6b4a');
    expect(token(light, '--status-working')).toBe('#8a5e14');
    expect(token(light, '--status-needs-you')).toBe('#4a55c4');
    expect(token(light, '--status-blocked')).toBe('#c93a17');
  });
});

