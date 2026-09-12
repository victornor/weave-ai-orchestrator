## Context

See proposal.md — Why. The artwork was traced by captain and handed over as the ticket's `mark-svg`
document: one `<svg>` with viewBox `0 0 1860.444515 413.681337` (4.497:1), four `<path>` elements,
`fill="currentColor"`, and a provenance comment that records the one rule about the mark (never crop
to the knot). The asset exists nowhere in the repo today, and `packages/ui/src` has no brand
component.

Constraints that shape this:

- `packages/ui` draws marks as inline SVG components with a `viewBox` and `fill="currentColor"`
  (`app/PlusGlyph.tsx`, `app/NavGlyph.tsx`); a 3.7 KB asset is well inside what that pattern
  handles, and the ticket forbids a new dependency or a network fetch.
- The repo's tokens (`src/index.css`) carry the light and dark themes; components use Tailwind token
  classes, not literal colours or pixel values.
- The visible heading on login and onboarding is "Weave AI". It is not owned by pending work — the
  rename to `@weave-ai` has landed — and this ticket is about the mark, not the name, so the heading
  text is left alone (see Non-Goals).
- The rail is 208px wide with `p-2.5`, so about 188px of usable width. At 28px tall the mark is
  already ~126px across, and ~180px at 40px tall; the rail has no room for a wordmark beside the
  mark at any size that reads.

## Goals / Non-Goals

**Goals:**

- One self-contained `WeaveMark` component carrying the supplied artwork verbatim.
- The mark on the sidebar rail, the login screen and the onboarding screen.
- The 4.5:1 ratio held structurally, so no caller can squash it.
- Context-driven accessible name, and colour inherited from CSS.

**Non-Goals:**

- Changing the heading text ("Weave AI"). This ticket places the mark; the name is not its subject.
- The square launcher tiles, manifest or service worker.
- Any other visual change to the sidebar, login or onboarding.
- Adding a wordmark to the sidebar. The rail's brand block is the mark alone; the lockup's wordmark
  half is the heading already present on login and onboarding.
- Re-tracing, re-measuring or "cleaning up" the paths.

## Decisions

### One inline component, artwork copied byte-for-byte

Add `packages/ui/src/components/WeaveMark.tsx` holding the `<svg>` from the ticket document with the
paths, viewBox, `fill="currentColor"` and the provenance comment kept as a JSX comment. The comment
can be a JSX comment rather than the literal HTML text — it is the record, not rendered output.

*Alternatives considered:* importing the SVG with `?raw`/`vite-svg-loader` (a new dependency, and the
ticket forbids it); serving it from `public/` and fetching it (a network request for 3.7 KB, also
forbidden); hand-writing a cleaner path (the ticket forbids touching the path data).

### Ratio is held by the API, not by each caller

The component renders the `viewBox` and nothing else dimensional. Callers set a height utility and
`h-auto` width (`className="h-5 w-auto"`, etc.); an SVG with a viewBox and no intrinsic width/height
derives its width from the ratio. The component never accepts or sets a width, and never applies
`w-full` or a fixed `width`/`height` attribute. This makes the squash mistake structurally hard
instead of relying on each of the three call sites remembering the rule.

*Alternatives considered:* baking a fixed size into the component (each surface wants a different
size); a CSS `aspect-ratio` wrapper (equivalent but more machinery than the viewBox already gives).

### Accessible name is a prop, decorative by default

`WeaveMark({ className, title })` renders `role="img"` + `aria-label={title}` when `title` is given,
and `aria-hidden` when it is not. The default is the decorative case because two of the three
surfaces sit beside a heading that already names the product; the sidebar passes `title="Weave"`
because nothing there names it. This keeps "never both a label and a visible duplicate of the same
word" easy to reason about: the wordmark half and the label are mutually exclusive by construction.

### Sidebar: a new block at the top of the rail, mark alone

`WorkspaceNav` gains a brand block above `<nav aria-label="Global">`. It is a new element, not a
change to any existing nav row, and it is `flex-none` so it cannot push the workspace list into a
new scrollbar. The mark is sized from a rail-appropriate height and the block has no other content.

*Alternatives considered:* mark + a "Weave" wordmark in the sidebar (the full lockup). Rejected on
fit alone: the rail's ~188px of usable width is already ~74% consumed by a 28px-tall mark (~126px
wide), and ~180px of it by a 40px-tall mark, so there is no room for a wordmark that reads. The
lockup is realised on login and onboarding, where a wordmark heading already exists.

### Login and onboarding: the mark replaces the placeholder tile; the lockup is tuned to the render

Both screens share the same header markup today — a `size-7` (28px square) accent tile with a
diamond glyph and a "Weave AI" heading. Replace the tile with the mark (no `title`, so `aria-hidden`)
and keep the heading text. The mark's height, the gap to the heading, and whether the mark sits left
of the heading or above it are **settled against the render**, not carried over from the square: at
28px tall the mark is ~126px wide, four and a half times the width of the square it replaces, so the
gap that read correctly beside a small square will not read correctly beside a wide band. The shared
`Frame` in `Onboarding.tsx` and the inline header in `Login.tsx` each get the same settled lockup.
Changing the gap or the orientation is in scope; changing the heading text is not.

### Colour from a text token

The mark's container uses a text token (`text-text-strong`) so `currentColor` resolves per theme and
the mark is near-white on dark and near-black on light, legible on `bg-0`/`bg-input` without a
hard-coded value. No literal hex.

## Risks / Trade-offs

- **A `w-full` or fixed width creeps in at a call site** → the component exposes no width API; the
  design and review explicitly check each of the three call sites, and the component test asserts no
  width is set.
- **The mark reads poorly at the sidebar's small height** → captain verified 28px; the rail's brand
  block keeps the mark in the 28–40px band, where it fits its ~188px usable width. Review is by
  screenshot at the real sizes before the report, per the ticket's "screenshots or it did not happen".
- **The header lockup is cramped because the square's spacing is kept** → deliberately not inherited:
  the mark is ~126px at 28px tall, so the gap and orientation are chosen against the render and the
  choice is stated in the report.
- **The heading says "Weave AI", not the "Weave" the ticket's lockup names** → accepted deliberately;
  this ticket places the mark and does not rename. Flagged here so review sees it is a decision, not
  an oversight.
- **The provenance comment is easy to drop in a JSX rewrite** → the component test asserts the
  comment's presence in the rendered markup is not possible (comments are not in the DOM), so the
  test reads the source instead; the task says keep it and review checks it.

## Migration Plan

None. This is additive UI on the running web app; the daemon upgrade after merge serves the rebuilt
bundle. Rollback is reverting the change.

## Open Questions

None. The one ambiguity — the wordmark text — is resolved above as a non-goal and surfaced for review.
