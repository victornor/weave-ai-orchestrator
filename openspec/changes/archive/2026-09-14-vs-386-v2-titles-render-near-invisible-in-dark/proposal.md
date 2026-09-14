# V2 dark-mode primary titles are unreadable; the global Run detail crashes

Tracker change for [VS-386](weave://tickets/VS-386). Frontend fix plus the one daemon read the
global screen needs.

## Why

The VS-354 V2 verification pass found two defects that make V2 unusable in places:

1. **Primary titles render near-invisible in dark mode on five screens** (Needs you decision-card
   titles, the Ticket page title and every TICKET/DELIVERY panel value, Roles role names, the
   Onboarding "Weaver" label, the Login "Set your password" heading). The classes involved —
   `text-text-1` and `text-text-strong` — are Tailwind utilities built from `index.css`'s non-inline
   `@theme` mapping. A custom property whose value is another `var()` is resolved once at the element
   that declares it (`:root`), and the *result* inherits; so the utilities read `<html>`'s theme, not
   `.v2-root`'s. VS-367 (PR #317, in merge) confirmed that exact mechanism against a real Chromium
   render and fixes it by making the mapping `@theme inline`. This change rebases on it and reproduces
   before assuming the symptom is gone.
2. **The global Run detail (`/v2/runs/$runId`) crashes outright** with
   `UNKNOWN_ERROR — useWorkspace outside WorkspaceProvider`. Runs is a global, cross-workspace screen
   (HANDOFF §12) and its route sits under the shell, which has no `WorkspaceProvider`.
   `RunBody` calls `useRun`, and `useRun` (`packages/ui/src/api/hooks.ts`) calls `useWs()` — which
   throws. The screen shows only an error boundary: no metadata table, no trace, no outcome.

## What Changes

- **Titles:** rebase on main once VS-367/#317 lands, rebuild, and re-check the five surfaces in a real
  browser. If `@theme inline` removes the symptom, capture the proof and make no per-component change;
  if it survives, find the real cause and fix it at its source, never per screen. A regression test
  pins the resolution only in the survives case.
- **Run detail:** resolve the run's own workspace instead of the route's provider. Add a daemon-level
  `GET /api/runs/{id}` that looks the run up across the loaded workspaces and returns it (the row
  already carries `workspaceId`); the run detail fetches through it and uses the resolved workspace
  for the event stream and worker naming. Opening the URL directly works the same as clicking a row,
  and the global route is never wrapped in an arbitrary workspace.
- Document both contracts in the existing specs below.

**BREAKING:** none. The new route is additive; the per-workspace runs API is unchanged.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `web-v2/theme`: a colour utility class resolves against the scoped V2 theme at the element that
  uses it, so primary titles are legible in dark and light alike.
- `web-v2/runs`: the global run detail resolves the run's own workspace and renders with no
  `WorkspaceProvider`, including when opened directly by URL.

## Impact

- `packages/ui/src/index.css` — only if the title defect survives the VS-367 rebase.
- `packages/ui/src/api/hooks.ts` — a global run query (the per-workspace `useRun` stays).
- `packages/ui/src/v2/RunPage.tsx` — fetch by id globally, pass the resolved workspace to the event
  stream and worker lookup.
- `packages/server/src/routes/daemon.ts` — the daemon-level `GET /runs/{id}`; `docs/API.md`,
  `packages/server/src/routetable.ts`, and the OpenAPI route table.
- Tests: a UI regression that mounts the real run detail with no `WorkspaceProvider`; a server route
  test for the global lookup; token-resolution coverage only in the survives case.
