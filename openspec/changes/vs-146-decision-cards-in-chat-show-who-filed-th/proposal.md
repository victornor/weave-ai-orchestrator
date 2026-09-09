## Why

The conductor files tickets on its own initiative, and the decision card that later asks captain to
approve one of those tickets' plans gives no signal that the ticket wasn't captain's own request —
VS-145 landed as an unexplained approval card and captain had to ask what it was. Separately, a plan
approval's context is the ticket's full markdown description, so deciding without opening the ticket
means deciding blind; and captain, who runs the conductor chat on a phone constantly, finds the
current cards taller and more button-heavy than the information on them needs.

## What Changes

- A decision card in the conductor chat's decisions list, when it concerns a ticket the conductor
  filed on its own (`ticket.createdByKind === 'agent'`), shows a small "Filed by conductor" tag.
  A human-filed ticket gets no tag — the common case stays quiet.
- A new nullable, one-line `Ticket.summary` field: settable when a ticket is created
  (`ac_ticket_create`, `POST /tickets`) and editable afterwards (`PATCH /tickets/:id`,
  `conductor ticket set --summary`), so a ticket created before this ships can still get one. A
  `plan_approval` card shows it, when present, as a one-line reminder of what the ticket is for,
  directly under the title. A ticket with no summary shows no line — never a truncated heading or a
  fragment of a quote.
- Decision cards in the conductor chat's decisions list (pinned-open and answered-in-conversation)
  render measurably more compactly: less padding, tighter vertical gaps, a smaller button footprint,
  with every field the card shows today still shown — no expander, no hidden information. This
  applies to the conductor chat only; `Needs you` and any other surface that renders a decision card
  is unchanged.
- Two-cards-per-row is evaluated and **not** built: it risks making a decision easy to mistake for
  its neighbour, which is a worse failure than a taller single column, and it must never apply at
  phone width regardless. Single-column is kept, and the reasoning is recorded in `design.md`.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `human-decisions/option-cards`: a decision card that concerns a ticket the conductor filed on its
  own initiative shows a provenance tag; a `plan_approval` card shows the ticket's one-line summary
  when the ticket has one (and the API surface that lets that summary be set, at creation or later);
  the conductor chat's rendering of a decision card is more compact than other surfaces that render
  the same card, with no information removed.

## Impact

- `packages/shared/src/types.ts` (`Ticket.summary`), `packages/db` (new migration adding the
  column), `packages/core/src/api.ts` and `packages/core/src/tickets/service.ts`
  (`TicketCreateInput`, `create`, `update`), `packages/server/src/routes/tickets.ts` (`CreateSchema`,
  `PatchSchema`), `packages/server/src/tools.ts` (`ac_ticket_create`), `packages/cli/src/commands/ticket.ts`
  (`ticket create --summary`, `ticket set --summary`).
- `packages/ui/src/components/DecisionCard.tsx` (provenance tag, summary line, `compact` prop),
  `packages/ui/src/routes/Chat.tsx` (both call sites pass the new props; `Needs you` is untouched).
- No database data migration: existing tickets simply have `summary = NULL` and their cards show no
  why-line until someone sets one.
