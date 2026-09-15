## Context

See `proposal.md` — Why. The constraints that shape the approach:

- CI data already exists on `tickets.delivery_json`, written by `packages/core/src/supervisor/index.ts`:
  `ciState`, `ciStateAt`, `ciHead`, `prChecks` (`{passed,total}`), `mergeState`, `mergeStateHead`,
  `isDraft`. A checks-only change already emits `ticket.updated` (supervisor lines ~925–928,
  ~1051–1059), which the UI turns into a `qk.ticket(ws,id)` / `qk.tickets(ws)` invalidation — so live
  update needs no new event, only a query the card subscribes to.
- The forge read (`GhForge.prState`, `packages/core/src/forge/gh.ts:236`) already parses the full
  `statusCheckRollup`; `pullRequestFromGh` derives `rollupState` and `checkTally` from it, and
  `toCheck` already maps a rollup entry to `{name,state,url}` for the PR detail view. `prState` only
  throws that detail away.
- The V2 card (`packages/ui/src/v2/DecisionCard.tsx`) receives only a `Decision` and does not read the
  ticket except for the held row (`useTicketFor` enabled only when `concerns && !inert`, line 341).
  The ticket page (`packages/ui/src/v2/ticket/Ticket.tsx`) still renders V1's
  `components/DecisionCard.tsx`.
- A decision row carries `weaver_reviewed_head_sha`; `tickets.noteHeldReviewHead`
  (`packages/core/src/tickets/service.ts:1169`) already compares the live delivery head against it,
  but only for open `merge_approval`s marked `concerns`.
- `weaverReviewCopy` (`packages/shared/src/weaver-review.ts`) is the single copy table shared by the
  web cards and `decisionToCard` (CLI/TUI).

## Goals / Non-Goals

**Goals:**
- One pure derivation for the CI chip, so the web card, the ticket page and `decisionToCard` all agree.
- One place that decides what the review line says, including `waitingOn`.
- The card reads already-recorded state and rides existing events; the daemon keeps doing the GitHub
  reads it already does.

**Non-Goals:**
- No new GitHub polling from the UI, and no new daemon polling loop.
- No change to how CI is evaluated or to the self-hosted-runner setup (`ci-workflow` is untouched).
- No change to the review/override gate: `waitingOn` is informational and gates nothing.
- No migration of the ticket page off V1's card.

## Decisions

### D1. Derive the chip in `@weave-ai/shared`, not in the card

A pure `ciChipCopy(delivery, { approvedHead })` returns `null` or `{ tone, line, detail }`, where
`tone ∈ {pending, passed, failed, skipped, stale}` and `detail` names the pending/failed checks. It is
unit-testable without a DOM, is reused by V2's card, V1's card and `decisionToCard`, and keeps the
"all-skipped is not a pass" rule in one place. Alternative: compute per-component — rejected because
the three surfaces would drift and the acceptance asks for a derivation test.

### D2. Persist per-check detail and the current head; leave the tally

`ForgeAdapter.prState` gains `checkDetails: Array<{name, state}>` (built from the same rollup, via the
existing `toCheck`); the supervisor writes it to `delivery_json` as `ciChecks` alongside the existing
`ciState`/`prChecks`. `pr.headSha` is written as both `ciHead` (the head the rollup describes) and
`prHead` (the head the card is approving). The tally stays, so nothing that reads `prChecks` breaks.
Alternative: a second forge call for names — rejected, it is the same JSON.

### D3. "The head the card approves" is the current delivery head; staleness compares `ciHead` to it

The card approves the pull request's current head, recorded as `prHead`. `ciHead` is the head the
recorded rollup describes. `ciChipCopy` returns `stale` when both are present and differ. This is a
judgement call (the ticket does not define the approved head): the alternative — comparing `ciHead` to
the review's `weaverReviewedHeadSha` — would make an unreviewed card unable to show staleness at all,
and the requirement wants staleness to hold on every card. The daemon advances `ciHead` only when the
rollup actually changes, so the window where `ciHead` trails `prHead` is real but short; the derivation
is still exercised by the unit test with a synthetic delivery. `ciState === 'none'` with no tally
shows no chip, so "CI has not started for the new head yet" is not mistaken for stale.

### D4. `waitingOn` lives on the decision row, is set only by a review mark, and is cleared by the
existing head reconciliation

Migration adds `decisions.weaver_review_waiting_on TEXT`. `weave_decision_review` gains
`waitingOn?: string` (≤120); `decisions.review()` stores it, or `null` when absent, so a re-mark always
replaces the previous statement. Clearing on head move is folded into the existing turn-end/reconcile
delivery-head check (`noteHeldReviewHead`): it is widened to clear the waiting statement on any open
`merge_approval` whose reviewed head moved, while the concern wake stays exactly as it is (only for
`concerns`). Supersession already raises a fresh decision row, so a plan revision clears it for free.
Alternative: a separate sweep — rejected as more moving parts for the same signal.

### D5. The cards take the ticket's delivery as a prop; callers already hold it

Needs you (`useTicketsMany`) and the chat pane (`ticketsById`) already load the ticket rows, which
carry `delivery`; the ticket page holds the whole ticket. Add an optional `delivery` prop to both card
components and pass it from those three call sites, so no extra query is introduced and the existing
`ticket.updated` invalidation drives the live update. `useTicketFor` stays exactly as it is (held row
only). Alternative: have the card fetch the ticket itself — rejected, it forces one request per card in
Needs you where the rows are already loaded.

### D6. The ticket page's merge card is shown the chip too, with the smallest possible V1 edit

`packages/ui/src/components/DecisionCard.tsx` renders only when the ticket page (a V2 route) uses it, so
edit it — adding the chip and the `waitingOn` line — rather than migrating the page's card or
duplicating the markup in `Ticket.tsx`. Captain asked for the ticket page explicitly, which the
standing "no new V1 UI work" decision excludes from its own rule. Alternative: render the chip in
`Ticket.tsx` around the card — rejected as copy that would drift from `weaverReviewCopy`/`ciChipCopy`.

### D7. `waitingOn` renders from the shared copy, so CLI/TUI get it too

`WeaverReviewCopy` gains `waitingOn: string | null`, and `decisionToCard` emits a `Review — waiting on
…` body line. This keeps the TUI/CLI honest for free and gives the card a single string to render.

## Risks / Trade-offs

- **[New `prState` field breaks a fake]** → The `ForgeAdapter` interface and `fakes.ts` grow the same
  optional field; the supervisor only reads it with `?? null`.
- **[Staleness rarely fires in production because `ciHead` is refreshed each poll]** → Accepted; the
  state is a correctness guard (never show a tally for a different head), and the derivation is
  unit-tested. Reported in the PR as a known narrow window.
- **[Per-card CI state on many Needs-you cards increases render work]** → The data is already in the
  loaded ticket rows; the chip is a pure function of that data, no extra request.
- **[Two card components to keep in step]** → Both render from `ciChipCopy`/`weaverReviewCopy`; a
  shared UI test asserts both surfaces show the same chip for the same delivery.

## Migration Plan

- Migration `0043_decision_review_waiting_on.sql` adds one nullable column; existing rows read `null`
  and behave exactly as before. No backfill.
- `delivery_json` gains fields only; readers use optional access, so old rows are unchanged.
- Rollback is dropping the column/fields; nothing depends on them for correctness (the chip is
  display-only, the gate never reads `waitingOn`).

## Open Questions

(none — the two judgement calls that could have been questions are settled in D3 and D6 and stated so
in the PR.)
