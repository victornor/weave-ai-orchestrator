# Code playbook

For a code excerpt worth annotating — walking through why a function is shaped the way it is, not
just showing it. A raw paste of code a human can already open in their editor is not an artifact;
what makes it worth one is the commentary sitting next to the code.

## Technique

- `<pre><code>` for the excerpt itself — the kit styles it as a block with a background and padding.
  Keep excerpts short: the lines that matter, with a `// …` comment where you've cut unrelated
  lines, not the whole file.
- Put commentary **beside or below** the block in prose, each point tied to a specific line by
  number or by a short quoted fragment (`` `dispatch()` on line 3 `` ), not as inline comments
  stuffed into the code itself — inline comments in the excerpt should be real comments from the
  source, or absent.
- Always cite the real location as `path:line` right above or below the block, so the excerpt can be
  checked against the repo rather than trusted as transcribed correctly.
- For a before/after code comparison specifically, use the change playbook's two-block pattern
  (`references/change.md`) instead of trying to diff-mark a single block by hand.
- No syntax highlighting — the kit ships no JS and no highlighter grammar. Rely on the monospace
  font and the annotation prose to carry meaning; don't try to fake highlighting with inline
  `<span>` colors per token, it will drift from whatever the real highlighter would produce and adds
  noise for little benefit.

## Worked skeleton

```html
<pre><code>function extractCssBlock(css, marker) {
  const open = css.indexOf('{', css.indexOf(marker));
  let depth = 0;
  for (let i = open; i &lt; css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}' &amp;&amp; --depth === 0) return css.slice(open + 1, i);
  }
}</code></pre>
<p class="prose">
  <code>packages/core/src/artifacts/parse.ts:8</code> — brace-depth tracking rather than a
  regex match to the next <code>}</code>, so a nested block (a media query inside a selector)
  doesn't end the extraction early.
</p>
```
