# Tasks — VS-406

## 1. The Held chip

- [x] 1.1 In `packages/ui/src/v2/NeedsYouPage.tsx`, add a `Held` chip to the filter row after the
      scope chips and before the kind chips, through the existing `Chip` component, always shown.
- [x] 1.2 A `heldOnly` filter: with it active, the list shows only decisions whose
      `weaverReviewStatus === 'concerns'`; it combines with the scope chips.
- [x] 1.3 Mutual exclusion with the kind chips: selecting `Held` clears the kind selection, selecting
      `All` or any kind clears `Held`, so one selection covers `{Held, kind…}`.
- [x] 1.4 With `Held` active and no match, the body shows a held empty state ("nothing is held"),
      not the generic filter copy.

## 2. Tests

- [x] 2.1 `Held` shows only concerns-marked decisions.
- [x] 2.2 `Held` combines with a workspace scope chip, including a decision carrying the internal
      workspace id.
- [x] 2.3 `Held` and the kind chips are mutually exclusive (either direction).
- [x] 2.4 The empty state shows nothing is held, and the chip stays visible with no held decisions.

## 3. Verify

- [x] 3.1 `pnpm lint`, `pnpm typecheck` green.
- [x] 3.2 Both suites run and pasted verbatim.
- [x] 3.3 Rendered check on an isolated scratch daemon (`eval "$(scripts/scratch-daemon.sh env)"`),
      with a held decision and an unheld one, desktop and phone, dark and light, compared against
      `34-needs-you-held-filter.png` and `02-needs-you.png` in
      `Weave Control Plane Redesign/shots/<mode>/`.
