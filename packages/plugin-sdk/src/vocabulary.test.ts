/**
 * VS-385, design.md's drift guard: captain's binding requirement is that `@weave-ai/plugin-sdk`
 * carries the vocabulary's *names* only, never a visual value — the daemon generates and pushes the
 * real CSS, so a plugin automatically inherits a restyled `v2.css` with no SDK republish. This test
 * is the completeness half of that guard for the SDK package itself (`v2-theme.test.ts` in
 * `@weave-ai/core` covers the generated-stylesheet half): nothing in `WEAVE_PLUGIN_CLASS` or
 * `WEAVE_PLUGIN_CLIENT_JS` may be a colour, spacing, radius or font-size value.
 */
import { describe, expect, it } from 'vitest';
import { WEAVE_PLUGIN_CLASS, WEAVE_PLUGIN_CLIENT_JS } from './index.js';

const VISUAL_VALUE_PATTERNS: Array<{ name: string; pattern: RegExp }> = [
  { name: 'hex colour', pattern: /#[0-9a-fA-F]{3,8}\b/ },
  { name: 'colour function', pattern: /\b(?:rgb|rgba|hsl|hsla|oklab|oklch|color-mix)\(/ },
  { name: 'px length', pattern: /\d+px\b/ },
  { name: 'rem/em length', pattern: /\d+(?:rem|em)\b/ },
  { name: 'font declaration', pattern: /font-(?:family|size)\s*:/ },
];

describe('the vocabulary carries no visual values (VS-385)', () => {
  it('WEAVE_PLUGIN_CLASS names classes only', () => {
    const serialized = JSON.stringify(WEAVE_PLUGIN_CLASS);
    for (const { name, pattern } of VISUAL_VALUE_PATTERNS) {
      expect(serialized, `WEAVE_PLUGIN_CLASS should carry no ${name}`).not.toMatch(pattern);
    }
    // Every value is a bare class name: letters, digits and hyphens only, nothing that could
    // itself be mistaken for an inline style or a selector carrying a value.
    for (const value of Object.values(WEAVE_PLUGIN_CLASS)) {
      expect(value).toMatch(/^[a-z0-9-]+$/);
    }
  });

  it('WEAVE_PLUGIN_CLIENT_JS is bridge logic only, no styling literal', () => {
    for (const { name, pattern } of VISUAL_VALUE_PATTERNS) {
      expect(WEAVE_PLUGIN_CLIENT_JS, `WEAVE_PLUGIN_CLIENT_JS should carry no ${name}`).not.toMatch(pattern);
    }
  });
});
