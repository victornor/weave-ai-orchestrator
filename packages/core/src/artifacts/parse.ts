/**
 * CSS custom-property parsing shared by the AC Artifact Kit (`kit.ts`) and its drift test —
 * `openspec/specs/artifact-kit/design-tokens`. The token blocks in both `ARTIFACT_KIT_CSS` and
 * `packages/ui/src/index.css` are flat `--name: value;` declarations, never nested selectors, so a
 * tiny regex parser is enough; no CSS parser dependency.
 */

/**
 * The text between the first `{` after `marker` and its matching `}`, brace-depth aware.
 * `fromIndex` searches for `marker` starting at that offset, for a CSS source where the same
 * marker text appears more than once (e.g. `v2.css`'s two `.v2-root {` blocks).
 */
export function extractCssBlock(css: string, marker: string, fromIndex = 0): string {
  const markerIndex = css.indexOf(marker, fromIndex);
  if (markerIndex === -1) throw new Error(`extractCssBlock: marker not found: ${marker}`);
  const open = css.indexOf('{', markerIndex);
  if (open === -1) throw new Error(`extractCssBlock: no '{' after marker: ${marker}`);
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}') {
      depth--;
      if (depth === 0) return css.slice(open + 1, i);
    }
  }
  throw new Error(`extractCssBlock: unbalanced braces after marker: ${marker}`);
}

/** `--name: value;` declarations in a block of CSS, keyed by `--name`, trailing comments excluded. */
export function parseCssCustomProperties(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /--([a-zA-Z0-9-]+)\s*:\s*([^;]+);/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(block))) {
    const name = match[1];
    const value = match[2];
    if (name && value) out[`--${name}`] = value.trim();
  }
  return out;
}
