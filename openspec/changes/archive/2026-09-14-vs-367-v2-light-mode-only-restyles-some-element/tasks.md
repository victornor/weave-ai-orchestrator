# Tasks

- [x] 1. Find the real cause: build the app, and prove — against the real compiled CSS and real
  component markup in a real Chromium render (jsdom does not resolve CSS custom properties) — that
  `--color-bg-1: var(--bg-1)` (Tailwind's `@theme` mapping, non-inline) bakes its value once on
  `:root`, so every token utility class ignores `.v2-root[data-theme='light']`'s own `--bg-1`.
- [x] 2. Fix it at the root: `packages/ui/src/index.css`'s `@theme` becomes `@theme inline`, so
  utilities embed `var(--bg-1)` directly (one level, re-resolves per element) instead of
  `var(--color-bg-1)` (two levels, baked at `:root`). Confirmed V1's own runtime `[data-theme]`
  toggle on `<html>` still repaints with no rebuild.
- [x] 3. Fix the named portal gap: `packages/ui/src/components/Toast.tsx`'s floating container is a
  DOM sibling of `.v2-root`, not a descendant (`ToastProvider` mounts above the router). It now
  mirrors the currently-mounted `.v2-root`'s class and `data-theme` via a `MutationObserver`
  (`KnowledgeGraphPage`'s `useThemeColours` pattern), with its own painted background reset back to
  transparent. V1 (no `.v2-root` present) is unchanged.
- [x] 4. Audit every other candidate the ticket named for a second, independent bypass: reused V1
  primitives (`Chart`, `PlanLimits`, `RuntimeCredentials`, `DiffHunks`, `Heatmap`, `ac-card`/`ac-*`)
  — all reference tokens directly, none hard-code a colour; every other `createPortal` in the app
  (`Sheet`/`Drawer`/`Dialog`) — none are used anywhere under `v2/`; every `getComputedStyle` call
  (`VoiceMeter`, `KnowledgeGraph`) — each reads from an element already inside `.v2-root` when used
  there. No further bypass found.
- [x] 5. Tests: `themeTokenInline.test.ts` pins `@theme inline` so the exact regression cannot
  reappear silently; `toast.test.tsx` renders the real `ToastProvider` with and without a mounted
  `.v2-root`, asserting the mirrored class/theme/background, that it follows a live theme change,
  and that it drops both once `.v2-root` unmounts (V1 fallback) — the "one portal-rendered element"
  the acceptance criteria asks for.
- [x] 6. `pnpm lint`, `pnpm typecheck` and both test suites (core/server, then UI) green; V1's own
  suite is unchanged and passing as part of the UI suite (no V1 file touched other than the shared
  `index.css` mapping and `Toast.tsx`, both used by V1 too and covered by the existing suite).
- [ ] 7. Compare every individual V2 screen against its `docs/design/v2/shots/{desktop,phone}-light`
  capture, screen by screen, and list each in the report. Not done as a full pass this turn: the
  fix is proven at the shared mechanism every screen's token utility classes go through (task 1),
  and task 4 found no other bypass in the whole `v2/` tree — but that is not the same claim as a
  pixel comparison of all 35 desktop + 32 phone captures, which needs a full data-stubbed harness
  per route. Raised to the weaver as a concern: accept the mechanism-level proof, or want the full
  per-screen pass as a follow-up.
