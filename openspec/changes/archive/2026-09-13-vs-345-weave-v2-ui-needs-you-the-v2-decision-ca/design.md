## Context

See `proposal.md` - Why. V2 (VS-343) is a parallel frontend under `packages/ui/src/v2/`, lazily
mounted at `/v2` in `packages/ui/src/router.tsx`, with its own Mono tokens scoped to `.v2-root` and a
destination registry in `v2/nav.ts`. `V2Page` and the per-destination pages in `v2/pages.tsx` are
placeholders that screen tickets replace.

The data it needs already exists in V1 and is reused, not forked:

- `api/hooks.ts`: `useDecisions` / `useDecisionsMany` (open human decisions, per workspace),
  `useAnswerDecision` (with `overrideHold` / `overrideReason`), `useRuns`, `useWorkers`,
  `useTickets`, `useProjects`, `useWorkspaces`, `useWorkspaceProjects`, `useTicketWorkProducts`.
- `api/runStream.ts`: `useRunEventStream(runId, { live, newest, ws })` — persisted events merged with
  the SSE tail.
- `api/context.tsx`: `useHookWs` resolves a workspace for a hook rendered outside a workspace route.
- `@weave-ai/shared`: `Decision`, `DecisionInput`, `DecisionAnswerInputs`, `weaverReviewCopy`,
  `documentTarget`, `NAMED_CARD_OPTION_KEYS`, `decisionUiStatus`.
- `ui/lib`: `decisionSecrets`, `decisionStaleness`, `yolo`, `durableQueue`, `projectColor`.

V1's `components/DecisionCard.tsx` and `routes/GlobalNeeds.tsx` already implement this behaviour for
V1's visual language; V2 must not change V1 at `/`, so V2 gets its own components that reuse the
same hooks and shared helpers. `components/RunTranscript.tsx` (which wraps `Transcript` +
`useStickToBottom`) is V1's bounded transcript renderer and is a legitimate thing for a V2 feed to
render through — it is presentational and not V1-specific.

## Goals / Non-Goals

- Goal: the V2 decision card, the shared compact worker feed and the `/v2/needs` screen, all
  frontend-only and all reachable from the VS-343 shell.
- Goal: one feed component every V2 surface imports, so Live/Roles/Chat do not each re-implement the
  run-event stream.
- Non-goal: the chat pane layout, the Live screen grid, Roles and the ticket page. This ticket builds
  the pieces they consume; their screens are their own tickets.
- Non-goal: any daemon, API, migration or V1 change.

## Decisions

### A V2 card component, not a reskin of V1's

V1's `DecisionCard` is 749 lines of the V1 design language (status glyphs, pills, `StatusGlyph`).
V2's card has a different anatomy (no status glyph, bordered tags, the held row, the narrow variant),
so it is a new component in `v2/DecisionCard.tsx`. It reuses the shared logic — `weaverReviewCopy`,
`documentTarget`, `initialInputValues` behaviour, the answer payload shape and
`NAMED_CARD_OPTION_KEYS` — by importing them, not by copying. V1's component and its tests are left
untouched.

_Alternative considered:_ add a `variant="v2"` prop to V1's card. Rejected: it would put V2's tokens
inside a V1 component and risk V1 regressions, against VS-343's isolation rule.

### The feed resolves a worker's run from `askedByAgentId`, then streams it

A held decision names the worker that asked (`askedByAgentId`) and the run it asked in
(`askedInRunId`). After a revision request a new run starts, so the feed resolves the worker's
**current** run: the active run from `useRuns({ status: 'running' | 'queued' })`, else the newest run
from `useRuns({ limit })`, falling back to `askedInRunId`. This is the same predicate V1's LiveCell
uses; it is factored into `v2/WorkerFeed.tsx` as `useWorkerRun`. The feed then calls the existing
`useRunEventStream` and renders through `RunTranscript` (or `Transcript`) so authored indentation and
stick-to-bottom behave as on Live.

_Alternative considered:_ stream `askedInRunId` only. Rejected: it goes stale the moment a revision
run starts, which is exactly when Watch is offered.

### Watch state is local to the card

`watchOpen` is component state on the card, so each card's Watch is independent and nothing is
persisted. Only one card opens a run-event stream per Watch — the stream hook only activates when the
feed is mounted, so a collapsed card opens no EventSource.

### Override reuses the existing answer fields

No new endpoint: Override submits the card's approving option with `overrideHold: true` and
`overrideReason: text`, exactly the shape `useAnswerDecision` and the answer route already accept.
The reason field is the card's existing composer-style input; "Override and approve" is disabled
until the reason is non-empty.

### Needs you counts are computed once from the query result

The page fetches `useDecisionsMany(all workspace ids, { status: 'open', owner: 'human' })` and derives
one filtered array from it; the header count and the rendered cards both read that same array. Scope
and kind are local state. The scope starts from `useV2Scope()`: `/v2/w/:ws/needs` opens on that
workspace, `/v2/needs` on Everywhere. This keeps VS-343's rail highlighting and scope rule intact
(the `ws-needs` row points at `/v2/w/$ws/needs`).

### Artifacts come from the ticket's work products

A decision names its ticket; the card reads `useTicketWorkProducts(ticketId)` and links the first
`type: 'artifact'` product through the existing ticket-artifact route. The query is only issued when
the decision has a `ticketId`.

## Risks / Trade-offs

- **[Extracting the feed is not required this ticket]** → Build the shared component in `v2/` and
  render it from the card now; the V2 Live/Roles/Chat tickets import it when built. V1's LiveCell is
  not refactored, so no V1 regression risk.
- **[The card duplicates V1 logic]** → Only the answer/validation logic is shared by import; the
  visual tree is V2's by design. The shared helpers (`weaverReviewCopy`, `documentTarget`) are the
  single source of truth for review copy and document targets.
- **[Secret inputs cannot be tested against a live daemon]** → Follow V1: assert the masked field and
  the `secretName` submission against the mocked answer mutation, not a real credential.
- **[Needs you becomes expensive with many workspaces]** → Same shape as V1's `GlobalNeeds`
  (`useDecisionsMany` fan-out, one query per workspace), which already ships; no new cost pattern.

## Migration Plan

Frontend-only and additive. No data migration, no deploy step beyond the daemon's normal UI build.
Rollback is reverting the V2 module; V1 is unaffected either way.

## Open Questions

_None that change the specs, approach or task breakdown. The chat pane layout is explicitly another
ticket; this ticket ships the narrow variant as a component other tickets embed._
