## Context

`markdownToHtml` (`packages/ui/src/lib/markdown.ts`) is a small hand-rolled renderer: `esc()` runs
once over the whole input, then a chain of `.replace()` calls adds markup (doc-links, inline code,
bold, italics, links) to the already-escaped string. `Markdown.tsx` dumps the result via
`dangerouslySetInnerHTML`. Fenced blocks bypass `inline()` entirely and are escaped line-by-line.
`DecisionCard.tsx:240` renders `decision.context` as a literal `<p>{decision.context}</p>` — no
parsing at all. See `proposal.md` for why this is changing and what surfaces are affected.

## Goals / Non-Goals

**Goals:**
- A byte-exact copy source for a fenced block and an inline code span, without a second parse pass.
- A tap-to-copy interaction that cannot be mistaken for, or interfere with, scrolling or selecting.
- `decision.context` rendered through the same path as a chat message, safely, for both
  conductor-authored and worker-authored text.

**Non-Goals:**
- No new markdown syntax, no library adoption, no change to what the renderer supports beyond what
  copy and decision-card rendering need (per the ticket's stated out-of-scope).
- No copy affordance on the diff viewer or the transcript's tool output — neither goes through
  `markdownToHtml`, and both are explicitly out of scope.

## Decisions

### Attaching the raw copy source: reuse the existing escaped capture, no second pass

`esc()` is applied to the whole string before any markup regex runs, and none of the markup regexes
change the position or count of the delimiters they match on (backticks, `**`, `[[`). That means the
capture group in `` /`([^`]+)`/g `` already equals `esc(rawSpanText)` — exactly the string a
double-quoted HTML attribute needs, and exactly what a browser's attribute parser hands back
unchanged via `getAttribute()` (it un-escapes `&amp; &lt; &gt; &quot;`, leaves everything else
alone, and does not re-interpret the value as markup). So the same captured text that already
becomes the element's visible content also becomes its `data-copy` attribute — no separate
raw-source tracking, no risk of the two drifting apart.

Fenced blocks are restructured to buffer their raw (untrimmed) lines while inside the fence and emit
the whole `<pre><code data-copy="...">` in one shot at the closing fence, instead of streaming
`<code>` open immediately and each line separately — needed because the attribute has to carry the
complete block, and the block's raw lines are already escaped line-by-line the same way, so
`esc(lines.join('\n'))` is both the visible content and the copy source. No trailing newline is
added: the joined lines are exactly the lines between the fences, nothing after the last one.

Alternative considered: track raw offsets in a side channel (an array of `{start, end}` spans over
the original source) and slice the original string for the attribute. Rejected — it requires the
parser to track byte offsets through every transform, which the current line/regex-based structure
doesn't do anywhere, for no benefit over the escaping-commutes argument above.

### Fixing inline code's order-dependency bug, because it threatens byte-exactness

`inline()`'s regex chain runs doc-link, then code, then bold, then italics, then link — in that
order, on the *same* progressively-mutated string. Once the code regex inserts
`<code>escapedContent</code>`, that substring is still plain text to the *later* regex passes, which
don't know it's inside a `<code>` tag. `` `**not bold**` `` becomes
`<code><strong>not bold</strong></code>` today. If left as-is, the same corruption would land in the
`data-copy` attribute, defeating the byte-exact guarantee this change promises.

Fix: extract code spans first into an inert placeholder token, built from a control character
that cannot appear in the escaped input, before any other inline transform runs; substitute the
final `<code data-copy="...">` markup back in as the last step, after bold/italics/links have
already run over the rest of the string. This also means a code span containing `[[slug]]`-shaped text is no longer
mistakenly turned into a doc-link — a second instance of the same bug class, fixed the same way.
Fenced blocks already have no such problem (they never go through `inline()`).

Alternative considered: leave the bug and special-case "don't let bold/italics touch a `data-copy`
attribute". Rejected — the attribute and the visible content must stay identical (the button copies
what the reader sees), and the placeholder approach fixes the visible rendering too, which is a
real, independently-worth-fixing defect once noticed.

### The tap interaction: native click semantics plus a selection guard, not a custom gesture

A browser already does not fire a `click` event on an element when the pointer/touch moved enough to
count as a drag (a text selection or a scroll), which covers "an accidental tap while scrolling must
not silently copy" for free. `Markdown.tsx` attaches one delegated `click` handler on its container
(`e.target.closest('[data-copy]')`) rather than one listener per code element, so injected HTML from
`dangerouslySetInnerHTML` needs no per-node wiring.

Belt-and-braces: the handler also checks `window.getSelection()?.toString()` and bails if non-empty,
so that even a browser whose click/drag distinction is looser than expected cannot turn "select this
paragraph" into "also copy this code span". This is the concrete mechanism behind the "must not
break normal text selection" acceptance criterion.

Fenced blocks get a small explicit button rendered by `markdownToHtml` next to the `<pre>`, outside
the `<code>` element — pressing it is unambiguous and never a stand-in for selecting the block's
text by hand. Inline code spans have no room for a separate button; the `<code>` element itself
carries `data-copy` and is the tap target, styled to look interactive (cursor, subtle affordance)
rather than looking like plain inline code.

Alternative considered: a long-press-to-copy gesture, closer to native OS text selection. Rejected —
it re-implements gesture detection the platform already does via `click`, and a visible always-there
control matches criterion 4 ("copying confirms visibly") better than a hidden gesture would.

### Clipboard availability and failure: check once, fail loudly, never silently

`markdownToHtml` always emits the copy controls — it has no access to `navigator` and stays a pure
string function, which keeps it trivially testable in Node/jsdom without a DOM. `Markdown.tsx`
checks `navigator.clipboard?.writeText` once on mount; when it is absent, the container gets a
modifier class that mutes the controls and changes what a tap on one does — it reports "can't copy
here" instead of no-op. When the API exists but a call throws (permission refused, non-secure
context surprises), the same element flips to a brief "couldn't copy" state instead of the normal
"copied" one. Both states are visible and both are transient (revert after a couple of seconds),
matching the chat's other transient confirmations.

### Decision-card security: verifying, not re-designing, the renderer's safety story

`decision.context` is the first input to `markdownToHtml` that is not always conductor-authored — a
worker's question or gate finding derives its context from repository contents and tool output.
Verified against the current implementation (not the renderer's own comment):
- `esc()` runs over the entire input before any markup regex, so a literal `<script>`, `<img>` or
  any other tag in the source becomes inert text — there is no path from raw input to an
  unescaped angle bracket in the output.
- The link regex only emits an `<a>` when the target matches `^(https?:|\/|#)`; anything else
  (`javascript:`, `data:`, a bare word) renders as the link's plain text with no `<a>` at all — no
  path to a `javascript:`/`data:` href.
- The renderer has no image syntax (no `![...]()` handling anywhere in the file), so there is no
  `src` attribute an attacker-controlled string can ever reach.
- The doc-link syntax's slug is captured by `[a-z0-9][a-z0-9-]*`, a character class that cannot
  contain `"`, `<`, `>` or `&`, so it cannot break out of the `href="#doc:${slug}"` attribute it is
  interpolated into regardless of escaping.

Conclusion: no renderer change is needed for safety — the existing design already holds for
worker-authored input. This is confirmed with a test that feeds `decision.context` a `<script>` tag,
a `javascript:` link, and doc-link-shaped text, and asserts none of them execute or produce a link.
This is a verification task, not a code change, distinct from the inline-code-placeholder fix above.

## Risks / Trade-offs

- **Inline code's placeholder fix changes existing visible output** for the (buggy, currently
  mis-rendered) case of a code span containing `**`, `*`, or `[[...]]`-shaped text — anywhere
  `Markdown.tsx` is used, not just chat. This is a correctness fix, not a behavior anyone could be
  relying on (the old behavior was corrupting the text), but it is a rendering diff worth calling
  out in the PR. → Covered by the new spec scenario and a regression test; no migration needed since
  nothing is stored in the old, wrong form.
- **Muting the copy control instead of hiding it** when the clipboard is unavailable is a design
  choice, not dictated by the ticket (which allows either). → Chosen because hiding conditionally
  would require `markdownToHtml` to know about `navigator`, breaking its pure-function testability;
  muting via a container class keeps the split clean.
- **Every existing `<Markdown>` consumer gains copy controls**, including read-heavy surfaces like
  knowledge docs and plan previews. → Intended per the ticket's "wherever the conductor's words
  reach captain and code is likely" framing; called out explicitly in the proposal so it isn't read
  as accidental scope growth.
