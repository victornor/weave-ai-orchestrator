# Phone Work matches the reference: a compact scope row over the list

Tracker change for [VS-404](weave://tickets/VS-404). A `task` ticket, so this change carries
tasks only — `skip_specs: true`.

## Why

On a phone (`packages/ui/src/v2/work/Work.tsx`), the Work body is the reference's simple list
(`PhoneRow`, gated `md:hidden`), but the toolbar block above it has no responsive gating: the
Finished segmented control, the Kanban/Table view switch, the search field, the four filter
dropdowns and the "New ticket" button all render at 390px, even though the phone body ignores
the view switch. VS-402's phone capture against
`shots/phone-dark/03-work.png` shows the clutter.

The phone reference (`docs/design/v2/Screens.dc.html`, `boardFilters`) shows instead a single
compact scope-tab row — `All work · Needs you · <project>…` — above the merge-queue strip and the
list, and no search field.

## What changes

- **The desktop toolbar is gated to `md` and up.** The Finished/view/New-ticket row and the
  search/filter row carry `hidden … md:flex`, the same CSS breakpoint the phone list already uses
  (`md:hidden`), so nothing JS measures a width that reads 0 on first render.
- **Phone gains the reference's compact scope-tab row** (`md:hidden`): `All work`, `Needs you`
  and one chip per project. `All work` clears the scope, a project chip sets the existing project
  filter, and `Needs you` narrows the list to tickets with an open human decision — the set the
  board already computes as `needsYou`.
- **The merge strip and the list are unchanged** and remain the phone body.
- **Desktop is unchanged.**

## Out of scope

No phone search field (the reference has none). No change to the desktop toolbar's layout or
ordering, to the kanban/table views, or to V1.
