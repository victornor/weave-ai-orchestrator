# Screenshotting a packages/ui route without a daemon

How to render a single `packages/ui` route to a static screenshot for visual review, with no
daemon running.

## Steps

1. Add a temporary `screenshot.html` + `src/screenshot.tsx` that seeds a `QueryClient` by `qk`
   key (`staleTime: Infinity`), and wraps the target route in `WorkspaceProvider` plus a memory
   router (`/w/$ws` → `AppShell` is enough).
2. Stub `window.EventSource` before the app boots — otherwise the connection banner shows.
3. Stub `window.fetch` for `/api/*` before the app boots, returning the seeded data.
4. `pnpm exec vite`, then `chromium --headless --window-size=1440,900 --virtual-time-budget=6000 --screenshot`.
5. Delete the harness before committing — it is throwaway, not a fixture.

VS-81 shot the rail and bar this way.

## Landmines

- Vite in this environment binds `[::1]` only (`127.0.0.1` gets connection refused). A
  screenshot harness at `--port 5274` must be fetched as `http://[::1]:5274/...`.
- A second root `*.html` file (this harness's `screenshot.html` alongside the app's own
  `index.html`) makes Vite's cold-start `optimizeDeps` scan crash on workspace package
  resolution (`@weave-ai/shared`, `@weave-ai/render`) and the dev server dies.
  Start `vite` on the app's real `index.html` first to warm its dependency cache, *then* add
  `screenshot.html`/`screenshot.tsx` and request them through that already-running server —
  don't cold-start with both present.
- **`--virtual-time-budget` silently freezes `requestAnimationFrame`.** Chromium's virtual clock
  advances `setTimeout`/`setInterval` normally, but nothing drives a real compositor frame under
  it, so any `requestAnimationFrame`-based loop — including a `d3-force` simulation, or this
  app's own view-tween easing — never ticks past its first frame. A capture taken this way looks
  plausible (no error, a fully-rendered DOM) but is silently wrong: it shows the *seeded*, barely
  laid-out state, not the settled one, with no signal that anything is off. Use
  `--virtual-time-budget` freely for letting `setInterval`-driven setup (e.g. an auto-clicking
  harness helper) run, but never to represent "the layout has settled" — for that, drop
  `--virtual-time-budget` entirely and let Chromium run in real wall-clock time instead (a
  synchronous `chromium --headless --screenshot` invocation, with no `--virtual-time-budget`
  flag, captures shortly after real page load and lets real animation frames run up to that
  point). VS-193 shipped its first round of "confirmed" root-cause screenshots this way by
  mistake — the propose-phase captures were all accidentally frozen at tick 1.
