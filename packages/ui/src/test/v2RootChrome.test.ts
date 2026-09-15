/**
 * A CSS-source contract for the V2 app ground (VS-482). V2 carries its theme on `.v2-root`, not on
 * `<html>` (VS-343), so the app must paint its own ground and inherited ink or the document body's
 * theme shows through: `body` resolves `--bg-0` against `<html>`, and the brand mark (a
 * `currentColor` `WeaveMark` with no ink class) inherits `color` from its ancestors. VS-457's
 * stylesheet merge dropped the `.v2-root` rule that did this, which rendered light mode as a black
 * page with near-white rail ink.
 *
 * jsdom cannot resolve custom properties in computed styles, so this asserts the declared paint
 * contract on `packages/ui/src/index.css` itself — the same parse-the-stylesheet pattern as
 * `themeTokenInline.test.ts`. The actual computed colours are proven by rendered captures.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8');

/** Every top-level rule (selector text + balanced body) in `source`, comments removed. */
function topLevelRules(source: string): Array<{ selector: string; body: string }> {
  const clean = source.replace(/\/\*[\s\S]*?\*\//g, ' ');
  const rules: Array<{ selector: string; body: string }> = [];
  let i = 0;
  while (i < clean.length) {
    const open = clean.indexOf('{', i);
    if (open === -1) break;
    const selector = clean.slice(i, open).trim();
    let depth = 0;
    let j = open;
    for (; j < clean.length; j++) {
      if (clean[j] === '{') depth++;
      else if (clean[j] === '}') {
        depth--;
        if (depth === 0) break;
      }
    }
    if (selector) rules.push({ selector, body: clean.slice(open + 1, j) });
    i = j + 1;
  }
  return rules;
}

const rules = topLevelRules(css);

/** The body of the rule whose selector is exactly `.v2-root`, or undefined if there is none. */
const v2Root = rules.find((r) => r.selector.split(',').some((part) => part.trim() === '.v2-root'));

describe('the V2 root paints its own ground and ink (VS-482)', () => {
  it('declares a .v2-root rule at all — the rule VS-457\'s merge dropped', () => {
    expect(v2Root, 'no `.v2-root` rule in index.css').toBeDefined();
  });

  it('paints the ground from --bg-0, so a dark document root cannot show through', () => {
    expect(v2Root?.body).toMatch(/background:\s*var\(--bg-0\)/);
  });

  it('sets the inherited ink from --text-1, so an unclassed currentColor mark is themed', () => {
    expect(v2Root?.body).toMatch(/color:\s*var\(--text-1\)/);
  });

  it('carries the base typography on the same rule, as the deleted v2.css did', () => {
    expect(v2Root?.body).toMatch(/font-family:\s*var\(--ff-ui\)/);
    expect(v2Root?.body).toMatch(/font-size:\s*var\(--fs-body\)/);
  });

  it('keys the tokens on the bare data-theme attribute, so both <html> and .v2-root resolve', () => {
    const light = rules.find((r) => r.selector.split(',').some((part) => part.trim() === "[data-theme='light']"));
    expect(light?.body).toMatch(/--bg-0:\s*#f7f8f9/);
    const dark = rules.find((r) => r.selector.split(',').some((part) => part.trim() === "[data-theme='dark']"));
    expect(dark?.body).toMatch(/--bg-0:\s*#050506/);
  });
});