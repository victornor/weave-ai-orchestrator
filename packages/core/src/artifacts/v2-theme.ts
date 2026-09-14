/**
 * Generates a plugin page's stylesheet from `packages/ui/src/v2/v2.css`'s own real text (VS-385)
 * — never a hand-kept literal. `generateV2PluginCss` is a pure function: fed `v2.css`'s current
 * source, it returns the CSS backing the small, documented, visual-value-free vocabulary
 * (`WEAVE_PLUGIN_CLASS`, `data-theme`, `data-tone`) that `@weave-ai/plugin-sdk` publishes. A
 * restyle of `v2.css` changes this function's output the next time it runs — there is no copy to
 * fall out of sync.
 */
import { WEAVE_PLUGIN_CLASS } from '@weave-ai/plugin-sdk';
import { extractCssBlock, parseCssCustomProperties } from './parse.js';
export { WEAVE_PLUGIN_CLASS };

/** Marker substrings locating each block in `v2.css`/`index.css` — the drift test uses these too. */
export const V2_THEME_MARKERS = {
  dark: ".v2-root {",
  light: ".v2-root[data-theme='light'] {",
  /** `index.css`'s plain, theme-independent `:root { ... }` block (space/radii/type/motion) — the
   *  first `:root {` in that file, before the `@media (prefers-reduced-motion)` one further down. */
  baseTokens: ':root {',
} as const;

/**
 * Theme-independent type/scale custom properties `index.css`'s plain `:root` block defines. V2
 * never redefines these under `.v2-root` — it reuses them as-is (`.v2-root`'s own base rule reads
 * `font-family: var(--ff-ui)`, not a literal) — so a standalone plugin document needs them defined
 * explicitly: without this, `var(--ff-ui)` resolves to nothing and the browser falls back to its
 * default (serif) font, and every literal `border-radius` in the vocabulary's component recipes
 * already carries its own value, but a future recipe written against `var(--r*)` would need these
 * defined too.
 */
export const V2_BASE_TOKEN_NAMES = [
  '--ff-ui', '--ff-mono',
  '--fs-display', '--fs-title', '--fs-head', '--fs-body', '--fs-ui', '--fs-meta', '--fs-micro', '--fs-nano',
  '--r4', '--r6', '--r8', '--r10',
] as const;

/** Color/status/project custom properties `v2.css`'s `.v2-root`/`.v2-root[data-theme='light']` blocks define. */
export const V2_THEME_TOKEN_NAMES = [
  '--bg-0', '--bg-1', '--bg-2', '--bg-3', '--bg-input', '--line-1', '--line-2', '--line-3',
  '--text-1', '--text-2', '--text-3', '--text-4', '--text-strong', '--text-soft', '--text-body', '--text-nav',
  '--accent', '--accent-link', '--accent-hover', '--accent-on', '--accent-tint', '--accent-tint-strong', '--accent-edge', '--focus-ring',
  '--status-idle', '--status-working', '--status-stalled', '--status-blocked', '--status-needs-you', '--status-merging', '--status-done', '--status-failed', '--status-paused',
  '--project-1', '--project-2', '--project-3', '--project-4', '--project-5',
  '--overlay', '--elev-sheet', '--elev-float',
] as const;

/** The `--status-*` tone suffixes (`idle`, `working`, …), for the generated `[data-tone]` rules. */
export const V2_STATUS_TONE_NAMES: readonly string[] = V2_THEME_TOKEN_NAMES
  .filter((n) => n.startsWith('--status-'))
  .map((n) => n.slice('--status-'.length));

/** Every component class the generated stylesheet must define at least one rule for — the completeness set. */
const COMPONENT_CLASS_PREFIXES = ['.v2-card', '.v2-tag', '.v2-button', '.v2-input', '.v2-form-row', '.v2-table'] as const;

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, ' ');
}

/** Every top-level rule (selector text + its balanced `{ ... }` body) in `css`, in source order. */
function topLevelRules(css: string): Array<{ selector: string; full: string }> {
  const rules: Array<{ selector: string; full: string }> = [];
  let i = 0;
  while (i < css.length) {
    const open = css.indexOf('{', i);
    if (open === -1) break;
    const selector = css.slice(i, open).trim();
    let depth = 0;
    let j = open;
    for (; j < css.length; j++) {
      if (css[j] === '{') depth++;
      else if (css[j] === '}') { depth--; if (depth === 0) break; }
    }
    if (selector) rules.push({ selector, full: css.slice(i, j + 1) });
    i = j + 1;
  }
  return rules;
}

/**
 * Every rule whose selector — or one comma-separated part of a compound selector — starts with
 * `prefix` as a complete selector head (not merely a matching substring, so `.v2-card` never
 * accidentally picks up a hypothetical `.v2-card-foo`), concatenated in source order. This is how a
 * component recipe spread across several rules (`.v2-button`, `.v2-button:hover`,
 * `.v2-button[data-variant='primary']`, …) is pulled out as one unit, without requiring CSS
 * nesting — every V2 selector stays flat and starts with `.v2-`, per this file's own scoping rule
 * (`packages/ui/src/test/v2theme.test.ts`).
 */
function extractRulesByPrefix(css: string, prefix: string): string {
  const boundary = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[\\s:.[])`);
  const rules = topLevelRules(stripComments(css)).filter((r) => r.selector.split(',').some((p) => boundary.test(p.trim())));
  if (rules.length === 0) throw new Error(`extractRulesByPrefix: no rule found for prefix: ${prefix}`);
  return rules.map((r) => r.full).join('\n');
}

/**
 * Builds a plugin page's stylesheet from `v2.css`'s and `index.css`'s real current text: the
 * theme-independent type/scale tokens (`--ff-*`/`--fs-*`/`--r*`) `v2.css` itself only references,
 * the dark/light token blocks (re-rooted for a standalone document, since a plugin page has no
 * `.v2-root` wrapper of its own), the plain base rule (page chrome — background/color/font), the
 * six shared component classes verbatim (every rule belonging to each, not just its first), and one
 * generated `[data-tone]` colour rule per status token (`.v2-tag` relies on a Tailwind colour
 * utility class for tone, which a plugin's static page has none of).
 */
export function generateV2PluginCss(v2Css: string, indexCss: string): string {
  const darkIdx = v2Css.indexOf(V2_THEME_MARKERS.dark);
  if (darkIdx === -1) throw new Error('generateV2PluginCss: marker not found: ' + V2_THEME_MARKERS.dark);
  const darkBlock = extractCssBlock(v2Css, V2_THEME_MARKERS.dark, darkIdx);
  const lightBlock = extractCssBlock(v2Css, V2_THEME_MARKERS.light);
  // v2.css's second bare `.v2-root {` (searched for past the first) is the plain base-chrome
  // rule (background/color/font-family), not a theme block.
  const baseBlock = extractCssBlock(v2Css, V2_THEME_MARKERS.dark, darkIdx + 1);
  const baseTokensBlock = extractCssBlock(indexCss, V2_THEME_MARKERS.baseTokens);

  const components = COMPONENT_CLASS_PREFIXES
    .map((prefix) => extractRulesByPrefix(v2Css, prefix))
    .join('\n\n');

  const tones = V2_STATUS_TONE_NAMES
    .map((tone) => `[data-tone='${tone}'] { color: var(--status-${tone}); }`)
    .join('\n');

  return `:root {${baseTokensBlock}}

:root, [data-theme='dark'] {${darkBlock}}

[data-theme='light'] {${lightBlock}}

:root, body {${baseBlock}}

/* The one hand-authored rule in this generator, not extracted from any source file: the base
   reset a real V2 page gets for free from Tailwind's own preflight, pulled into index.css by its
   framework entry point. A plugin page has no bundler to load that from, so without this,
   .v2-input's width: 100% plus its own border/padding overflows its card, and a form control
   keeps the browser's own default font instead of inheriting the page's. */
*, *::before, *::after { box-sizing: border-box; }
body { margin: 0; }
button, input, select, textarea { font-family: inherit; font-size: inherit; }

${components}

${tones}
`;
}
