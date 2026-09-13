## Why

Captain has finished a full redesign of the web app and wants it built as **V2**: a parallel
frontend for the same backend, reachable at `/v2`, while V1 at `/` stays exactly as it is until V2
is finished and promoted. This ticket is the foundation — the shell, the Mono theme, the rail,
navigation and scope — that every later V2 screen ticket builds on. Without it there is no `/v2`
address, no token set and no navigation contract, so each screen ticket would re-invent them and
drift.

## What Changes

- **Commit the design reference into the repo at `docs/design/v2/`** so every later V2 ticket reads
  it from the repository: `HANDOFF.md`, `Weave.dc.html`, `Screens.dc.html`, `support.js`,
  `assets/`, `shots/` and the three `uploads/*.md`. The ~9 MB of `uploads/pasted-*.png` /
  `download.png` session screenshots are left out. `docs/design/` is currently gitignored (VS-91),
  so a targeted negation is added for `docs/design/v2/` and an ADR records the deviation.
- **Serve V2 at `/v2` on the same daemon, frontend-only.** A lazy-loaded route subtree inside the
  existing UI app; the daemon's static handler already serves the SPA `index.html` for any non-asset
  path, so **no server, API or config change is needed**.
- **Mono theme and primitives.** The full Mono token set in dark and light (near-black ground,
  hue only on live states, project identity hues, underlined prose links, no opacity dimming,
  `--text-4` collapsed into `--text-3`), the persisted in-app light/dark switch in the sidebar
  footer, and the shape/density primitives: 4–6px corners and no pills, one bordered tag recipe, a
  194px sidebar and 38px header bars. The expanded sidebar header reads `WeaveAI`.
- **The V2 rail and navigation.** An Everywhere group (Needs you, Live, Incidents, Map, Runs,
  Scheduled, Settings) above each workspace group (Chat, Needs you, Work, Roles, Knowledge), icons
  on every row, project names as coloured text with no Projects heading and no hotkey numbers, the
  ⌘K slot holding the sidebar collapse button, and a collapsed 48px rail that remembers its state.
  The phone gets the tab bar Chat · Needs you · Work · Live · More, with More a grouped destination
  list.
- **Scope preservation and one-source counts.** An unscoped destination inherits the current scope;
  the workspace Needs you opens the global screen with that workspace's scope pre-applied; exactly
  one rail row highlights and it is the same fact as the header label and header count.
- **A route and an empty page with its header for every V2 destination** — the global and workspace
  sections, plus ticket page, run detail, artifact reader, worker page, Global Chats, project
  overview, Usage, Changelog, and the knowledge graph and explorer. Merge queue gets no V2 route.
- **A one-click way between V1 and V2, in both directions.** V2 gets its own link back to V1; V1
  gets one small additive control that opens `/v2` — the only V1 change this ticket makes.
- V1 at `/` stays visually and behaviourally unchanged otherwise; V2 tokens and styles are scoped to
  the V2 root and cannot leak, and V1's existing UI tests keep passing.

## Capabilities

### New Capabilities

- `web-v2/shell`: the `/v2` address and its lazy loading, the route-and-header contract for every V2
  destination, the one-click V1↔V2 switch, and V1's visual isolation.
- `web-v2/theme`: the Mono token set declared once for dark and light, the persisted in-app theme
  switch, and the shared shape/density primitives.
- `web-v2/navigation`: the rail's group structure and collapse behaviour, single-row highlighting
  tied to the header, scope preservation, and the phone tab bar and More destination list.

### Modified Capabilities

_None. V2 is additive and V1's specified behaviour is unchanged._

## Impact

- **New:** `packages/ui/src/v2/**` — the V2 app shell, theme CSS, nav model, route subtree,
  placeholder pages and primitives. `docs/design/v2/**` — the committed design reference.
  `openspec/specs/web-v2/{shell,theme,navigation}/` — the new capabilities (created on archive).
- **Modified:** `packages/ui/src/router.tsx` (mount the lazy `/v2` subtree);
  `packages/ui/src/app/AppShell.tsx` and `packages/ui/src/app/MoreSheet.tsx` (the one additive V1
  control that opens `/v2`); `.gitignore` (negate `docs/design/v2/`); `docs/adr/` (the deviation).
- **Reused, not forked:** `packages/ui/src/api/**` (client, hooks, event stream, workspace
  context), `packages/ui/src/lib/projectColor.ts` (so a project keeps one hue across V1 and V2),
  `packages/ui/src/components/WeaveMark.tsx`.
- **New UI tests** under `packages/ui/src/test/` for rail highlighting, scope preservation, theme
  persistence and the route/header contract.
- No HTTP route, MCP tool, CLI command, database migration or daemon change.
