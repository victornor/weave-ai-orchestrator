## 1. `markdownToHtml`: exact copy source and the inline-code fix

- [x] 1.1 Restructure fenced-block handling in `packages/ui/src/lib/markdown.ts` to buffer raw
      (untrimmed) lines while inside a fence and emit `<pre><code data-copy="...">` in one shot at
      the closing fence, with `data-copy` and the visible content both `esc(lines.join('\n'))` —
      no trailing newline added. Verify with a unit test comparing `data-copy` against the exact
      source lines for a multi-line block, a block with trailing whitespace on a line, and an
      empty block.
- [x] 1.2 Fix `inline()`'s order-dependency bug: extract each inline code span into an inert
      placeholder before the doc-link, bold, italics and link passes run, and substitute the final
      `<code data-copy="...">...</code>` back in as the last step, so nothing after code-extraction
      can rewrite a code span's content. Verify with a unit test asserting `` `**not bold**` ``
      renders as literal text inside `<code>`, not `<strong>`, and that `` `[[not-a-doclink]]` ``
      stays literal too.
- [x] 1.3 Give the inline `<code>` element the same `data-copy` value as its visible content
      (already guaranteed equal by 1.2's placeholder substitution). Verify with a unit test
      asserting `data-copy` equals the span's raw source for spans containing HTML-special
      characters (`&`, `<`, `>`, `"`) and confirming the attribute round-trips correctly when
      parsed back into a DOM (jsdom `element.getAttribute('data-copy')`).
- [x] 1.4 Run the full existing `markdown.test.ts` suite (or its current filename) and confirm
      every prior assertion about rendered HTML still passes unchanged, since 1.1/1.2 change
      internal structure but not the escaped visible output for well-formed input.

## 2. `Markdown.tsx`: the copy control

- [x] 2.1 Add a fenced-block copy button to the HTML `markdownToHtml` emits (inside the wrapping
      element around `<pre>`, outside `<code>`), and a `class` on inline `<code data-copy>` spans
      that marks them as tappable. Verify by rendering a source with both a fenced block and an
      inline span and asserting both elements are present with `data-copy` set.
- [x] 2.2 In `Markdown.tsx`, attach one delegated `click` handler on the component's container:
      resolve `e.target.closest('[data-copy]')`, bail if `window.getSelection()?.toString()` is
      non-empty (a real selection, not a tap), otherwise read `data-copy` and call
      `navigator.clipboard.writeText`. Verify with a test that clicks a fenced block's copy button
      and asserts `writeText` was called with the exact `data-copy` value.
- [x] 2.3 Add a test asserting that a `mousedown`+selection sequence across a paragraph containing
      inline code (simulated via setting `window.getSelection` to report non-empty text before the
      `click` fires) does not call `writeText` — the selection-guard from 2.2.
- [x] 2.4 Add a visible, transient confirmation state (e.g. the tapped element flips to a "Copied"
      label/icon for a couple of seconds, then reverts) driven from the same click handler. Verify
      with a test that copying shows the confirmation and that it is not present before the click.
- [x] 2.5 Detect clipboard availability once (`navigator.clipboard?.writeText` present) and mute /
      relabel the controls when it is not, so a tap reports "can't copy here" instead of doing
      nothing; do the same (a distinct "couldn't copy" state) when `writeText` rejects. Verify with
      two tests: one with `navigator.clipboard` deleted/undefined, one with `writeText` mocked to
      reject.

## 3. Decision cards render markdown

- [x] 3.1 Replace the literal `<p>{decision.context}</p>` at `DecisionCard.tsx:240` with
      `<Markdown source={decision.context} className="mb-3 text-meta leading-relaxed text-text-2" />`
      (dropping the `<p>` wrapper's styling onto the `Markdown` container). Verify with a test
      rendering a `DecisionCard` whose `context` contains `**bold**`, a backticked command and a
      bullet list, asserting the corresponding `<strong>`, `<code>` and `<li>` elements appear
      rather than literal markdown characters.
- [x] 3.2 Verify the copy control from section 2 is present and functional on a decision card's
      context by rendering one with a fenced/inline code span and asserting the same `data-copy`
      element and click-to-copy behavior as in the chat tests.

## 4. Security verification for worker-authored context

- [x] 4.1 Add a test that renders a `decision.context` containing a `<script>` tag, a
      `javascript:`-scheme link, a `data:`-scheme link, and `[[doclink-shaped]]` text, asserting
      the output contains no executable script, no `javascript:`/`data:` href, and that the
      escaping/allowlist behavior described in `design.md`'s security section holds for this input
      path specifically (not just for chat messages).
- [x] 4.2 State the verification result (no renderer change needed; existing `esc()` + link
      allowlist + no-image-syntax already cover worker-authored input) in the PR description, per
      the ticket's requirement to say so explicitly rather than trust the renderer's comment.

## 5. Spec and delivery

- [x] 5.1 Confirm `openspec validate vs-139-commands-in-chat-messages-and-decision-c --json
      --strict` passes with the two modified capabilities (`conductor-chat/message-formatting`,
      `human-decisions/option-cards`).
- [x] 5.2 Manually verify in the real running app (throwaway daemon, phone-width viewport): copying
      a fenced block in chat, copying an inline code span without breaking paragraph selection, and
      a decision card with markdown context and a working copy control. Record what was checked in
      the PR description, per the ticket's instruction that a jsdom test alone does not prove this.
- [x] 5.3 Run `pnpm lint && pnpm typecheck && pnpm test` and confirm all are green.
- [x] 5.4 Open the PR, record it on the ticket, and state explicitly which other `<Markdown>`
      consumers (ticket comments/description, knowledge docs, plan/proposal/design previews,
      worker briefs, role charters, PR bodies, project focus) now carry the copy affordance as a
      byproduct, and that the diff viewer and transcript tool output were deliberately left alone.
