# V2 decision cards don't disappear after answering

Tracker change for [VS-369](weave://tickets/VS-369). A `task` ticket, so this change carries tasks
only — `skip_specs: true`.

## Why

Captain answered a V2 decision card and it stayed on screen; a second click reported "already
answered". The answer had been recorded, so the card was stale, not the request. Only the answer
mutation's refetch could remove it, and nothing removed it optimistically, so a failed, slow or
skipped refetch left the card behind. The same shape let a double click post twice, and a
`wrong_status` refusal was shown as an error rather than as the closed decision it means.

## What changes

- `useAnswerDecision` (`packages/ui/src/api/hooks.ts`) removes the answered decision from every
  cached open-decisions list at once, before the request settles, and restores the card if the
  answer fails for any reason other than the decision being closed.
- Lists that keep answered decisions on purpose (V1 chat's `['open', 'answered']` timeline) are left
  untouched, so V1 is unchanged.
- A `wrong_status` refusal is treated as a closed decision: the card stays gone, any replacement the
  refetch returns is shown, and V2 does not surface it as an error.
- One POST per decision while a submit is in flight, so a double click cannot answer twice.
- A held card's refusal (`revision_pending`, concerns or unreviewed) still restores the card and
  shows its message.

## Out of scope

No API change. V1's decision cards, toasts and list keys are untouched. The V2 ticket page keeps
V1's `DecisionCard` and its `AnswerError`; only the shared hook's removal reaches it.
