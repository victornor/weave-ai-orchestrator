## Context

See proposal.md for motivation.

`ChatMessage` (`packages/ui/src/routes/Chat.tsx`) wraps inbound (human)
messages in `max-w-[80%] rounded-r10 … bg-bg-3 px-3.5 py-2.5` and outbound
(conductor) messages in `w-full` with no background, radius or padding.
`MessageBody` then renders `<Markdown className="ac-chat-prose" breaks />`.
Fenced blocks emit `.ac-codeblock > pre` with their own `bg-bg-2` card
(`index.css`). Flex items default to `min-width: auto`, so a wide `<pre>`
can grow the column.

`markdownToHtml` (`packages/ui/src/lib/markdown.ts`) already flushes an
unclosed fence at EOF. It has no table parser; a pipe table is a paragraph
of `|` characters. `ac_human_send` takes `body: z.string().min(1)` with no
max; `threads.outbound` stores one row per call.

## Goals / Non-Goals

**Goals:**
- Give every thread message a containing bubble so a fence or table cannot
  read as a separate card in the chrome.
- Contain overflow (`min-w-0`, horizontal scroll on `pre` / `table`) so wide
  content stays inside that box.
- Parse GFM pipe tables in `markdownToHtml` so a data-model table is a
  `<table>` inside the bubble.
- Tell the conductor one logical reply is one `ac_human_send`.

**Non-Goals:**
- No daemon body-size limit and no split/rejoin of `ac_human_send`.
- No merging of consecutive outbound messages from the same run.
- No Telegram / TUI restyle.
- No change to stored bodies, API shape, or schema.
- No new markdown features beyond GFM pipe tables (no rowspan, no HTML tables).

## Decisions

### Bubble both directions; keep who-wrote styling

Put a containing box on outbound messages too (background, radius, padding,
`min-w-0`, `max-w-full` / a high max-width so conductor copy can still use
the column). Keep inbound as the existing right-aligned 80% bubble. Both
sides already share `MessageBody`; only the wrapper classes change.

Alternative considered: leave conductor full-bleed and only `overflow-hidden`
the list. Rejected — the fence's own card chrome is what reads as a second
message; without a parent bubble it still sits in the chrome.

Alternative considered: coalesce same-run outbound messages into one bubble.
Rejected — that hides intentional multi-send replies and invents a grouping
the store does not have. One send = one row = one bubble.

### Overflow: `min-w-0` on the bubble, scroll inside `pre` / `table`

Keep `.ac-prose pre { overflow-x: auto }` and add the same on tables. The
bubble needs `min-w-0` (and likely `overflow-x: hidden` or `max-w-full`) so
the flex item can shrink below the pre's intrinsic width. Do not
`overflow: hidden` on Y in a way that clips the copy button under a fence.

### GFM tables in the existing renderer

Extend `markdownToHtml` to detect a run of pipe-table lines (header row,
separator, body rows) and emit `<table><thead>…</thead><tbody>…</tbody></table>`,
escaping cells then running `inline()` on them. Shared renderer, so ticket
comments and knowledge pick it up for free — acceptable; the spec calls that
out. Chat CSS (`.ac-chat-prose` or `.ac-prose table`) keeps the table inside
the bubble (`width: 100%`, `overflow-x: auto` on a wrapper).

Alternative considered: leave pipes as paragraphs and only contain overflow.
Rejected — the ticket names tables, and a data-model snippet is typically a
pipe table; raw pipes still look like chrome.

### No server split

There is no body cap today. Adding one would create the three-message bug
the ticket is fixing. Prompt + tool description: send the whole reply in one
call. If a limit is added later, it must split on a paragraph, close fences,
and never emit a half-block — out of this change.

## Risks / Trade-offs

- [Conductor bubble full-width vs 80%] → Use a containing box that can be
  wider than the human bubble (left, `max-w-full` or ~92%) so long replies
  stay readable. Exact width is CSS; tests assert one container and
  descendant fence, not pixels.
- [A conductor who still sends three `ac_human_send`s] → Three bubbles. The
  prompt line is the nudge; merging is out of scope.
- [GFM tables in knowledge/comments] → Same renderer. Tables there are an
  improvement; no chat-only flag.
- [jsdom has no layout] → Assert DOM ancestry (fence/table inside the
  message container) and classes (`min-w-0`, overflow), not painted pixels.
  Same convention as other `packages/ui` chat tests.

## Migration Plan

Display-only. Existing long messages gain a bubble on next UI load. Rollback
is revert; stored bodies unchanged.

## Open Questions

None.
