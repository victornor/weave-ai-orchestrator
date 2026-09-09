## Context

See `proposal.md` for motivation. `DecisionCard` (`packages/ui/src/components/DecisionCard.tsx`) is
shared by `Chat.tsx` (two render sites: pinned-open cards, and answered cards inline in the
conversation) and `NeedsYou.tsx`. Captain's ask is scoped to "the decisions list in the chat view
only" — `NeedsYou` and a ticket's own page must not change.

`Decision` (`packages/shared/src/types.ts`) carries `ticketId` but not the ticket's own fields.
`Chat.tsx` already resolves `ticketIdentifier` and `projectSlug` per card with
`tickets.data?.find((t) => t.id === d.ticketId)` — the same lookup gives us `createdByKind`.

## Goals / Non-Goals

**Goals:**
- Provenance tag and one-line summary render from data already on hand at render time; no new
  fetch, no model call, no per-card network round trip.
- The three visual changes (tag, summary line, density) are additive props on `DecisionCard`, opt-in
  per call site, so `NeedsYou.tsx` needs zero changes and is provably unaffected.
- `Ticket.summary` is usable today, not only for tickets created after this ships.

**Non-Goals:**
- Backfilling `summary` for existing tickets. It stays `NULL` until someone sets it; the card simply
  shows no why-line until then. This is the explicitly sanctioned "degrade sensibly" path, not a gap.
- Two-cards-per-row. See Decisions below.
- A generic ticket-editing surface. `summary` is exposed only where title/description/priority are
  already patchable (`PATCH /tickets/:id`, `conductor ticket set`) plus at creation
  (`ac_ticket_create`, `POST /tickets`) — no new UI for editing a ticket is built.

## Decisions

### The one-line summary is a dedicated field, not a truncated description

Considered: deriving the line from `ticket.description` (strip markdown, take the first paragraph,
truncate). Rejected — demonstrated against this very ticket's own description, whose first
non-heading line is "Captain (2026-09-08), verbatim:", immediately followed by a blockquote. Any
truncation heuristic simple enough to run with no model call either picks that kind of fragment or
requires enough special-casing (skip headings, skip blockquote, skip short "intro" lines ending in
`:`, split sentences, truncate at a word boundary) that it becomes its own fragile subsystem, and it
would still be guessing at what the author meant. That is exactly the "worse than nothing" failure
mode the ticket calls out.

Chosen instead: `Ticket.summary: string | null`, a plain one-line field, nullable, with no default
derivation. It is:
- **Settable at creation** (`ac_ticket_create`, `POST /tickets`) — the conductor, which authors most
  tickets, writes one sentence describing why the ticket exists at the moment it already has that
  context fully in mind.
- **Settable afterwards** (`PATCH /tickets/:id`, `conductor ticket set --summary`) — the same route
  and CLI command that already patch `title`/`description`/`priority`. This is what makes it usable
  for tickets that exist today: captain (or a future automation) can add a summary to a ticket that
  is currently awaiting approval, and its card picks it up on the next render with no code change
  and no backfill migration.
- **Length-capped** at the API boundary (200 chars) so "one line" is enforced rather than merely
  suggested; the field is otherwise free text, rendered as plain text (not markdown) since it is
  authored deliberately, not copied out of a larger document.

A ticket with no summary shows no why-line. That is the one behavior every existing ticket has today
and will keep having until it is given a summary — sanctioned explicitly in the ticket description.

### The provenance tag reads `ticket.createdByKind`, tags only the unusual case

`createdByKind` is already the field the codebase uses everywhere else to distinguish agent- from
human-authored tickets (`packages/core/src/supervisor/index.ts:362` filters on it the same way for
an unrelated purpose). No new signal is needed.

Only a conductor-filed ticket gets a tag ("Filed by conductor"); a human-filed ticket, or a decision
with no ticket, gets nothing. Captain's own framing was "let's the user know that the ticket was
filed by the conductor" — the human already knows when they filed a ticket themselves, and tagging
every card would make the signal that actually matters (this one is unusual) disappear into noise.

### Density is a `compact` prop on `DecisionCard`, not a second component

Considered a separate `CompactDecisionCard`. Rejected — the two would drift the way
`packages/render`'s TUI card table drifted from `NAMED_CARD_OPTION_KEYS` before VS-114; one component
with a density flag keeps the option keys, the answer semantics and the per-kind body content in one
place, and only the Tailwind classes branch on `compact`.

The compaction itself: card body padding `p-3.5` → `p-3`; the header row and inter-section margins
(`mb-3`, `mb-1.5`, `gap-2.5`) tighten by one step each; the action band keeps its 44px thumb height
(`h-thumb`) — captain is the one tapping these on a phone, and shrinking the actual tap target to
save vertical space would trade a readability complaint for an accuracy one — but its horizontal
padding and label text step down one size, which is most of what makes the buttons read as "too
large" without touching what a thumb has to land on. No field moves behind an expander.

### Two-cards-per-row: not built

Captain said "maybe" — permission, not a requirement — and the hard constraint is that it must never
apply at phone width and must not make a decision easy to mistake for its neighbour. A `plan_approval`
card (title, task list, plan preview, three actions) and a `merge_approval` card (CI stats, diff
stats, PR link, two actions) are different heights; a two-up grid either wastes the shorter card's
row or, at the width `Chat.tsx`'s message column actually has (`max-w-3xl`, itself inside the app's
main content column, not the full viewport), compresses both cards enough that picking the wrong
one's button is a real risk on the exact card type — a plan or merge approval — where a wrong tap has
the highest cost. The density change already delivers most of the requested "we can fit more" outcome
without that risk. Single-column stays.

## Risks / Trade-offs

- **A ticket with a stale or misleading summary reads worse than none.** `summary` is free text the
  author controls entirely; nothing enforces it stays true as the ticket's description or scope
  changes. Mitigated by the fact that it is optional-if-absent rendering (a card never fabricates
  one) and it is exactly as trustworthy as the title already is, which has the same property today.
- **Compacting a `concern`/`gate_finding` card, which can carry a long context body, risks feeling
  cramped even with the same content.** Verified in the real-browser pass (see PR) rather than
  assumed; `Markdown` content itself is untouched by the density change, only the chrome around it.

## Migration Plan

Additive only: one `ALTER TABLE tickets ADD COLUMN summary TEXT` migration (nullable, no default
needed beyond SQLite's implicit `NULL`), following the existing pattern
(`0017_ticket_landing_branch.sql` et al.). No backfill. Rollback is dropping the column, which no
other migration or code path depends on — reverting the code that reads/writes it is sufficient
without a down-migration, consistent with how this repo's other additive ticket columns are handled.
