## Why

The V2 light/dark switch lives only in the sidebar footer, and the sidebar is `md:`-only, so at
phone width there is no way to change the theme at all. The settings screen even tells a phone user
that "Theme follows the switch in the V2 rail footer" — a control they cannot reach. Requested by
captain on 2026-09-17.

## What Changes

- Put the existing `ThemeSwitch` control into the More sheet — the surface the mobile navigation
  already uses for the destinations the phone tab bar leaves out (including Settings and the daemon
  update entry) — wired to the same `theme`/`onTheme` the rail footer uses. No new theme state, no
  new storage key, no new surface.
- Correct the This-device note in Settings so it does not point phone users at a control the phone
  layout does not show.
- Add a shell test proving the More sheet carries the switch and reports the chosen theme through
  the same callback as the rail.
- Verify with rendered phone-width captures of the More sheet in light and dark, and of the
  resulting themed page, confirming the mobile surfaces around the switch render legibly in light.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `web-v2/theme`: the light/dark switch requirement currently places the control only in the sidebar
  footer (and the collapsed rail). It gains the phone layout's control surface — the More sheet —
  while keeping the single persisted choice.

## Impact

- `packages/ui/src/v2/V2Shell.tsx` — render the existing `ThemeSwitch` in the More sheet, fed by the
  same `theme`/`onTheme` the rail already receives.
- `packages/ui/src/settings/sections.tsx` — the `themeControl === 'note'` copy.
- `packages/ui/src/test/v2shell.test.tsx` — one new test over the More sheet's theme control.
- No change to `v2/theme.ts`, its `weave.v2.theme` key, `V2Root.tsx`, the token set, or any desktop
  behaviour. Out of scope: redesigning the mobile navigation, adding themes, changing desktop theme
  behaviour, and unifying V2's theme key with V1's stale one.
