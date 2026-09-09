## Context

See proposal.md for motivation.

`markdownToHtml` (`packages/ui/src/lib/markdown.ts:30-31`) already turns
`[text](url)` into `<a href="…" target="_blank" rel="noreferrer">` when the
URL matches `^(https?:|\/|#)`. `javascript:` and anything else is stripped to
plain text. Chat `MessageBody` (`packages/ui/src/routes/Chat.tsx:66-87`)
rewrites ticket identifiers to `[ID](#ticket:ID)` then renders through
`<Markdown breaks />`. Ticket chips and knowledge doc-links are already
special-cased in `index.css` by href prefix / class. `ac_human_send`
(`packages/server/src/tools.ts:578-588`) takes `body: string` only.

Ticket comments, knowledge, plans and decision context all use `<Markdown>`
too; they must not pick up chat button styles.

## Goals / Non-Goals

**Goals:**
- Style `https:` markdown links in conductor chat as compact wrap-friendly
  buttons, using the HTML the renderer already emits.
- Tell the conductor, in the tool description and the always-loaded prompt,
  that `[label](https://url)` is how to author them.

**Non-Goals:**
- No new `ac_human_send` field, no message JSON, no migration.
- No restyle of ticket comments, Telegram, TUI, knowledge, or decision cards.
- No autolinking of bare URLs (the conductor writes titled markdown).
- No change to the existing `http:` / `/` / `#` allowlist beyond "buttons are
  `https:` only".

## Decisions

### Authoring: markdown in `body`, not structured parts

The ticket allowed either. Structured `links: [{title, url}]` would need a
schema, a column or JSON blob, API and `ThreadMessage` changes, for a feature
the renderer already encodes as `[label](url)`. Markdown keeps storage
byte-for-byte (existing "Rendering does not change what is stored") and works
on any channel that already shows markdown links.

Alternative considered: a new `links` array on `ac_human_send`. Rejected —
does not fit the existing chat renderer, and is more than the ticket asked.

### Styling: chat-scoped CSS on existing `<a href="https:">`, not a renderer flag

Add a class on chat `MessageBody`'s `<Markdown>` (e.g. `ac-chat-prose`). In
`index.css`, style `.ac-chat-prose a[href^="https://"]` (and `https:` if
needed) as a compact pill: label only, no underline, wrap, `max-width: 100%`,
comfortable tap padding using existing tokens (`--bg-2`, `--line-2`,
`--r4`/`--r6`, `--fs-meta`/`--fs-ui`, `--space-*`). Keep `target="_blank"
rel="noreferrer"` from the renderer.

Ticket chips (`#ticket:`) and doc-links (`#doc:` / `.ac-doclink`) do not
match `href^="https://"` and stay as they are. `http:` links stay underlined
text. Other `<Markdown>` consumers omit the class, so comments keep today's
inline links.

Alternative considered: a `linkButtons` option on `markdownToHtml` that emits
`class="ac-link-btn"`. Rejected — the href already distinguishes https, and a
new option would have to be threaded through every Markdown call site to
*avoid* the buttons. CSS scope is the smaller change.

Alternative considered: only "link-only paragraphs" become a button row, and
inline `[text](url)` stays a text link. Rejected for v1 — captain wants
buttons, not a second inline style, and a conductor who writes the link on
its own line already gets a clean row. Mid-sentence pills are acceptable.

### Phone: wrap, don't shrink below a tap

Pills are `inline-flex`, wrap with gap, `max-width: 100%`, long labels wrap
inside the pill (`overflow-wrap: anywhere`). Padding should be larger than
the ticket-identifier chip (those are too small to tap) but still "small
button", not the 44px decision-card primary band. Use token spacing, not
raw px in a component file. The lint gate on `packages/ui` forbids raw hex/px
in components; `index.css` is the right place, matching ticket chips.

### Conductor actually writes them

Without a prompt change the conductor will keep pasting bare URLs (not
autolinked today). Add one sentence to `ac_human_send`'s `description` and to
`templates/conductor.AGENTS.md.tmpl` "How you talk": titled links go in the
body as `[label](https://url)` and render as buttons. Mirror that in the
conductor skill only if that file already describes `ac_human_send` body
shape (it currently does not — skip unless a one-line fit).

## Risks / Trade-offs

- [Human messages with `[text](https://…)` also become buttons] → Accept.
  Existing "both sides rendered the same way" requires it; humans rarely
  write markdown links in chat.
- [A long label overflows the phone] → `max-width: 100%` + wrap inside the
  pill. Assert in the chat test that two buttons exist; wrap is CSS.
- [Conductor still pastes bare URLs] → Tool description + AGENTS line. No
  autolink in this change.
- [CSS `a[href^="https://"]` is slightly broader than the markdown allowlist]
  → Chat does not inject other https anchors into `.ac-prose` today
  (attachments are outside MessageBody). Keep the selector under
  `.ac-chat-prose` so it cannot leak.

## Migration Plan

Display-only. Old messages that already contain `[label](https://…)` start
showing buttons on next UI load. Rollback is revert; stored bodies unchanged.

## Open Questions

None. Markdown-vs-structured was the ticket's fork and is decided above.
