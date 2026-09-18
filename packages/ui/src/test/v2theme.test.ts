/** The V2 theme: the Mono palette that is now the only palette, and the theme choice's storage key. */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readV2Theme, writeV2Theme } from '../v2/theme';

// VS-457: V1's stylesheet and V2's delta were merged into one file, and V2's Mono values are the
// only defaults now — there is no `.v2-root` token scope left to read.
const css = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8');

/** The declaration block that starts at `selector`, up to its closing brace. */
function block(selector: string): string {
  const start = css.indexOf(selector);
  if (start < 0) throw new Error(`no selector ${selector}`);
  return css.slice(start, css.indexOf('}', start));
}

function token(selector: string, name: string): string | undefined {
  return new RegExp(`${name}\\s*:\\s*([^;]+);`).exec(block(selector))?.[1]?.trim();
}

/** Hex → channels, for the same-hue and contrast checks below (VS-551). */
function channels(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** How far apart the strongest and weakest channels are: 0 is grey, 255 is fully saturated. */
function chroma(hex: string): number {
  const [r, g, b] = channels(hex);
  return Math.max(r, g, b) - Math.min(r, g, b);
}

/** HSL hue in degrees; only meaningful for a colour with some chroma. */
function hue(hex: string): number {
  const [r, g, b] = channels(hex);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  if (d === 0) return 0;
  let h: number;
  if (max === r) h = (60 * ((g - b) / d) + 360) % 360;
  else if (max === g) h = 60 * ((b - r) / d) + 120;
  else h = 60 * ((r - g) / d) + 240;
  return h;
}

function relativeLuminance(hex: string): number {
  return channels(hex)
    .map((v) => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    })
    .reduce((acc, c, i) => acc + c * [0.2126, 0.7152, 0.0722][i]!, 0);
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

function hueGap(a: string, b: string): number {
  const d = Math.abs(hue(a) - hue(b));
  return Math.min(d, 360 - d);
}

describe('the Mono token set', () => {
  it('collapses --text-4 into --text-3 in both themes (HANDOFF §2)', () => {
    for (const selector of ['[data-theme=\'dark\']', "[data-theme='light']"]) {
      const three = token(selector, '--text-3');
      const four = token(selector, '--text-4');
      expect(three).toBeDefined();
      expect(four).toBe(three);
    }
  });

  it('keeps the near-black dark ground the design names', () => {
    expect(token("[data-theme='dark']", '--bg-0')).toBe('#050506');
    expect(token("[data-theme='dark']", '--bg-1')).toBe('#0b0b0d');
    expect(token("[data-theme='dark']", '--bg-2')).toBe('#101012');
  });

  it('keeps `.v2-root` unscoped apart from the paint rule and the text-size scale (VS-551)', () => {
    const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
    // `.v2-root` scopes no component rule: no descendant (`.v2-root .x`), pseudo (`.v2-root:x`) or
    // class (`.v2-root.x`) selector, and no token scope. It keeps exactly its own paint rule — the
    // ground, ink and base typography (VS-482) — and the text-size attribute rules VS-551 adds.
    expect(withoutComments).not.toMatch(/\.v2-root[.:]/);
    const attrs = [...withoutComments.matchAll(/\.v2-root\[([^\]]+)\]/g)].map((m) => m[1]);
    expect(attrs.length).toBeGreaterThan(0);
    for (const attr of attrs) expect(attr).toMatch(/^data-text-size=/);
    const paintStart = withoutComments.indexOf('.v2-root');
    const paint = withoutComments.slice(paintStart, withoutComments.indexOf('}', paintStart));
    expect(paint).not.toMatch(/--[a-z0-9-]+\s*:/);
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
  const dark = "[data-theme='dark'] {";
  const light = "[data-theme='light'] {";

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

  it('makes Approve an inverse pair with no hue and ink that contrasts (VS-551)', () => {
    const darkFill = token(dark, '--approve')!;
    const darkInk = token(dark, '--approve-ink')!;
    const lightFill = token(light, '--approve')!;
    const lightInk = token(light, '--approve-ink')!;
    // dark: near-white fill under dark ink; light: a dark fill under white ink — the inverse pair.
    expect(relativeLuminance(darkFill)).toBeGreaterThan(0.5);
    expect(relativeLuminance(lightFill)).toBeLessThan(0.2);
    expect(relativeLuminance(darkInk)).toBeLessThan(0.1);
    expect(relativeLuminance(lightInk)).toBeGreaterThan(0.9);
    // The control carries no hue in either theme.
    expect(chroma(darkFill)).toBeLessThanOrEqual(10);
    expect(chroma(lightFill)).toBeLessThanOrEqual(20);
    // Each fill's own ink clears contrast.
    expect(contrast(darkInk, darkFill)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(lightInk, lightFill)).toBeGreaterThanOrEqual(4.5);
  });

  it('gives a blocked Approve the same muted recipe in both themes (VS-422, VS-551)', () => {
    for (const selector of [dark, light]) {
      const blocked = token(selector, '--approve-blocked')!;
      const ink = token(selector, '--approve-blocked-ink')!;
      expect(blocked).toBeDefined();
      expect(blocked).not.toBe(token(selector, '--approve'));
      expect(contrast(ink, blocked)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('keeps the clean-review green one hue at each theme’s lightness (VS-551)', () => {
    const darkGreen = token(dark, '--review-clean')!;
    const lightGreen = token(light, '--review-clean')!;
    expect(hueGap(darkGreen, lightGreen)).toBeLessThanOrEqual(3);
    expect(contrast(darkGreen, '#0b0b0d')).toBeGreaterThanOrEqual(4.5);
    expect(contrast(lightGreen, '#ffffff')).toBeGreaterThanOrEqual(4.5);
  });

  it('keeps every status, diff and project colour on one hue across themes (VS-551)', () => {
    const names = [
      '--status-idle', '--status-working', '--status-stalled', '--status-blocked', '--status-needs-you',
      '--status-merging', '--status-done', '--status-failed', '--status-paused',
      '--diff-add-fg', '--diff-remove-fg',
      '--project-1', '--project-2', '--project-3', '--project-4', '--project-5',
    ];
    for (const name of names) {
      const d = token(dark, name);
      const l = token(light, name);
      expect(d, name).toBeDefined();
      expect(l, name).toBeDefined();
      expect(hueGap(d!, l!), `${name} hue differs by theme`).toBeLessThanOrEqual(8);
    }
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
