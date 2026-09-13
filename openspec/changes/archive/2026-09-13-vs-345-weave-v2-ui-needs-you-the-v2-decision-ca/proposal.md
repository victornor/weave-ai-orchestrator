## Why

V2 (`/v2`, VS-343) ships the shell, theme, rail and a route with a header for every destination,
but every screen body is still a placeholder. The decision card and the worker live feed are the
two pieces the rest of the V2 screens consume — Chat, Roles and Live all embed them, and Needs you
is built entirely from them — so they come first or those tickets each invent a private copy and
drift. The design contract for them is HANDOFF.md §6 and §15, with the screen and card variants in
`docs/design/v2/Screens.dc.html`.

## What Changes

- **The V2 decision card** (`§6`): the full answerable card, not a summary that punts to chat. A
  neutral header (no status glyph; `Needs you` / `Worker question` plain text), the ticket,
  project and review state on the card, the plan/action document and any artifact the ticket has,
  options, free text, and every input kind VS-342 added (`single_choice` with its recommendation,
  multiselect, text, secret), plus relayed answers.
- **The held state**: the weaver's concern in its own words, a `Revision in progress · Nm` row with
  a pulsing dot and a **Watch** toggle, Approve disabled with `Override…` beside it and
  "Approval is blocked until a revision lands.". Override opens a **required** reason field, states
  that the reason is recorded and the weaver stands down, and offers "Override and approve" through
  the existing `overrideHold` / `overrideReason` answer fields.
- **A narrow-pane variant** for the chat pane carrying the same anatomy plus a work-product link and
  "Ask the worker".
- **The shared compact live feed**: one component that shows a worker's current run (the run event
  stream, its activity and trace) with a compact variant, so Live, Roles, Chat and the card's Watch
  toggle all import the same thing. Watch expands it in place with its own toggle state per card.
- **The global Needs you screen at `/v2/needs`**: open human decisions from every workspace, with
  scope filters (`Everywhere · each workspace`) leading the filter row, decision-kind chips after
  them, both filtering for real, and header counts derived from the same query the list renders. The
  workspace Needs you shortcut opens this screen with its scope pre-applied, as VS-343 wired it.
- **Frontend only.** No daemon, API or migration change. Data comes from the existing
  `packages/ui/src/api/**` hooks and `@weave-ai/shared` helpers; V1 at `/` is untouched.

## Capabilities

### New Capabilities

- `web-v2/decision-card`: the complete answerable V2 decision card — its header and meta, review
  states, every card kind and input, the held state with its reasoned override, artifact
  reachability, and the narrow-pane chat variant.
- `web-v2/live-feed`: the shared worker live feed — the one component Live, Roles, Chat and the
  Watch toggle render, its compact variant, and its independent per-card expansion state.
- `web-v2/needs-you`: the global Needs you screen at `/v2/needs` — its scope and kind filters, the
  one-source counts behind its header and list, and the workspace shortcut's pre-applied scope.

### Modified Capabilities

_None. V2 is additive; the VS-343 shell keeps its behaviour and V1 is unchanged._

## Impact

- **New:** `packages/ui/src/v2/DecisionCard.tsx` (and its input/held sub-components),
  `packages/ui/src/v2/WorkerFeed.tsx`, `packages/ui/src/v2/NeedsYouPage.tsx`, plus the small helpers
  they need. New UI tests under `packages/ui/src/test/`.
- **Modified:** `packages/ui/src/v2/pages.tsx` (the `V2NeedsPage` placeholder becomes the real
  screen; `V2ChatPage` may render the narrow variant as its own content is out of scope).
- **Reused, not forked:** `packages/ui/src/api/**` (`useDecisionsMany`, `useAnswerDecision`,
  `useRunEventStream`, `useRuns`, `useWorkers`, `useTicketWorkProducts`), `lib/durableQueue`,
  `lib/decisionSecrets`, `lib/decisionStaleness`, and the shared `weaverReviewCopy`,
  `documentTarget`, `NAMED_CARD_OPTION_KEYS`.
- No HTTP route, MCP tool, CLI command, database migration or daemon change.
