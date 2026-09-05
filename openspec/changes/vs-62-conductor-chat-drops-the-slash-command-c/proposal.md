# Conductor chat drops the slash commands and the `/brief` label

Tracker change for [VS-62](conductor://tickets/VS-62). A `task` ticket, so this change carries
tasks only — `skip_specs: true`.

## Why

The workspace owner asked for the `/talk ACME-42`, `/conductor` and `/d <id> approve` chips under
the conductor composer and the `/brief` label in the header to go: the label names a command the web
app never implemented, and the chips advertise a text syntax for three things the page already does
with a click.

Every command the chips advertise is pure navigation with a visible equivalent on the same screen:

- `/talk <ticket>` called `openTicket`, which is what a ticket chip in the transcript, the sidebar
  and the board already do (`packages/ui/src/routes/Chat.tsx:334`).
- `/conductor` navigated to the team page, which is a sidebar entry.
- `/d <id> approve` answered a decision, which every decision card in the chat does with its own
  buttons (`Chat.tsx:360`, `Chat.tsx:409`).

None of it is a spec'd behaviour: no capability under `openspec/specs/` mentions the chips, the
commands or the label.

## What changes

- The three `CommandChip`s under the composer and the `/brief` header `actions` span are removed
  from `ChatRoute`. The composer and the header keep everything else.
- The client-side slash parsing in `send()` goes with them: with the chips gone nothing advertises
  the syntax, and each command's destination is one click away. A message beginning with `/` is now
  sent to the conductor like any other text.
- `CommandChip` had no other caller, so it is removed from `packages/ui/src/components/Chips.tsx`,
  and the design contract's component list stops naming it.

The channel surfaces are untouched: Telegram (`packages/server/src/channels.ts`) and the TUI
(`packages/tui/src/apps/Chat.tsx`) keep `/talk`, `/conductor` and `/d`, where a text command is the
only way to reach a ticket thread.

## Out of scope

Redesigning the chat header or composer.
