## Why

The web app identifies itself with no brand mark at all: `WorkspaceNav.tsx` opens straight into
`<nav aria-label="Global">` with nothing above it, and `Login.tsx` / `Onboarding.tsx` still carry a
placeholder accent tile. captain supplied a tight crop of the Weave mark and had it traced as a
4-path SVG; the product's own lockup — the mark to the left of the wordmark — is what the app is
supposed to show, and nothing on screen shows it.

## What Changes

- Add one `WeaveMark` component in `packages/ui` that inlines the supplied SVG **verbatim** — the
  four paths, the `1860.444515 × 413.681337` viewBox and the provenance comment — with
  `fill="currentColor"`, no new dependency and no network fetch.
- Place the mark at the top of the sidebar rail, above the Global nav
  (`app/WorkspaceNav.tsx`). It is a new block, not a replacement for any existing sidebar entry.
- Place the mark on the login screen (`routes/Login.tsx`) and the onboarding frame
  (`routes/Onboarding.tsx`), taking the place of the placeholder accent tile to the left of the
  existing wordmark heading.
- Hold the artwork's **4.5:1** ratio everywhere: height drives the layout and width follows, the
  thread is never cropped to the knot, and the mark is never letterboxed into a square.
- Take the mark's colour from CSS text tokens so it is legible in both the dark and light themes.
- Follow context for the accessible name: `aria-hidden` where an adjacent wordmark already names
  it, `role="img"` with a label where it stands alone.
- Leave the wordmark text, `packages/ui/public/icon.svg`, `icon-maskable.svg`, the manifest and the
  service worker untouched.

## Capabilities

### New Capabilities
- `brand-mark`: the product's brand mark as a reusable UI component and how the web app places it —
  its artwork, its ratio, its colour source, its accessible name, and where it appears.

### Modified Capabilities
- (none) — this adds a mark that did not exist; no existing requirement changes.

## Impact

- `packages/ui/src/components/WeaveMark.tsx` — new.
- `packages/ui/src/app/WorkspaceNav.tsx`, `packages/ui/src/routes/Login.tsx`,
  `packages/ui/src/routes/Onboarding.tsx` — render the mark.
- `packages/ui/src/test/` — component and placement tests.
- No server, API, schema or dependency change. No change to the launcher tiles.
