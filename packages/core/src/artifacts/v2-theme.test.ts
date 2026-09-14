import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  V2_THEME_MARKERS, V2_THEME_TOKEN_NAMES, V2_BASE_TOKEN_NAMES, V2_STATUS_TONE_NAMES, WEAVE_PLUGIN_CLASS, generateV2PluginCss,
} from './v2-theme.js';
import { extractCssBlock, parseCssCustomProperties } from './parse.js';

// Not an import — a plain fs read of the app's own token source, so this test can compare the two
// without packages/core depending on packages/ui (scripts/guard-boundaries.mjs only inspects
// `from '...'` import specifiers, not fs paths). This is also what `generateV2PluginCss` itself is
// fed at daemon startup (VS-385 design.md Decision 3), just resolved repo-relative there instead.
const V2_CSS = readFileSync(fileURLToPath(new URL('../../../ui/src/v2/v2.css', import.meta.url)), 'utf8');
const INDEX_CSS = readFileSync(fileURLToPath(new URL('../../../ui/src/index.css', import.meta.url)), 'utf8');

describe('generateV2PluginCss (VS-385 design.md Decision 3) — no-divergence', () => {
  const generated = generateV2PluginCss(V2_CSS, INDEX_CSS);
  const appDark = parseCssCustomProperties(extractCssBlock(V2_CSS, V2_THEME_MARKERS.dark));
  const appLight = parseCssCustomProperties(extractCssBlock(V2_CSS, V2_THEME_MARKERS.light));
  const appBase = parseCssCustomProperties(extractCssBlock(INDEX_CSS, V2_THEME_MARKERS.baseTokens));
  const genDark = parseCssCustomProperties(extractCssBlock(generated, "[data-theme='dark'] {"));
  const genLight = parseCssCustomProperties(extractCssBlock(generated, "[data-theme='light'] {"));
  const genBase = parseCssCustomProperties(extractCssBlock(generated, ':root {'));

  it('every token the generated stylesheet ships matches v2.css\'s dark value exactly', () => {
    for (const name of V2_THEME_TOKEN_NAMES) {
      expect(genDark[name], `${name} (dark)`).toBe(appDark[name]);
    }
  });

  it('every token the generated stylesheet ships matches v2.css\'s light value exactly', () => {
    for (const name of V2_THEME_TOKEN_NAMES) {
      expect(genLight[name], `${name} (light)`).toBe(appLight[name]);
    }
  });

  it('every type/scale token the generated stylesheet ships matches index.css\'s value exactly', () => {
    for (const name of V2_BASE_TOKEN_NAMES) {
      expect(genBase[name], name).toBe(appBase[name]);
    }
  });

  it('demonstrates the check actually discriminates: a mutated v2.css value produces different output', () => {
    expect(appDark['--accent']).toBeTruthy();
    const mutated = V2_CSS.replace(appDark['--accent'] as string, '#not-the-real-value');
    expect(mutated).not.toBe(V2_CSS);
    const mutatedGenerated = generateV2PluginCss(mutated, INDEX_CSS);
    const mutatedDark = parseCssCustomProperties(extractCssBlock(mutatedGenerated, "[data-theme='dark'] {"));
    expect(mutatedDark['--accent']).not.toBe(genDark['--accent']);
  });

  it('demonstrates the base-token check discriminates too: a mutated index.css value produces different output', () => {
    expect(appBase['--ff-ui']).toBeTruthy();
    const mutated = INDEX_CSS.replace(appBase['--ff-ui'] as string, "'NotTheRealFont'");
    expect(mutated).not.toBe(INDEX_CSS);
    const mutatedGenerated = generateV2PluginCss(V2_CSS, mutated);
    const mutatedBase = parseCssCustomProperties(extractCssBlock(mutatedGenerated, ':root {'));
    expect(mutatedBase['--ff-ui']).not.toBe(genBase['--ff-ui']);
  });
});

describe('generateV2PluginCss — completeness', () => {
  const generated = generateV2PluginCss(V2_CSS, INDEX_CSS);

  it('every WEAVE_PLUGIN_CLASS value has at least one matching rule', () => {
    for (const className of Object.values(WEAVE_PLUGIN_CLASS)) {
      expect(generated, className).toMatch(new RegExp(`\\.${className}\\s*\\{`));
    }
  });

  it('every status token has a matching [data-tone] rule', () => {
    for (const tone of V2_STATUS_TONE_NAMES) {
      expect(generated, tone).toMatch(new RegExp(`\\[data-tone='${tone}'\\]`));
    }
  });

  it('fails if a component class is missing entirely from the source (proves the completeness check bites)', () => {
    const withoutTable = V2_CSS.replace(/\.v2-table\b/g, '.v2-table-renamed');
    expect(() => generateV2PluginCss(withoutTable, INDEX_CSS)).toThrow(/no rule found for prefix: \.v2-table/);
  });

  it('defines both [data-theme] roots and a plain base rule', () => {
    expect(generated).toMatch(/\[data-theme='dark'\]/);
    expect(generated).toMatch(/\[data-theme='light'\]/);
    expect(generated).toMatch(/:root, body \{/);
  });

  it('sets a non-default font-family on the root, resolved through a token the same output defines', () => {
    const genBase = parseCssCustomProperties(extractCssBlock(generated, ':root {'));
    const appBase = parseCssCustomProperties(extractCssBlock(INDEX_CSS, V2_THEME_MARKERS.baseTokens));
    expect(genBase['--ff-ui']).toBeTruthy();
    expect(genBase['--ff-ui']).toBe(appBase['--ff-ui']);
    expect(genBase['--ff-ui']).not.toMatch(/^serif\b|,\s*serif\b/i);
    expect(generated).toMatch(/:root, body\s*\{[^}]*font-family:\s*var\(--ff-ui\)/);
  });

  it('resets box-sizing and makes form controls inherit the page font (the preflight a plugin page has no bundler for)', () => {
    expect(generated).toMatch(/\*,\s*\*::before,\s*\*::after\s*\{\s*box-sizing:\s*border-box;\s*\}/);
    expect(generated).toMatch(/button,\s*input,\s*select,\s*textarea\s*\{[^}]*font-family:\s*inherit/);
  });
});

it('generateV2PluginCss output has no <script> tag and no non-data: external reference', () => {
  const generated = generateV2PluginCss(V2_CSS, INDEX_CSS);
  expect(generated).not.toMatch(/<script/i);
  expect(generated).not.toMatch(/@import/i);
  expect(generated).not.toMatch(/url\(\s*['"]?(?!data:)/i);
});
