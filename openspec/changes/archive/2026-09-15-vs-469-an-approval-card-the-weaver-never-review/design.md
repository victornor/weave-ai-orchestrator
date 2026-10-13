## Context

See `proposal.md` — Why. Four facts about the current code shape the approach:

- A review-carrying decision (`plan_approval`, `merge_approval`, `action_approval`) is woken for the
  weaver exactly once, at creation: `packages/core/src/decisions/service.ts:248-253` enqueues a wake
  keyed `decision-review:<id>`. Nothing re-wakes the weaver while the card stays `unseen`.
- `weaver_review_status` is the authoritative signal (`decisions.weaver_review_status`, default
  `'unseen'`, written only by `decisions.review()`); `answer()` refuses an approving answer while it
  is `unseen` (`service.ts:547-561`). Nothing else reads it, so a stuck card has no reader.
- The supervisor already has the shape a reminder needs: a 15 s `tick()` with a 60 s liveness block,
  and `meta`-backed `due()` throttles (`packages/core/src/supervisor/index.ts:122-152`). Its
  `conductorDigest()` (`index.ts:572-635`) builds the weaver's periodic digest as a plain
  `{since, events}` wake, and `approvalIntegrityScan()` (`index.ts:468-481`) is the closest precedent
  for a scan that wakes the weaver about approvals.
- The weaver reads open decisions twice: the digest wake, and the per-turn prompt's `## Open
  decisions` block (`packages/core/src/prompts/index.ts:341-366`), which lists every open decision in
  the workspace but does not say which are still unreviewed.

The UI already renders the unreviewed state: `weaverReviewCopy().awaitsReview`
(`packages/shared/src/weaver-review.ts:51-83`) is true for an open unseen card, both the V2 card
(`packages/ui/src/v2/DecisionCard.tsx:298-304,413-427,719-735`) and the V1 card the V2 ticket page
uses (`packages/ui/src/components/DecisionCard.tsx:98-108,625-655`) show the waiting line and
withhold Approve; `countsAsNeeds` (`packages/ui/src/v2/needsCount.ts:13-15`, VS-411) keeps an unseen
card out of the actionable count. The gap is not the card — it is that nothing re-wakes the weaver and
the ticket page's header reads only the ticket's status.

## Goals / Non-Goals

**Goals:**

- An open, human-owned approval that stays `unseen` re-wakes the weaver, names itself, and keeps doing
  so on a backoff until it is reviewed or closed — without stacking duplicate wakes.
- Every digest the weaver receives lists the unreviewed approvals as "not reviewed", and the
  per-turn prompt marks them too.
- Captain can see, on Needs you and on the ticket page, that a card is waiting on the weaver's review
  rather than on them — while the actionable badge rule (VS-411) is unchanged.

**Non-Goals:**

- Changing `countsAsNeeds` / VS-411, or making an unseen card actionable or badged.
- Adding the report-side decision list of change item 4 (see Decision 4).
- Changing the review write, the answer hold, or when a review is required.
- New config keys, schema, or migrations. The thresholds are constants, as the other supervisor
  cadences are.
- Any new V1 UI (`packages/ui/src/components/DecisionCard.tsx` is untouched; the V2 ticket page keeps
  using it).

## Decisions

### 1. A supervisor scan, keyed per (decision, backoff stage)

Add `reviewReminderScan()` to `packages/core/src/supervisor/index.ts`, run inside the existing 60 s
liveness block (next to `approvalIntegrityScan`). It selects open, human-owned, review-carrying
decisions whose `weaver_review_status = 'unseen'` and whose age has passed the first threshold, and
for each enqueues a system wake to the workspace weaver.

The wait between wakes is derived from the decision's age, not from stored state:

- first reminder at **10 minutes**;
- next at **40 minutes** (10 + 30);
- then every **60 minutes** (100, 160, 220, …).

`stage = age < 40m ? 0 : age < 100m ? 1 : 2 + floor((age - 100m) / 60m)`, and the wake carries the
idempotency key `review-reminder:<decisionId>:<stage>`. `wake.enqueue` Gate 0
(`packages/core/src/wake/index.ts:54-62`) returns the existing row for a live key, so one stage fires
at most one live wake; Gate 3 coalescing (`index.ts:79-99`) folds a concurrent reminder into any
already-queued weaver wake while preserving `{source, reason, payload}` (including `decisionId`) in
`payload.bundle[]`, which `flattenWakes` expands into the prompt. That satisfies both "repeat with
backoff" and "don't stack duplicate wakes for the same decision".

The scan stops by construction: the filter requires `status = 'open'` and
`weaver_review_status = 'unseen'`, so a mark, answer, supersede, withdrawal or expiry removes the
card from the result set. `owner = 'human'` excludes a card the weaver itself owns and answers.

*Alternatives rejected:* a `notBefore`-scheduled wake per card (Gate 3 can coalesce a future wake into
a queued one and lose the schedule — see [[run-engine]]; and a scheduled wake can outlive the card);
a `meta` row per decision recording the last reminder (leaks keys for closed decisions and duplicates
what the wakeups table already stores); waking on every supervisor tick without a stage key (stacks).

### 2. The digest carries a bounded `pendingReview` list, and the prompt marks the lines

`conductorDigest()` keeps its shape and adds a `pendingReview` array to the wake payload: for every
open human-owned review-carrying decision still `unseen`, `{decisionId, kind, ticketIdentifier,
ageMs}`. The digest's wake `reason` names them (e.g. `… 2 approval cards still not reviewed:
ACME-42 merge 3h, ACME-41 plan 12m`), so the weaver sees the list in the `## Why you were woken`
line without opening the payload. The list is bounded (a small fixed cap), as the digest's other
entries are.

The per-turn prompt's `## Open decisions` block is regenerated from the database every weaver turn
and is where the weaver actually reads, so the durable fix is there too: a line for a review-carrying
decision that is still `unseen` gains an explicit not-reviewed marker, distinct from a line for a
decision already marked or one of a non-carrying kind.

*Alternatives rejected:* the digest alone (it only fires when there are new events, so a card left
unseen with no further events never reappears in it); a second, dedicated "unreviewed" prompt section
(redundant with the list already there and one more thing to keep in sync — a marker on the existing
line carries the same information).

### 3. Keep VS-411's count; add the ticket page's waiting state

`countsAsNeeds` is unchanged: the shell/rail Needs-you figure counts only cards the human can act on,
and an unseen approval is not one. That is deliberate — the badge is a promise about action. So the
change makes the card *visible as waiting* rather than *counted*: the Needs you list keeps rendering
it (it already does), and the ticket page — which today reads only the ticket's status ("In review")
— shows the waiting-on-review state when the ticket's live open approval is unreviewed, in the same
terms the card uses, derived from the same open-decisions query the page already runs. Once the
weaver marks it looked-at with no concerns, or the card is answered, the waiting state goes.

The card requirement is already met by the shared copy and both card renderers; the change locks it
with tests and adds only the missing ticket-page state. No V1 card edit.

*Alternative rejected:* counting an unseen card in the badge (forbidden by the ticket's "keep VS-411's
badge rule", and it would promise an action the answer path refuses).

### 4. Change item 4 (a report claiming reviews it did not make) is not taken

The proposed mechanism is a self-reported, optional list of decisions on the weaver's final report,
checked against that run's `decision.review` rows. It is the wrong signal for this failure:

- The report is **self-reported and optional**. A weaver that believes it reviewed a card but never
  called the tool would have to list the card too, for the mismatch to be detectable; and the report
  itself may be absent (a run can end `empty`, and `collect_result` tolerates no report).
- Matching free text ("marked looked") is unreliable, which is why item 4's list is needed at all —
  and that list is exactly the thing being trusted.
- The authoritative outcome signal already exists. `weaver_review_status` records whether the review
  happened, regardless of what any summary says, and items 1–3 read it. They catch the *outcome* the
  ACME-77 incident produced — a card stuck unseen with nobody re-woken, counted, or told — with no
  self-report involved.

The ticket explicitly permits skipping this item with an argument in the design. If the *belief*
problem persists, the reliable follow-up is narrower and needs no report change: at finalize, note a
run that was woken to review a decision and ended with that decision still `unseen`. That reads the
wake payloads and the review column, never the agent's own account. It is left as a follow-up rather
than folded in here.

## Risks / Trade-offs

- **Reminder noise while the weaver is down or paused.** A paused weaver skips the wake (Gate 2) and
  the key is released, so the next stage re-enqueues on resume; the stage key bounds it to one live
  wake per stage. A weaver that is up but chooses not to review gets one reminder per stage, which is
  the point.
- **Digest / prompt growth.** `pendingReview` is capped like the digest's entries, and the prompt
  marker is a suffix on a line already present.
- **Prompt golden tests.** `packages/core/src/prompts` tests assert rendered lines; the marker
  changes lines only for unreviewed review-carrying cards, and those tests are updated with the
  change.
- **Ticket-page header vs the shared board status.** The waiting state is derived locally in
  `Ticket.tsx`; `ticketBoardStatus` / board columns are not changed, so Work and the board keep their
  existing meaning.
- **Scan cost.** One decision query per 60 s on `decisions(workspace_id, status)`, the existing
  `decisions_ws_status` index. No forge or network calls.

## Migration Plan

No schema or config migration. The scan and the digest list are additive; a decision created before
this change and still unseen begins reminding on the next scan, which is the desired repair. Rollback
is reverting the change; nothing persisted changes shape.

## Open Questions

None. Change item 4's disposition is decided above (skipped, with the reliable follow-up named).
