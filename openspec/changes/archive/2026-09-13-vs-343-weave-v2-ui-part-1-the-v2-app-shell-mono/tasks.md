## 1. Commit the design reference

- [x] 1.1 Copy `HANDOFF.md`, `Weave.dc.html`, `Screens.dc.html`, `support.js`, `assets/` and
  `shots/` from `/home/user/Downloads/Weave Control Plane Redesign.zip` into `docs/design/v2/`,
  together with the three `uploads/*.md` (`design-design-contract.md`,
  `design-claude-design-prompt.md`, `design-claude-design-followup-1.md`). Omit
  `uploads/pasted-*.png`, `uploads/download.png`, `uploads/index.css` and `.thumbnail`.
- [x] 1.2 Change the ignore rule so the reference is tracked: replace `docs/design/` in `.gitignore`
  with `docs/design/*` and add `!docs/design/v2/` (the parent must not be excluded for a negation
  inside it to apply). Leave `docs/research/` as it is.
- [x] 1.3 Add an ADR in `docs/adr/` recording that `docs/design/v2/` is deliberately committed for
  the V2 build, that this is the one design path that leaves VS-91's keep-out, and that the large
  session screenshots stay out.

## 2. Mount the V2 subtree at `/v2`, lazily

- [x] 2.1 Create `packages/ui/src/v2/` with a `V2Root` component that renders the scoped
  `.v2-root` element, its `data-theme`, and the V2 shell. Import `v2.css` from this module so Vite
  code-splits it with the V2 chunk.
- [x] 2.2 In `packages/ui/src/router.tsx`, add a root-level `/v2` route whose component is the V2
  module behind `React.lazy` and `Suspense`, with the `/v2/w/$ws` layout and the destination
  children under it. Do not change any V1 route, component or redirect.
- [x] 2.3 Make `/v2` resolve like V1's `/`: redirect to the remembered workspace's V2 `needs`, or
  `/onboarding` / the sign-in path when none is remembered or the visitor is unauthenticated; forget
  a remembered workspace the daemon no longer reports.
- [x] 2.4 Verify with a test in `packages/ui/src/test/` that the V2 module is not imported by V1's
  entry (the route is lazy) and that `/` still matches its V1 redirect.

## 3. Mono theme tokens and shape/density primitives

- [x] 3.1 Create `packages/ui/src/v2/v2.css` with the Mono token set declared once for both themes
  under `.v2-root` / `.v2-root[data-theme='dark']` / `.v2-root[data-theme='light']`: surfaces
  (`#050506` / `#0b0b0d` / `#101012` dark, `#f7f8f9` / `#ffffff` / `#f2f3f5` light), text inks with
  `--text-4` equal to `--text-3`, accent and `--accent-link`, the live-state hues (working amber,
  needs-you indigo, blocked red; done/merging/idle greyscale), hairlines, space, radii and type.
  Every selector must begin with `.v2-root` so nothing reaches V1.
- [x] 3.2 Add the shape/density primitives to the V2 module: the `Card` and control corner rules
  (4–6px, no pill), the one bordered `Tag` recipe (1px tinted border, 4px radius, 10px mono), the
  194px sidebar width and the 38px header bar as shared constants/classes.
- [x] 3.3 Add `useV2Theme()` reading and writing a V2-only storage key and setting `data-theme` on
  the V2 root, defaulting from `prefers-color-scheme`. Do not read or write V1's `conductor.theme`.
- [x] 3.4 Build the sidebar-footer theme switch (dark/light) and the single collapsed-rail toggle.
  The mockup's harness switch above the frame is not built.
- [x] 3.5 Verify with tests: `--text-4` equals `--text-3` in both themes; the theme choice persists
  across a remount/reload; and a V1 token resolves to its V1 value after `v2.css` is imported.

## 4. The V2 rail

- [x] 4.1 Build `v2/nav.ts`: one registry describing every destination — key, label, icon, group
  (`everywhere` or `workspace`), address builder, and the count it carries — plus the project rows.
  Include the expanded rail order (Everywhere: Needs you, Live, Incidents, Map, Runs, Scheduled,
  Settings; Workspace: Chat, Needs you, Work, Roles, Knowledge), no hotkey numbers and no Projects
  heading.
- [x] 4.2 Build the expanded rail: the `WeaveAI` header, the collapse control in the `⌘K` slot, the
  Everywhere group, each workspace group with its coloured project names, and the sidebar footer
  (account line, theme switch, V1 link).
- [x] 4.3 Build the collapsed 48px rail: mark-only rows grouped as when expanded, the hairline and
  small mono workspace initial, a dot on Needs you when decisions are open, and labels on hover.
- [x] 4.4 Persist the collapsed/expanded choice per device and restore it on load, best-effort when
  storage is unavailable.
- [x] 4.5 Verify with tests that the expanded and collapsed rails render the registry's entries, the
  collapse state persists, and a waiting Needs you carries its dot when collapsed.

## 5. Navigation, highlighting and scope

- [x] 5.1 Add the pure `activeNavKey(pathname, ws)` matcher so exactly one row is highlighted per V2
  route, including the drill-downs (ticket, run, artifact, worker, project) mapping to their owning
  destination.
- [x] 5.2 Add `useV2Scope()` returning the active workspace for `/v2/w/$ws` routes and Everywhere
  otherwise, and build every unscoped destination's address against it so scope is preserved.
- [x] 5.3 Make a workspace's Needs you build the global `/v2/needs` address with that workspace's
  scope pre-applied, and make Live global-only with scope as a filter.
- [x] 5.4 Make the V2 header read the same key and counts as the highlighted row: the 38px header
  shows the crumb root (Everywhere or the workspace name), the destination label and the count,
  derived from the same hooks the screens use.
- [x] 5.5 Verify with tests: every V2 route highlights exactly one row that matches the header;
  moving from a workspace Work screen to a project keeps the workspace scope; the workspace Needs you
  highlights one row and opens the global screen with scope pre-applied.

## 6. A route and a header for every V2 destination

- [x] 6.1 Build the `V2Page` placeholder primitive: the 38px header (crumb root › label, count
  pills) over a body that a screen ticket will fill.
- [x] 6.2 Add a thin page for each global destination — Needs you, Live, Incidents, Map, Runs, Run
  detail, Scheduled, Settings, Global Chats — and each workspace destination — Chat, Needs you,
  Work, Roles, Knowledge, knowledge graph, knowledge explorer, Usage, Changelog, project overview,
  ticket page, artifact reader, worker page — each rendering `V2Page` with its header.
- [x] 6.3 Register every one of those routes under the `/v2` subtree; register no merge-queue route.
- [x] 6.4 Verify with a test that each destination address resolves and renders its header, and that
  the V2 route table contains no merge-queue address.

## 7. The phone tab bar and More list

- [x] 7.1 Build the phone tab bar Chat · Needs you · Work · Live · More, with Needs you and Live
  opening the global screens and Work staying workspace-scoped.
- [x] 7.2 Build the More destination list from the same registry: grouped Everywhere and by
  workspace, 48px rows with a mark, label, count and chevron, so every V2 destination is reachable.
- [x] 7.3 Verify with a test that the tab bar shows those five entries, the two global tabs open the
  global addresses, the Work tab keeps the current workspace, and More lists every registry
  destination.

## 8. The one-click way between V1 and V2

- [x] 8.1 V2: add a link to `/` in the sidebar footer and in the phone More list.
- [x] 8.2 V1: add one small control that opens `/v2` in the desktop rail footer (beside the palette
  button) and in the phone More sheet's footer — deliberately outside `MORE_ITEMS` / the "More
  sections" nav so V1's pinned list tests do not move. Change nothing else in V1.
- [x] 8.3 Verify with tests that each control opens the other version and that V1's existing suite
  still passes unchanged.

## 9. Verification

- [x] 9.1 Run `pnpm lint` and `pnpm typecheck`; both clean.
- [x] 9.2 Run `pnpm test` (core/server suite) and `pnpm --filter @weave-ai/ui exec vitest run`
  separately; paste both suite blocks verbatim in the report and confirm both pass.
- [x] 9.3 Confirm no HTTP route, MCP tool, CLI command, database migration or daemon file changed:
  V2 is frontend-only and `/v2` is served by the existing static fallback.
- [x] 9.4 Run `openspec validate vs-343-weave-v2-ui-part-1-the-v2-app-shell-mono --json --strict`
  and confirm it is clean.
- [x] 9.5 Treat the acceptance list as the exit criteria: `/v2` shows the expanded rail; `/` is V1
  unchanged; the rail collapses and remembers; one row highlights and matches the header; the theme
  switch persists; the phone bar and More reach every route; scope is preserved.
