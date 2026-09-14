# V2 dark-mode Approve: near-white when ready, grey when blocked

Tracker change for [VS-422](weave://tickets/VS-422). A `task` ticket, so this change carries tasks
only — `skip_specs: true`.

## Why

VS-418 made an available Approve "the decision card's call to action": `.v2-button[data-variant='primary']`
fills with `--approve`, and the ready/blocked state is marked with `data-approve`. In light mode the
deep green (`#15803d`, white ink) is exactly what captain wants. In dark mode the green (`#34d399`,
dark-green ink) is the only green on a greyscale Mono surface and looks out of place (captain,
2026-09-14). Captain wants the dark ready button almost white — the strongest, most clickable thing
on the card — and a visibly greyer fill when approval is blocked.

`--approve` is also the colour of the "✓ Weaver reviewed — no concerns" line (`text-approve`, VS-418),
which must stay green. The two uses are split: `--approve` becomes the Approve button fill, and the
review line gets its own positive token.

## What changes

- **`--approve` / `--approve-ink` (dark only)** become the near-white fill (`#f2f3f5`, the theme's
  `--text-strong`) and near-black ink (`#0b0b0d`). That is ≈18:1, so the ready Approve is
  unambiguously the primary control. Light keeps `#15803d` / `#ffffff`.
- **New `--approve-blocked` / `--approve-blocked-ink` (dark)** give a blocked Approve a mid-grey
  fill (`#3d4148`) with muted ink (`#c6cad1`): clearly greyer and lower-contrast than ready, still
  visible, and it stays `disabled`, so `.v2-button:disabled`'s dimming keeps it reading as not
  clickable.
- **New `--review-clean`** (dark `#34d399`, light `#15803d`) carries the review-clean green;
  `DecisionCard`'s review line uses `text-review-clean`, so the near-white `--approve` can no longer
  reach it. The line's rendered colour is unchanged in both themes.
- **`packages/ui/src/v2/v2.css`**: the dark-scoped rule
  `.v2-root:not([data-theme='light']) .v2-button[data-approve='blocked']` (the attribute VS-418
  already sets) paints the blocked fill. Light matches no new rule, so it is untouched.
- **`packages/ui/src/index.css`** maps `--color-review-clean: var(--review-clean)`.
- **Tests:** `v2theme.test.ts` pins the dark ready and blocked token values (ready ≠ blocked, ready
  is near-white); the VS-418 review-line assertion moves to `text-review-clean`.

## Out of scope

Card layout and type (VS-418). No V1 change (every rule is rooted at `.v2-root` / `.v2-button`). The
Discard button and the neutral secondary buttons are unchanged.
