# Sent messages in the conductor chat keep their line breaks and formatting

Tracker change for [VS-60](conductor://tickets/VS-60).

## Why

A message typed into the conductor chat with newlines — paragraphs, a list, a code fence — comes
back on screen as one run-on line. Two separate causes, both display-only:

- `packages/ui/src/routes/Chat.tsx:529` renders the human's own message as `{message.body}`, a raw
  string in a normal-whitespace `div`. Every newline collapses to a space and no markup is applied
  at all, while the conductor's message on the other side of the same thread goes through
  `MessageBody` → `Markdown`.
- `packages/ui/src/lib/markdown.ts:33` joins the lines of a paragraph with `' '`. That is correct
  CommonMark for a hard-wrapped document, but composer text is not hard-wrapped: a human who
  pressed Enter meant a line break. So even the conductor's side loses single newlines.

The daemon stores the body verbatim — `threads.inbound` writes the text it is given and
`threads.messages` reads it back unchanged — so nothing is lost, only hidden.

## What Changes

- The chat renders **both** directions of a thread through the same markdown path, so the
  conversation reads consistently.
- The markdown renderer gains an opt-in `breaks` mode: inside a paragraph, a single newline becomes
  a hard break instead of a space. Consecutive blank lines still collapse into one paragraph gap,
  and lists, headings, blockquotes and fenced code are unaffected.
- Ticket comments render through the same `breaks` mode, since they are composer text too.
- Documents that *are* hard-wrapped — knowledge files, plans, briefs, charters, ticket descriptions
  — keep today's reflowing behaviour. `breaks` is off by default for exactly that reason.
- Reply quotes are untouched: the excerpt beside the composer and above a sent message stays a
  compact clamped line, as today.

## Out of scope

Rich text editing in the composer, and any change to what the daemon stores.
