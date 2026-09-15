// @vitest-environment jsdom
/**
 * VS-465: the two plugin-page gaps the generated stylesheet closes, checked against a real DOM
 * cascade rather than by matching its CSS text. A hidden `.v2-form-row` must compute `display: none`
 * even though the vocabulary's own `.v2-form-row { display: flex }` has author origin, and two
 * adjacent top-level sections must no longer be flush.
 *
 * The jsdom globals are declared locally: this package compiles with a DOM-free `lib` (ES2022),
 * and the file only needs the handful of members used here.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { V2_THEME_MARKERS, generateV2PluginCss } from './v2-theme.js';
import { extractCssBlock, parseCssCustomProperties } from './parse.js';

interface DomElement {
  hidden: boolean;
}
interface DomDocument {
  head: { innerHTML: string };
  body: { innerHTML: string };
  getElementById(id: string): DomElement | null;
}
declare const document: DomDocument;
declare const window: { getComputedStyle(el: DomElement): { display: string; marginTop: string } };

const V2_CSS = readFileSync(resolve(process.cwd(), 'packages/ui/src/v2/v2.css'), 'utf8');
const INDEX_CSS = readFileSync(resolve(process.cwd(), 'packages/ui/src/index.css'), 'utf8');
const GENERATED = generateV2PluginCss(V2_CSS, INDEX_CSS);

/** Applies the generated stylesheet to a fresh document body. */
function render(html: string): void {
  document.head.innerHTML = `<style>${GENERATED}</style>`;
  document.body.innerHTML = html;
}

/** The element `id` or a thrown error — the tests below never render an absent one. */
function el(id: string): DomElement {
  const found = document.getElementById(id);
  if (!found) throw new Error(`no element #${id}`);
  return found;
}

describe('the generated plugin stylesheet in a real cascade (VS-465)', () => {
  it('hides a classed element with the hidden attribute, despite that class\'s own display recipe', () => {
    render('<div class="v2-form-row" id="row" hidden><span>label</span></div>');
    expect(window.getComputedStyle(el('row')).display).toBe('none');
  });

  it('still renders the same class without the attribute, so the check discriminates', () => {
    render('<div class="v2-form-row" id="row"><span>label</span></div>');
    expect(window.getComputedStyle(el('row')).display).toBe('flex');
  });

  it('separates two adjacent top-level sections with the design\'s spacing token', () => {
    render('<div class="v2-card" id="a"></div><div class="v2-table" id="b"></div>');
    // jsdom does not resolve custom properties in computed styles, so the property comes back as
    // the `var()` reference; the `:root` token it names is asserted to be a non-zero length below.
    expect(window.getComputedStyle(el('b')).marginTop).toBe('var(--space-6)');
  });

  it('leaves the first section flush against the top, with no leading gap', () => {
    render('<div class="v2-card" id="a"></div><div class="v2-table" id="b"></div>');
    // jsdom resolves an unset margin-top to '' rather than '0px'; either is "flush".
    expect(['', '0px']).toContain(window.getComputedStyle(el('a')).marginTop);
  });

  it('defines the spacing token the stack rule names', () => {
    const base = parseCssCustomProperties(extractCssBlock(GENERATED, V2_THEME_MARKERS.baseTokens));
    expect(base['--space-6']).toMatch(/^[\d.]+rem$/);
    expect(base['--space-6']).not.toBe('0rem');
  });
});
