## Why

VS-456 promoted V2 to `/` and rewired the router, which left V1's route tree registered nowhere:
`packages/ui/src/routes/**` and the V1 app shell are now unreachable dead code that no URL answers,
and V2 still imports pieces of seven of those files. The V1 stylesheet (`index.css`) and V2's delta
stylesheet (`v2.css`) coexist only because both trees did, so the split now has no reason to exist.

This is the second of captain's two V1-removal PRs (split chosen 2026-09-14). It deletes the dead
code without breaking what V2 still imports.

## What Changes

- **Hoist V2's reuses first.** Seven `routes/*.tsx` files export things V2 imports by static or
  dynamic `import()`. Each reused piece moves to a shared home before its V1 wrapper is deleted.
- **Delete the V1 surface.** `packages/ui/src/routes/**`, the V1 shell (`app/AppShell.tsx`,
  `BottomBar.tsx`, `MoreSheet.tsx`, `NavGlyph.tsx`, `nav.ts`, `PlusGlyph.tsx`, `WorkspaceNav.tsx`,
  `barGeometry.ts`) and the `components/*` files whose only importers are V1 routes (re-verified).
- **One stylesheet.** `v2/v2.css`'s token values become `index.css`'s only defaults; the `.v2-root`
  token scoping goes; the V2 component classes move in with them. `v2.css` is deleted and
  `daemon.ts`'s hardcoded path to it is updated; the plugin-theme generator reads one file.
- **V1-only tests** go with the code they exercise; tests that assert shared behavior are retargeted.
- **Specs and docs.** The `web-v1/ticket-page` capability is retired outright: its spec file is
  deleted rather than rebuilt from a `## REMOVED Requirements` delta, because removing its last
  requirement leaves no requirements to write and `openspec archive` refuses to retire a spec whose
  text it cannot fully attribute (the archive gate's own suggested fix). The stale stylesheet
  references and V1-route clauses in `plugins/web-pages` are corrected.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `plugins/web-pages`: its stylesheet requirement now names `packages/ui/src/index.css` as the
  generated stylesheet's source (the merge deleted `v2/v2.css`), and its no-longer-true V1-route
  clauses are dropped.
- `web-v1/ticket-page` is not a delta: the capability's spec file is deleted with the V1 code (see
  What Changes).

## Impact

- `packages/ui/src/routes/**`, `packages/ui/src/app/**` (shell files only), `packages/ui/src/components/**`
  (V1-only files), `packages/ui/src/v2/v2.css`, `packages/ui/src/index.css`,
  `packages/ui/src/v2/V2Root.tsx`, `packages/ui/src/router.tsx`.
- `packages/server/src/daemon.ts` and `packages/core/src/artifacts/v2-theme.ts` lose the second
  stylesheet path.
- `packages/ui/src/test/**` loses V1-only suites.
- No URL, routing, or visual change.
