import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  V2_THEME_MARKERS, V2_THEME_TOKEN_NAMES, V2_BASE_TOKEN_NAMES, V2_STATUS_TONE_NAMES, WEAVE_PLUGIN_CLASS, WEAVE_PLUGIN_TABLE_CELL, generateV2PluginCss,
} from './v2-theme.js';
import { extractCssBlock, parseCssCustomProperties } from './parse.js';

// Not an import — a plain fs read of the app's own token source, so this test can compare the two
// without packages/core depending on packages/ui (scripts/guard-boundaries.mjs only inspects
// `from '...'` import specifiers, not fs paths). This is also what `generateV2PluginCss` itself is
// fed at daemon startup (VS-385 design.md Decision 3), just resolved repo-relative there instead.
// VS-457 merged V1's stylesheet and V2's delta into this one file.
const APP_CSS = readFileSync(fileURLToPath(new URL('../../../ui/src/index.css', import.meta.url)), 'utf8');

describe('generateV2PluginCss (VS-385 design.md Decision 3) — no-divergence', () => {
  const generated = generateV2PluginCss(APP_CSS);
  const appDark = parseCssCustomProperties(extractCssBlock(APP_CSS, V2_THEME_MARKERS.dark));
  const appLight = parseCssCustomProperties(extractCssBlock(APP_CSS, V2_THEME_MARKERS.light));
  const appBase = parseCssCustomProperties(extractCssBlock(APP_CSS, V2_THEME_MARKERS.baseTokens));
  const genDark = parseCssCustomProperties(extractCssBlock(generated, "[data-theme='dark'] {"));
  const genLight = parseCssCustomProperties(extractCssBlock(generated, "[data-theme='light'] {"));
  const genBase = parseCssCustomProperties(extractCssBlock(generated, ':root {'));

  it('every token the generated stylesheet ships matches the app dark value exactly', () => {
    for (const name of V2_THEME_TOKEN_NAMES) {
      expect(genDark[name], `${name} (dark)`).toBe(appDark[name]);
    }
  });

  it('every token the generated stylesheet ships matches the app light value exactly', () => {
    for (const name of V2_THEME_TOKEN_NAMES) {
      expect(genLight[name], `${name} (light)`).toBe(appLight[name]);
    }
  });

  it('every type/scale token the generated stylesheet ships matches index.css\'s value exactly', () => {
    for (const name of V2_BASE_TOKEN_NAMES) {
      expect(genBase[name], name).toBe(appBase[name]);
    }
  });

  it('demonstrates the check actually discriminates: a mutated app value produces different output', () => {
    expect(appDark['--accent']).toBeTruthy();
    const mutated = APP_CSS.replace(appDark['--accent'] as string, '#not-the-real-value');
    expect(mutated).not.toBe(APP_CSS);
    const mutatedGenerated = generateV2PluginCss(mutated);
    const mutatedDark = parseCssCustomProperties(extractCssBlock(mutatedGenerated, "[data-theme='dark'] {"));
    expect(mutatedDark['--accent']).not.toBe(genDark['--accent']);
  });

  it('demonstrates the base-token check discriminates too: a mutated index.css value produces different output', () => {
    expect(appBase['--ff-ui']).toBeTruthy();
    const mutated = APP_CSS.replace(appBase['--ff-ui'] as string, "'NotTheRealFont'");
    expect(mutated).not.toBe(APP_CSS);
    const mutatedGenerated = generateV2PluginCss(mutated);
    const mutatedBase = parseCssCustomProperties(extractCssBlock(mutatedGenerated, ':root {'));
    expect(mutatedBase['--ff-ui']).not.toBe(genBase['--ff-ui']);
  });
});

describe('generateV2PluginCss — completeness', () => {
  const generated = generateV2PluginCss(APP_CSS);

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

  it('emits the link recipe at a bare <a> and the link class, carrying the app\'s own token (VS-458)', () => {
    expect(generated).toMatch(/a,\s*a\.v2-link\s*\{[^}]*color:\s*var\(--accent-link\)/);
    expect(generated).toMatch(/a:hover,\s*a\.v2-link:hover\s*\{[^}]*color:\s*var\(--accent-hover\)/);
  });

  it('emits the table actions-cell rule (VS-458)', () => {
    expect(generated).toMatch(/\.v2-table \[data-cell='actions'\]\s*\{/);
  });

  it('every WEAVE_PLUGIN_TABLE_CELL role has a matching rule', () => {
    for (const role of Object.values(WEAVE_PLUGIN_TABLE_CELL)) {
      expect(generated, role).toMatch(new RegExp(`\\[data-cell='${role}'\\]`));
    }
  });

  it('fails if the link rule is missing entirely from the source (proves the link check bites)', () => {
    const withoutLink = APP_CSS.replace(/a\.v2-link\b/g, 'a.v2-link-renamed');
    expect(() => generateV2PluginCss(withoutLink)).toThrow(/no a\.v2-link rule found/);
  });

  it('fails if a component class is missing entirely from the source (proves the completeness check bites)', () => {
    const withoutTable = APP_CSS.replace(/\.v2-table\b/g, '.v2-table-renamed');
    expect(() => generateV2PluginCss(withoutTable)).toThrow(/no rule found for prefix: \.v2-table/);
  });

  it('defines both [data-theme] roots and a plain base rule', () => {
    expect(generated).toMatch(/\[data-theme='dark'\]/);
    expect(generated).toMatch(/\[data-theme='light'\]/);
    expect(generated).toMatch(/:root, body \{/);
  });

  it('sets a non-default font-family on the root, resolved through a token the same output defines', () => {
    const genBase = parseCssCustomProperties(extractCssBlock(generated, ':root {'));
    const appBase = parseCssCustomProperties(extractCssBlock(APP_CSS, V2_THEME_MARKERS.baseTokens));
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

describe('generateV2PluginCss — VS-465 (plugin pages: section spacing and [hidden])', () => {
  const generated = generateV2PluginCss(APP_CSS);

  it('makes the standard hidden attribute win over the vocabulary\'s own display recipes', () => {
    expect(generated).toMatch(/\[hidden\]\s*\{\s*display:\s*none\s*!important;?\s*\}/);
    // The vocabulary's own recipes (`.v2-form-row { display: flex }`, …) are extracted verbatim
    // from index.css and are never `!important`, so this rule wins the cascade on every one of them.
    expect(generated).not.toMatch(/\.v2-(?:form-row|button|input|card|table|tag)[^{}]*\{[^{}]*display:[^{};]*!important/);
  });

  it('gives adjacent top-level sections the design\'s own spacing token, not a literal', () => {
    expect(generated).toMatch(/body\s*>\s*\*\s*\+\s*\*\s*\{\s*margin-top:\s*var\(--space-6\)\s*;?\s*\}/);
    // The rule only works because the generated base-token `:root` defines the token it names.
    const genBase = parseCssCustomProperties(extractCssBlock(generated, ':root {'));
    expect(genBase['--space-6']).toMatch(/^[\d.]+rem$/);
    expect(genBase['--space-6']).not.toBe('0rem');
  });
});

describe('generateV2PluginCss — VS-468 (a shrinking metadata cell, a row panel, grouped actions)', () => {
  const generated = generateV2PluginCss(APP_CSS);

  /** The declaration block of the rule whose selector text is `selector`, or a thrown error. */
  function ruleBody(selector: string): string {
    const found = new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`).exec(generated);
    if (!found) throw new Error(`no rule for ${selector}`);
    return found[1]!;
  }

  it('lets the metadata cell shrink and truncate after primary keeps a minimum', () => {
    const secondary = ruleBody(".v2-table [data-cell='secondary']");
    expect(secondary).toMatch(/flex:\s*0 1 auto/);
    expect(secondary).toMatch(/min-width:\s*0\b/);
    expect(secondary).toMatch(/overflow:\s*hidden/);
    expect(secondary).toMatch(/text-overflow:\s*ellipsis/);
    expect(secondary).toMatch(/white-space:\s*nowrap/);
    // Its muted mono look is unchanged.
    expect(secondary).toMatch(/font-family:\s*var\(--ff-mono\)/);
    expect(secondary).toMatch(/color:\s*var\(--text-3\)/);

    const primary = ruleBody(".v2-table [data-cell='primary']");
    expect(primary).toMatch(/min-width:\s*var\(--space-9\)/);
  });

  it('emits the row-panel rule (VS-468)', () => {
    const panel = ruleBody('.v2-table-panel');
    expect(panel).toMatch(/border-top:\s*1px solid var\(--line-1\)/);
  });

  it('divides any table child from its predecessor, so a row after a panel is not left flush', () => {
    expect(generated).toMatch(/\.v2-table > \* \+ \* \{[^}]*border-top:\s*1px solid var\(--line-1\)/);
  });

  it('hardens the actions cell into a non-wrapping, non-shrinking right-aligned group', () => {
    const actions = ruleBody(".v2-table [data-cell='actions']");
    expect(actions).toMatch(/flex-wrap:\s*nowrap/);
    expect(actions).toMatch(/gap:\s*var\(--space-3\)/);
    expect(actions).toMatch(/margin-left:\s*auto/);
    expect(ruleBody(".v2-table [data-cell='actions'] .v2-button")).toMatch(/flex:\s*0 0 auto/);
  });
});

it('generateV2PluginCss output has no <script> tag and no non-data: external reference', () => {
  const generated = generateV2PluginCss(APP_CSS);
  expect(generated).not.toMatch(/<script/i);
  expect(generated).not.toMatch(/@import/i);
  expect(generated).not.toMatch(/url\(\s*['"]?(?!data:)/i);
});
