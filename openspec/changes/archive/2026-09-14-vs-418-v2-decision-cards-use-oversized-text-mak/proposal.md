# A compact V2 decision card

Tracker change for [VS-418](weave://tickets/VS-418). A `task` ticket, so this change carries tasks
only — `skip_specs: true`.

## Why

Captain (2026-09-14): the V2 decision card's text is too large and pushes its buttons out of view,
especially in the chat decision pane, which is only 300–560px wide. VS-414 fixed the clip
(`shrink-0`, a real card border); it did not touch the type scale.

`packages/ui/src/v2/DecisionCard.tsx` renders its title at `text-head` (16px), a full step above the
design reference, which uses 14px in the chat pane and 15px on Needs you (`docs/design/v2/Screens.dc.html`).
Section gaps are set generously (`mb-3`, `gap-3`, `p-3.5`) so a question carrying options, a
single-choice group and a multiline input runs long even though the pane scrolls.

## What changes

- **The title drops to a compact token**, `text-head` → `text-ui` (16px → 13px), with a tighter
  `mb-1`. Both the `narrow` (chat pane / phone inline) and wide variants.
- **Body, choice, input-label and input text all sit on V2's compact scale** — `text-meta`,
  `text-micro`, `text-nano` — with no one-off pixel sizes; the context body drops `leading-relaxed`
  for the token's own line-height.
- **Vertical rhythm tightens**: section gaps `mb-3` → `mb-2`, the inputs group `gap-3`/`p-3` →
  `gap-2`/`p-2.5`, option and single-choice rows `p-2.5`/`p-2` → `p-2`/`p-1.5`, header and body
  padding come in a notch, and text inputs go `h-9` → `h-8`. Buttons keep their height and text
  (they were already at the design's size).
- **A regression test** in `packages/ui/src/test/v2decisions.test.tsx` asserts the compact title and
  body token classes on both the wide and the narrow card.

## Out of scope

Card border and clipping (VS-414), the Watch preview (VS-409), and card content or answer behaviour.
