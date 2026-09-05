# Design

## The renderer

`markdownToHtml(src, opts?: { breaks?: boolean })` in `packages/ui/src/lib/markdown.ts`. The only
behavioural difference under `breaks` is in `flushPara`: the buffered lines join with `<br />`
instead of `' '`. Everything else — escaping, inline spans, lists, fences, blockquotes, the blank-line
handling that already collapses any run of blank lines into a single paragraph boundary — is shared,
so there is one renderer and one escaping path, not two.

`<Markdown source breaks />` passes the flag through and keeps it in the `useMemo` key.

Off by default, and deliberately so. The renderer is used for knowledge files, plans, proposals,
briefs, charters and ticket descriptions, which are hard-wrapped generated markdown: hard breaks there
would leave every paragraph ragged. Only composer text — thread messages and ticket comments — opts in.

## The chat

`ChatMessage` renders both directions through `MessageBody`, which already rewrites ticket identifiers
into anchors and delegates to `Markdown`. The human's bubble keeps its own container styling; only the
raw-string child is replaced. `.ac-prose > :last-child { margin-bottom: 0 }` stops the renderer's
trailing paragraph margin from padding the bottom of a bubble.

Reply quotes keep their existing plain-text clamped spans — they are locators, and `line-clamp` on
collapsed whitespace is what makes them one line.

## What is not touched

`threads.inbound`, `threads.messages` and `tickets.comment` are unchanged; the round-trip is asserted
by a test rather than by new code. The Telegram channel renders through `toMarkdownV2`
(`packages/channels/telegram/src/render.ts`), which is a separate encoder for a separate client and
does not collapse newlines.
