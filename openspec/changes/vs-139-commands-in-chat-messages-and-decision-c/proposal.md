## Why

Captain (2026-09-08) asked for click-to-copy commands, twenty minutes after being handed
`ssh root@backup-host.example.com 'cat /etc/fernwood/backup-passphrase'` by the VS-71 passphrase gate and having
to select it by hand on a phone. Chat messages already render markdown, so a fenced block or an
inline code span has no copy affordance to attach to. Decision cards are worse: `DecisionCard.tsx`
renders `decision.context` as a literal `<p>`, so every card the conductor has written with
`**bold**`, backticked commands, or bulleted options has shown captain literal asterisks and
backticks — there is no code element there at all until that text is parsed as markdown.

## What Changes

- `markdownToHtml` (`packages/ui/src/lib/markdown.ts`) attaches the exact source text of a fenced
  code block, and of each inline code span, to the element it renders as, so a copy control can
  read it back byte-for-byte — no smart quotes, no collapsed whitespace, no added or missing
  trailing newline.
- Fixes a real rendering bug uncovered while making that guarantee hold: inline code content is
  currently re-scanned by the bold/italic/link/doc-link passes that run after it, so `` `**not
  bold**` `` renders as `<code><strong>not bold</strong></code>` instead of the literal text —
  exactly the kind of corruption the copy button must never reproduce. Inline code spans are
  protected from every later inline transform, matching how fenced blocks already behave.
- `Markdown.tsx` gains a click-delegated copy control: a visible button on a fenced block, a tap
  target on an inline code span (guarded against firing when the tap was actually a text
  selection, so selecting a paragraph containing inline code still works). Copying confirms
  visibly; where the Clipboard API is unavailable or the write is refused, the control says so
  rather than doing nothing.
- `DecisionCard.tsx` renders `decision.context` through the same `<Markdown>` component used by
  chat, instead of a plain `<p>`, so it gets both correct markdown rendering and the same copy
  affordance.
- Security verification, since this is the first time worker-authored text (`decision.context`) is
  parsed as markup rather than shown as text: confirms the renderer's escape-everything-first
  design and its `http(s):`/`/`/`#`-only link allowlist hold for that input, and adds a hostile-input
  test rather than relying on the renderer's own comment.
- Because `Markdown.tsx` is the one component behind chat, ticket comments and descriptions,
  knowledge docs, plan/proposal/design previews, worker briefs, role charters, PR bodies and
  project focus text, all of them gain the copy affordance as a byproduct of this change — that is
  the intended breadth ("wherever the conductor's words reach captain and code is likely"), not
  scope creep. Deliberately left out: the diff viewer and the transcript's tool output, which
  render through a different path entirely and are explicitly out of scope for this ticket.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `conductor-chat/message-formatting`: adds a requirement that a fenced code block or inline code
  span rendered by this capability carries a one-tap copy control that puts its exact source text
  on the clipboard, confirms visibly, and degrades honestly when the clipboard is unavailable; and
  extends the existing "shown verbatim" guarantee for fenced blocks to inline code spans too (no
  markdown interpreted inside either).
- `human-decisions/option-cards`: the "A decision with options is presented as a card" requirement
  changes so the context/recommendation text is rendered as markdown, through the same renderer and
  with the same copy affordance as a chat message, rather than as plain text.

## Impact

- `packages/ui/src/lib/markdown.ts`: fenced-block and inline-code copy-source attachment; inline
  code is protected from later inline-markup passes.
- `packages/ui/src/components/Markdown.tsx`: copy-control click handling, visible confirmation,
  clipboard-unavailable / write-failure handling.
- `packages/ui/src/components/DecisionCard.tsx`: `decision.context` rendered via `<Markdown>`.
- Tests: `packages/ui/src/test/markdown*.test.ts(x)` (byte-exact copy source, inline-code-not-
  reinterpreted regression, hostile-input escaping) and `packages/ui/src/test/components.test.tsx`
  (DecisionCard markdown rendering, copy control, clipboard-unavailable path).
- No change to the daemon, the API, or any other client (CLI, TUI, Telegram) — this is a web-app-
  only rendering and interaction change.
