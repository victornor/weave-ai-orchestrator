## Why

Captain, 2026-09-10, two minutes after the daemon upgraded to `b4797252e5`, opening the Knowledge
graph in a tab that had been open since before the upgrade:

```
Something went wrong!
Failed to fetch dynamically imported module:
https://…:7433/assets/KnowledgeGraph-BmC83-Hr.js
```

Two distinct bugs produce that, both confirmed live and both independent of each other.

## What Changes

- **The static file server's SPA fallback swallows missing assets.** `packages/server/src/static.ts`'s
  `resolveFile` falls back to serving `index.html` (200, `text/html`) for *any* path whose literal
  file does not exist under the built UI directory — including `/assets/<name>-<hash>.js`, Vite's
  build-output directory of content-hashed, immutable files. A stale tab asking for a chunk hash the
  new build no longer ships gets a 200 HTML response back for what is really a 404, so the browser's
  `Failed to fetch dynamically imported module` error is the parse failure of HTML-as-JS, not a
  legible "this file is gone."  A request under `/assets/` that doesn't exist now 404s with a JSON
  error body, matching how the rest of the API reports a miss; a request for an ordinary app route
  (no file under that path, not under `/assets/`) keeps falling through to `index.html` exactly as
  today, so client-side routing is unaffected.

- **A tab open across an upgrade cannot recover.** Even once the miss above 404s correctly, a tab
  loaded from the previous build still holds that build's hashed chunk names in its already-loaded
  JS, and any route not yet visited fails to lazy-load once the daemon has moved on to a new build
  (this daemon self-upgrades often — several times the evening this was filed). Today that failure
  reaches no error handling built for it: `packages/ui` has no error boundary anywhere, so a
  `React.lazy` import failure (only two call sites: `packages/ui/src/routes/Knowledge.tsx`'s
  `KnowledgeGraphView`, `packages/ui/src/routes/GlobalMap.tsx`'s `MapCanvas`) is caught only by
  TanStack Router's own default `CatchBoundary`, whose stock fallback is the literal string
  `"Something went wrong!"` — indistinguishable from an actual bug. A dynamic-import failure is now
  detected by matching the browser's own error message for it, and recovered by reloading the page
  once; a fresh `index.html` references the current build's chunks, so the reload succeeds. A guard
  keyed off how recently the last such reload happened prevents a reload loop when the reload does
  not fix things (a persistent, non-version-skew failure), showing a manual-reload prompt instead. A
  real rendering error (not an import failure) still shows the existing generic error state.

## Capabilities

### New Capabilities
(none)

### Modified Capabilities
- `daemon-upgrade`: gains two requirements — a missing built asset 404s rather than falling back to
  the app shell, and a stale tab recovers from a version-skew dynamic-import failure instead of
  showing an unqualified error.

## Impact

- `packages/server/src/static.ts` — the SPA-fallback resolution (`resolveFile`) and the route handler
  that decides 200-PLACEHOLDER vs. serving a file.
- `packages/ui/src/router.tsx` — a `defaultErrorComponent` wired into `createRouter`, applying to
  every route uniformly (there is no per-route override today).
- A new small module under `packages/ui/src/lib/` for the dynamic-import-error detection and the
  reload guard (mirrors the existing `sessionStorage`-backed modules like `lib/traceExpansion.ts`,
  `lib/drafts.ts`).
- No API surface, schema or migration changes. No change to `packages/ui/public/sw.js` (out of
  scope — see `design.md`).
