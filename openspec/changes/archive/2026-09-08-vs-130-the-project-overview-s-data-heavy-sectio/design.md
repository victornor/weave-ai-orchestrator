## Context

`packages/ui/src/routes/project/sections.tsx` defines `ProjectSection`, the shared shell every
section body renders inside (heading, disclosure, anchor), and `PROJECT_SECTIONS`, the ordered list
of section definitions `ProjectOverview.tsx` maps over. No section body currently limits its own
height; each renders every item its query returned. See `proposal.md - Why` for the motivating
complaint.

The codebase already has a convention for viewport-relative height caps: `--ac-app-h` (set by
`packages/ui/src/lib/viewport.ts` on `document.documentElement`, defaulting to `100dvh`) is what
`RunTranscript.tsx` (`max-h-[calc(var(--ac-app-h)*0.5)] md:max-h-[calc(var(--ac-app-h)*0.6)]`),
`Sheet.tsx` (`max-h-[calc(var(--ac-app-h)*0.7)]`) and `Composer.tsx`'s textarea already cap against.
It tracks the real visible region, including the on-screen-keyboard shrinkage those components
already had to solve, so a cap built on it is correct on a phone for free.

The codebase also has a `.ac-scroll` utility (`index.css`) that pairs `overflow-y: auto` with
`overscroll-behavior: contain`, used by `Sheet` and `Composer` where trapping scroll on purpose is
correct (a modal's own content shouldn't drag the page behind it). Acceptance criterion 3 asks for
the opposite here — reaching the end of a section's content must continue scrolling the page — so
this change cannot reuse `.ac-scroll` and must apply `overflow-y-auto` without `overscroll-behavior:
contain`.

## Goals / Non-Goals

**Goals:**
- Cap every section whose body has no built-in limit on how much it renders, at a viewport-relative
  maximum, without touching what any section shows or how it fetches data.
- Reuse the codebase's existing viewport-cap and scrollbar-affordance conventions rather than adding
  new ones.

**Non-Goals:**
- Changing the desktop two-column grid, the collapse/expand mechanism, or any section's data or
  markup beyond wrapping its scrollable body.
- A per-section cap value tuned to that section's typical content. One constant is used everywhere a
  cap applies; the per-section decision is binary (capped or not), not sized.

## Decisions

**Where the cap is applied — the shared shell, not each section body.** `ProjectSectionDef` gains a
`scrollable: boolean` field; `ProjectSection` (the shell) applies the cap classes to the body wrapper
`div` it already owns when the section is both `open` and `scrollable`. A section body never has to
know it is capped. Alternative considered: cap inside each section's own root `div`. Rejected —
seven of eight sections would need the identical two classes hand-copied into their JSX, exactly the
kind of drift `ProjectSection`'s doc comment (`sections.tsx:1-8`) already warns against ("a section is
presented the same way... supplies only its content").

**Cap value: `calc(var(--ac-app-h) * 0.4)`, uniform across every scrollable section.** 40% of the
visible region keeps several rows on screen — enough that a short list never looks awkwardly
truncated — while still holding the total page to roughly two sections' worth of height per screen
on a phone, which is the compactness captain asked for. The three existing precedents (`Sheet` 70%,
`RunTranscript` 50–60%, `Composer` a `min()` capped at 35%) size a single dominant region; nothing in
this codebase already answers "how tall should one card among many be", so 0.4 is a new but
consistent choice, stated here rather than picked ad hoc during apply. No `md:` variant: unlike
`RunTranscript`, which is the one thing on a screen, an overview section shares the screen with
several siblings at every breakpoint, so there's no reason for its share of the viewport to change at
the desktop breakpoint.

**No `overscroll-behavior: contain`.** Plain `overflow-y-auto` is applied directly rather than via
`.ac-scroll`, specifically to leave `overscroll-behavior` at its default `auto`, which is what lets a
wheel or swipe continue past a capped section's boundary into the page (criterion 3). Using
`.ac-scroll` here would silently reintroduce the trapped-scroll behavior it exists to provide
elsewhere.

**The visual affordance for "more below" is the existing themed scrollbar, nothing new.** `index.css`
already themes `::-webkit-scrollbar`/`::-webkit-scrollbar-thumb` globally with a visible, colored
thumb — every `overflow-y-auto` region in the app already gets this for free. No gradient-fade mask
or "N more" footer exists anywhere in `packages/ui` to imitate, and the ticket says not to invent
one, so the cap classes alone are the whole implementation of criterion 4.

**Which sections are `scrollable: true`.** A section qualifies if its body renders every item its
query returns with no fixed slice: `needs` (`NeedsYouSection`), `work` (`WorkSection`), `landing`
(`LandingSection`, the merge queue), `history` (`HistorySection`), `pulls` (`PullRequestsSection`),
`landings` (`LandingsSection`). `activity` (`ActivitySection`) is the one exception: it already
slices to `entries.slice(0, SHOWN)` with `SHOWN = 12` (`ActivitySection.tsx:15,20`) regardless of how
much changelog data exists, so its height is already bounded independent of data volume — the
"naturally bounded" case the ticket asks not to give a scrollbar it never needs. `knowledge`
(`KnowledgeSection`) is also `scrollable: true`: its sections list is small and fixed, but its linked
Documents list (`docs.data`) has no slice and grows with the project's knowledge base over time.
Alternative considered for `landing`: leave it uncapped as "operationally self-limiting", since only
one merge is usually active at a time. Rejected — nothing in the code enforces that; `Group`/`Row`
render `[...active, ...waiting]` in full with no cap, so a backlog is exactly as possible as in any
other list here, and the same rule ("does the body itself impose a limit, yes or no") applies more
predictably across all seven than a judgment call about typical queue depth.

**Testing the cap in jsdom.** jsdom performs no layout, so `max-height`/`overflow-y-auto` cannot be
asserted by measuring real scroll geometry (`[[web-app-testing]]`'s "jsdom has no layout" note).
Two things are still meaningfully testable without faking DOM geometry:
1. `PROJECT_SECTIONS` — each entry's `scrollable` flag is a plain data assertion (`activity` is
   `false`, the other seven are `true`).
2. `ProjectSection`'s rendered output — with `scrollable` true, the body wrapper carries the cap
   classes (`overflow-y-auto`, a `max-h-` class referencing `--ac-app-h`) regardless of how many
   children it is given; with `scrollable` false, it carries neither. Rendering the same section body
   with a handful of items and then with many demonstrates the classes — and therefore the cap — are
   present in both cases and every item stays in the DOM (nothing is sliced to fit), which is the
   concrete, testable meaning of criterion 1 ("a maximum, not a fixed height") in an environment that
   cannot compute whether a scrollbar actually appears.
   Real over/under-cap scrolling is verified visually (see Migration Plan), not in vitest.

## Risks / Trade-offs

[A single 40%-of-viewport cap looks cramped for a section whose natural content is normally 2-3
rows shorter than that, wasting scroll affordance nobody needs] → Not a real cost: `max-height` never
adds space a shorter section doesn't need, by construction — this is exactly criterion 1.

[Marking `knowledge` scrollable caps its Documents list together with its Sections chips and health
block inside one shared scroll region, so a very short Documents list still shares its cap with a
long Sections/health block above it] → Accepted: `KnowledgeSection` presents as one body under one
`ProjectSection` shell already; splitting its internal scroll region more finely than that is a
bigger change than this ticket's contract (`ProjectSectionProps`/one shell per section) supports, and
in practice its sections/health blocks are short.

## Migration Plan

Purely presentational, no data or API change, so nothing to migrate or roll back beyond reverting the
commit. Verification is manual per the ticket: load the overview for a project seeded with enough
commits/PRs/tickets/landings to overflow a 40%-viewport cap (the PR states the exact count used),
at a desktop width and at a phone width (390px), confirming a capped section scrolls without the page
scroll dying at its edges and an uncapped/short section shows no scrollbar. Screenshots go on the PR.
