## Why

The project overview renders every section's full list with no height limit. `grep` for
`max-h-`/`maxHeight` across `packages/ui/src/routes/project/` returns nothing today. A project with
real history or many pull requests makes the page enormous, pushing every section below it out of
reach. Captain asked for the data-heavy sections — History, Pull requests, and any other section
whose height grows with the amount of data — to cap their height and scroll inside instead.

## What Changes

- The section shell (`ProjectSection` / `PROJECT_SECTIONS` in `packages/ui/src/routes/project/sections.tsx`)
  gains a per-section `scrollable` flag. A scrollable section's body is capped at a height expressed
  relative to the viewport (`--ac-app-h`, the same custom property `RunTranscript` and `Sheet` already
  cap against) and scrolls internally past that cap; a section under the cap renders at its natural
  height, since `max-height` + `overflow-y-auto` only engages once content exceeds it.
- The cap uses plain `overflow-y-auto` (default `overscroll-behavior: auto`), not the codebase's
  `.ac-scroll` utility — `.ac-scroll` sets `overscroll-behavior: contain`, which is exactly what would
  trap wheel/swipe scrolling inside the section instead of letting it continue to the page.
- Every section marked `scrollable` picks it up automatically; nothing per-section changes beyond the
  flag. The existing global `::-webkit-scrollbar` styling (a visibly themed thumb) is the only
  affordance used to signal more content below the fold — nothing new is invented.
- `Needs you`, `Work under way`, `Landing`, `History`, `Pull requests`, `Recent landings` and
  `Knowledge` are marked scrollable: each renders its full fetched list with no built-in limit, so
  each can grow arbitrarily tall. `Activity` is left alone: it already slices to a fixed `SHOWN = 12`
  entries in `ActivitySection.tsx`, independent of how much changelog data exists, so it cannot
  balloon and gains nothing from a scrollbar.
- The collapse/expand disclosure and the two-column desktop grid are unchanged; the cap applies only
  to the body of an already-open section.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `project-overview/reserved-sections`: the shared section contract every section is rendered
  against gains a height cap for sections whose content grows with data, with the scroll it opens
  never trapping the page's own scroll.

## Impact

- `packages/ui/src/routes/project/sections.tsx` — `ProjectSectionDef`, `PROJECT_SECTIONS`, `ProjectSection`.
- No API, data-fetching or route changes. Purely presentational.
