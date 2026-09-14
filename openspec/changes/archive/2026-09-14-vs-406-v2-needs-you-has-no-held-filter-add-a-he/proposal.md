# V2 Needs you gets the Held filter

Tracker change for [VS-406](weave://tickets/VS-406). A `task` ticket, so this change carries
tasks only — `skip_specs: true`.

## Why

The V2 Needs you screen (`packages/ui/src/v2/NeedsYouPage.tsx`) builds its kind chips from the
decision kinds actually present (`KIND_LABEL` / `kindsPresent()`). The design's filter row reads
`Everywhere / Acme / Held / Plans / Merges / Actions` — a `Held` chip the screen never renders, so
there is no way to narrow the list to the decisions the weaver is holding under concerns.

## What changes

- **A `Held` chip** is added to the Needs you filter row, after the scope chips and before the kind
  chips, reusing the existing `Chip` component. It is always shown, even when nothing is held.
- **What it filters:** only open decisions whose `weaverReviewStatus === 'concerns'`. It combines
  with the scope chips and is mutually exclusive with the kind chips — selecting `Held` clears the
  kind selection and selecting any kind (`All` included) clears `Held`, so the whole row is one
  selection across `{Held, kind…}`.
- **The empty state:** with `Held` active and nothing matching, the body says nothing is held,
  rather than falling through to the generic "Nothing in this filter." copy.
- **Phone:** the same chip renders in the same responsive, wrapping filter row; there is no separate
  phone component.
- **Tests** in `packages/ui/src/test/v2needs.test.tsx`: only concerns-marked decisions show; the
  filter combines with a workspace scope chip, including a decision carrying the internal workspace
  id; `Held` and the kind chips are mutually exclusive; the held empty state shows and the chip
  stays visible.

## Out of scope

The design's chip row has no `All` chip and no separator; this change keeps both, adding `Held`
only. No change to `Chip`, `V2DecisionCard`, or the decision data model.
