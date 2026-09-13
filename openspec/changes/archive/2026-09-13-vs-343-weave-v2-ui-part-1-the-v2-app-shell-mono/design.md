## Context

V1 is a React 19 + Vite + Tailwind v4 SPA in `packages/ui`, built to `packages/ui/dist` and served
by the daemon from `packages/server/src/static.ts`. That handler serves a requested non-asset path
by falling back to `index.html`, so any path under `/v2` already resolves to the app; V2 needs no
new daemon route, flag or config. V1's routes live in `packages/ui/src/router.tsx` (TanStack Router
1.x), its tokens in `packages/ui/src/index.css`, and its API client, hooks, auth and event stream in
`packages/ui/src/api/**` — all of which V2 reuses rather than forks.

The redesign source is the zip at `/home/user/Downloads/Weave Control Plane Redesign.zip` (exported
2026-09-13), read successfully in this ticket. `Weave.dc.html` carries the shell and the Mono token
set; `Screens.dc.html` carries the screens; `HANDOFF.md` is the change list. Its §2/§3/§4/§15 are
the contract this ticket implements.

## Goals / Non-Goals

**Goals**

- `/v2` renders the V2 shell on the same daemon with no server change, and V1 at `/` is unchanged
  apart from one additive control that opens V2.
- The Mono token set, dark and light, with the persisted in-app switch and the shape/density
  primitives, scoped so nothing reaches V1.
- A rail that groups Everywhere above each workspace, collapses to 48px and remembers it, highlights
  exactly one row that agrees with the header, and preserves scope across navigation.
- A route and a header for every V2 destination so later screen tickets only fill content.
- The design reference committed at `docs/design/v2/` so later tickets read it from the repo.

**Non-Goals**

- Any screen's content (Chat, Needs you, Work, Live, Runs, Map, Incidents, Scheduled, Settings,
  Roles, Knowledge, Artifacts, and the kept V1 screens).
- Any backend, HTTP, MCP, CLI or database change.
- Promoting V2 to `/`, or removing V1.
- A V2 merge-queue route (`HANDOFF.md` §4: the queue shows on Work).

## Decisions

**Serving: a lazy route subtree in the existing SPA.** V2 lives in the same Vite build with
`base: '/'`, so it shares the `/assets` output and the daemon's static handler. `router.tsx` mounts
a `/v2` route whose layout is a `React.lazy` module behind a `Suspense` fallback; that module owns
the V2 shell and imports `v2.css`, so Vite splits both into a chunk that is fetched only on the
first `/v2` visit. V1's initial bundle and route table are untouched. This is the option the ticket
prefers ("V2 routes under `/v2` inside the existing UI app, lazy-loaded") and it needs no server
change.

**Addresses mirror V1 under the `/v2` prefix.** Workspace pages are `/v2/w/$ws/<section>` and
global pages are `/v2/<section>`, so scope is a route fact and V2 can reuse the existing
`WorkspaceProvider` and workspace hooks unchanged. `/v2` resolves like V1's `/`: remembered
workspace's Needs you, else onboarding or sign-in. Global addresses: `needs`, `live`, `incidents`,
`map`, `runs`, `runs/$runId`, `scheduled`, `settings`, `chats`. Workspace addresses: `chat`,
`needs`, `work`, `roles`, `knowledge` (with `knowledge/graph` and `knowledge/explorer`), `usage`,
`changelog`, `p/$project`, `tickets/$ticketId`, `artifacts/$key`, `workers/$workerId`. The merge
queue has no address.

**Theme scoping without a second Tailwind theme.** `packages/ui/src/index.css` already maps the
tailwind token names to CSS variables via a non-inline `@theme` (`--color-bg-0: var(--bg-0)`, …),
which is what lets a runtime theme switch repaint without rebuilding classes. V2 reuses those
utility names and only overrides the underlying variables under its own root:

```css
.v2-root { /* Mono surfaces, text, accent, status, project colours, space, radii, type */ }
.v2-root[data-theme='dark'] { … }
.v2-root[data-theme='light'] { … }
```

Every V2 selector is prefixed with `.v2-root`, so a V1 element resolves V1's values whether or not a
V2 chunk has been loaded. V2 declares the palette once with both themes' values, per HANDOFF §2. The
Mono values come from `Weave.dc.html`'s variable block (dark ground `#050506`, cards `#0b0b0d`,
raised `#101012`, `--text-4` equal to `--text-3`, hue on live states only). Project colours are not
redefined: `lib/projectColor.ts` already assigns a stable hand-picked colour per project, and V2
reads it so a project keeps one hue in both versions.

**The theme switch is V2's own.** It is a `useV2Theme()` hook reading and writing a V2 key with
`data-theme` on the `.v2-root` element, defaulting from `prefers-color-scheme`. It does not touch
V1's `conductor.theme`, so switching V2 does not flip V1 (and vice versa). The mockup's harness
switch above the frame is not built.

**Navigation is one registry, not per-screen lists.** A `v2/nav.ts` module describes every
destination once — key, label, icon, address builder, group (Everywhere or workspace), and the
count it carries — and the expanded rail, the collapsed rail, the phone tab bar and the More list
are all derived from it. A pure `activeNavKey(pathname)` maps a path to the one highlighted row, so
highlighting is testable without a browser and cannot disagree with the header, which reads the same
key. Counts come from the same hooks the screens use (`useDecisions`, `useWorkspaces`), satisfying
§15's "derive every count from one source".

**Scope travels by route, not by stored state.** `useV2Scope()` returns the active workspace when
the route is under `/v2/w/$ws` and Everywhere otherwise. A destination that names no scope is built
against the current scope, so moving from a workspace screen to a project or a ticket keeps that
workspace; a workspace's Needs you builds the global `/v2/needs` address with that workspace's scope
pre-applied; Live exists only as a global destination with scope as a filter. There is no hidden
scope variable that can drift from the address bar.

**The V1↔V2 control.** V2 gets a link to `/` in its sidebar footer and phone More list. V1 gets one
additive control — a small link to `/v2` in the desktop rail footer beside the palette button and in
the phone More sheet's footer — deliberately outside V1's pinned `MORE_ITEMS`/`More sections` lists
so V1 tests that count those lists are unaffected. This is the only V1 change; every V1 screen and
address stays as it was.

**The design reference.** Task 1 copies `HANDOFF.md`, `Weave.dc.html`, `Screens.dc.html`,
`support.js`, `assets/` and `shots/` plus the three `uploads/*.md` into `docs/design/v2/`, omitting
the ~9 MB of `uploads/pasted-*.png` and `uploads/download.png`. `docs/design/` is gitignored to keep
design material out of the public repo (VS-91), so the ignore rule becomes `docs/design/*` with
`!docs/design/v2/`; an ADR in `docs/adr/` records that this one path is intentionally committed and
why.

## Risks / Trade-offs

- **A V2 style could leak into V1 if a selector forgets the `.v2-root` prefix.** → V2 CSS lives in
  its own file and every rule is scoped; a test asserts a V1 token still resolves to its V1 value
  after the V2 module is imported.
- **Registering `/v2` in the shared router touches V1's route table.** → The added route has no
  effect on V1 matching, and the existing `router.test.tsx` route-tree assertions are additive.
- **Adding a V1 control risks a pinned V1 test.** → It is placed outside the lists
  `moreSheet.test.tsx` and `appshell.test.tsx` count, and the acceptance run proves V1's suite still
  passes.
- **Committing design material reverses VS-91's keep-out.** → The negation is limited to
  `docs/design/v2/`, the ADR states the reason, and the large session screenshots are omitted. The
  ticket explicitly requires it.
- **Lazy CSS is injected globally once loaded.** → Safe because every selector is rooted at
  `.v2-root`; no V1 selector is ambient.

## Migration Plan

No migration and no data change. V2 is additive: the daemon serves the same build, so a deploy of
the UI makes `/v2` available immediately and leaves `/` alone. Rolling back the UI release removes
`/v2`. A later ticket promotes V2 to `/`; that is out of scope here.
