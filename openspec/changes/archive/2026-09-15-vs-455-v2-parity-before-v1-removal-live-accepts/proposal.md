# Close the two V2 parity gaps before V1 is removed

Tracker change for [VS-455](weave://tickets/VS-455). A `task` ticket, so this change carries tasks
only — `skip_specs: true`.

## Why

Captain wants V2 promoted and V1 removed (2026-09-14). VS-448's parity scout found exactly two gaps
that have to close before the router flip, because the redirect table points V1 URLs at them:

1. **Live has no per-workspace deep link.** `packages/ui/src/v2/LivePage.tsx` keeps its scope filter
   in local `useState`, so V1's `/w/$ws/live` can only redirect to the unfiltered Everywhere floor.
   `v2/RunsPage.tsx` already solves exactly this with `search['ws']`.
2. **V2 has no `/team` alias.** V1 has redirected `/w/$ws/team` to `/w/$ws/roles` since VS-333
   (`router.tsx:286-293`, contract in `workspace-navigation/roles-page`); V2's `/v2/w/$ws/roles` has
   no such alias, so an old Team link cannot land on V2's Roles.

## What changes

- **`packages/ui/src/v2/LivePage.tsx`** — the scope state seeds from an optional `ws` search param,
  and choosing a scope chip writes the choice back into the URL with `replace` (the `RunsPage.tsx`
  `search['ws']` pattern). With no `ws` the behaviour is unchanged (Everywhere); `?worker=` keeps
  working, and a `ws` that names no loaded workspace reads as Everywhere rather than an empty floor.
- **`packages/ui/src/router.tsx`** — a `/v2/w/$ws/team` route redirects to
  `/v2/w/$ws/roles`, mirroring V1's alias. No V1 route or link is touched.

## No spec delta

The two changes are additive parity work: neither alters a behaviour an existing spec already
describes. The V1 alias contract lives in `workspace-navigation/roles-page`, and V1's Live filter in
`workspace-navigation/{global-live,live-floor}`; those describe exactly what this ticket must not
change. The promoted-URL navigation specs are rewritten once, against the final shape, by VS-456's
router flip — writing `/v2`-relative alias text now would only be churn against that ticket. So the
tracker change is `skip_specs: true`, as VS-424 and VS-434 did for V2 behaviour fixes.

## Tests

- A `?ws=<id>` URL pre-selects that workspace's scope chip and filters the grid, with the shown
  count tied to the grid.
- Changing the chip writes the scope back to the URL (`ws` set, or removed for Everywhere).
- `/v2/w/$ws/team` redirects to `/v2/w/$ws/roles` for the same workspace.

## Rendered evidence

Dark- and light-theme captures of `/v2/live?ws=<id>` with the scope chip active, committed under
`docs/reviews/vs-455/`.

## Out of scope

The V1 route tree, V1 links, the `/v2`-to-root promotion and the redirect table — VS-456 and the
rest of VS-448's breakdown. Do not touch V1 routes or links.
