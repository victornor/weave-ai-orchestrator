## Context

Two independent defects, found from one live report. Evidence for both was gathered by reading the
running code, not by guessing from the symptom.

### 1. The asset fallback

`packages/server/src/static.ts:54-61`:

```ts
async function resolveFile(root: string, pathname: string): Promise<string | null> {
  const rel = normalize(pathname).replace(/^(\.\.[/\\])+/, '').replace(/^\/+/, '');
  const candidate = join(root, rel);
  if (!candidate.startsWith(root)) return null;
  if (rel && (await isFile(candidate))) return candidate;
  const index = join(root, 'index.html');
  return (await isFile(index)) ? index : null;   // SPA fallback
}
```

There is no path-prefix or extension check anywhere in this function: a miss on *any* path falls
through to `index.html`. The caller (`static.ts:34-49`) then treats "no file" and "file is index.html
because nothing else existed" identically — both 200 with the resolved file (or the "UI not built"
placeholder if `resolveFile` returned `null` outright). `/assets/` is inspected exactly once in this
file, at `static.ts:41`, only to decide the cache-control header for a file that was already found —
irrelevant to whether a miss should fall back at all.

`packages/ui/vite.config.ts` uses Vite's default `build.outDir: 'dist'` with no custom
`assetsDir`, so the build's own output convention (verified in `dist/` after a build) is what decides
the prefix: everything Vite content-hashes lives under `dist/assets/`. That is the one directory a
miss must never paper over.

### 2. The stale tab

Confirmed: `packages/ui` has no `ErrorBoundary` anywhere (`componentDidCatch` /
`getDerivedStateFromError` do not appear in the package). The two `React.lazy` call sites
(`routes/Knowledge.tsx:32`, `routes/GlobalMap.tsx:21`) are each wrapped only in `<Suspense>`, which
does not catch a rejected dynamic import — that propagates to the nearest error boundary, which today
is TanStack Router's own per-route `CatchBoundary`
(`node_modules/@tanstack/react-router/dist/esm/CatchBoundary.js`), whose built-in fallback renders
literally:

```
Something went wrong!            [Show Error]
```

— which is where the ticket's exact banner text comes from. `Match.js:39` resolves a route's error
component as `route.options.errorComponent ?? router.options.defaultErrorComponent`: no route sets
`errorComponent`, and `createRouter` in `packages/ui/src/router.tsx:162` sets no
`defaultErrorComponent` either, so every route falls through to the library default above.

`packages/ui/public/sw.js` already does `self.skipWaiting()` / `self.clients.claim()` on install —
a new service worker takes over an open tab's fetches immediately on deploy, with no reload prompt of
its own — and its `fetch` handler serves `/assets/*` from cache-or-network with no fallback for a
network 404. That is *why* an old tab's stale chunk request reaches the server as a real request at
all (nothing intercepts and serves a cached copy of a chunk that was never fetched before); it is not
something this change needs to touch to fix either defect, and reworking the service worker's update
lifecycle is a larger, separate piece of work if the daemon's upgrade cadence ever demands it.

## Decision: 404 the miss, not the fallback

`resolveFile`'s single miss-path is split by prefix. A path under the asset directory that misses
returns `null` all the way out to the route handler, which throws `OcError('not_found', ...)` — the
same envelope every other 404 in this server already returns (`packages/server/src/http.ts`'s
`onError`/`toOcError`), giving a JSON body and a real `404` status instead of `200 text/html`. A path
**not** under the asset directory keeps today's behavior exactly: miss → serve `index.html` (client
routes are not files on disk, and never should 404).

```ts
const ASSET_DIR = 'assets/';

app.get('*', async (c) => {
  if (!root) return c.html(PLACEHOLDER, 200);
  const requested = decodeURIComponent(new URL(c.req.url).pathname);
  const rel = normalize(requested).replace(/^(\.\.[/\\])+/, '').replace(/^\/+/, '');
  if (rel.startsWith(ASSET_DIR)) {
    const file = await resolveExisting(root, rel);
    if (!file) throw new OcError('not_found', `no built asset at /${rel}`);
    return serveFile(file);
  }
  const file = await resolveFile(root, requested); // unchanged app-route behavior
  if (!file) return c.html(PLACEHOLDER, 200);
  return serveFile(file);
});
```

(`resolveExisting` and `serveFile` are the existing path-safety check and response-building split out
of the current single function so both branches share them; exact shape is for the apply phase, not
prescribed further here.) The "UI not built at all" placeholder path is untouched — it only ever
applies when `root` itself is absent.

## Decision: recover once, then say what happened

`packages/ui/src/router.tsx`'s `createRouter` gets a `defaultErrorComponent`. Per `Match.js:39`, a
router-level default applies to every route that does not set its own `errorComponent` — i.e. all of
them today — so this is one change, not one per route.

A new module, `packages/ui/src/lib/chunkReload.ts`, holds the pure, directly-testable logic (per the
project convention of keeping product decisions out of anything jsdom struggles with):

- `isDynamicImportError(error: unknown): boolean` — matches the known browser wordings for a failed
  dynamic import (`failed to fetch dynamically imported module` / `error loading dynamically imported
  module` / `importing a module script failed`), not just the one Chromium spells out.
- `shouldReloadForChunkError(now = Date.now()): boolean` — `true` unless a reload for this same cause
  was already marked within a short window (a `sessionStorage` timestamp, following the existing
  `traceExpansion.ts`/`drafts.ts` pattern of a small wrapped accessor rather than raw calls). The
  window — not a single ever-lasting flag — is what lets a *later*, independent upgrade later the same
  session still get its own one-time reload instead of being permanently treated as "already tried."
  A failure that recurs inside the window is treated as a loop and stopped.
- `markChunkReload(now = Date.now()): void` — records the attempt.

The error component itself:

- Not a dynamic-import error → today's behavior: render the existing `ErrorState`, with `reset` wired
  to the boundary's own `reset()` (unchanged from what happens today, since nothing sets an error
  component now and it should not look different for a real bug).
- A dynamic-import error, first time (guard says yes) → mark the attempt, `window.location.reload()`,
  and render a brief "Updating…" state while the reload happens (there is no "cancel" — a stale tab
  cannot do anything useful with the old code anyway).
- A dynamic-import error, guard says no (already tried inside the window) → do **not** reload again;
  render a message that says the app was updated but the automatic reload did not finish it, with a
  manual reload action — distinct copy from the generic error, because "the app updated" is not the
  same fact as "the app broke," per the ticket's own framing.

This is the "reload once, prompting only if that does not work" shape the ticket calls conventional,
chosen over prompting-before-reloading because the fresh `index.html` is expected to fix it in the
overwhelming majority of cases and a silent, single reload is the least disruptive thing that could
work; a human is only asked to act once that optimistic path has already failed.
