## Why

Captain reads the weaver chat for long stretches and asked for a size he can choose; today the app's
type scale is fixed and the only way to read larger is browser zoom, which changes the whole layout
and is not remembered by the app. Separately, two semantic colours resolve to a *different hue* per
theme: the Approve control is saturated green in light and near-white in dark, and the
"reviewed — no concerns" line is emerald in dark and green in light. Both read as different controls
or different states to anyone who uses both themes, and neither difference was deliberate.

## What Changes

- Add a **text-size preference** to Settings, in the device-scoped *This device* section, with a live
  preview built from the real message components. Five steps — Smallest, Smaller, Default, Large,
  Largest — stored per device (localStorage), defaulting to today's size so an untouched install is
  pixel-identical.
- Implement it as **one multiplier on the app's type-scale tokens** (`--fs-*`), set on `.v2-root` as a
  `data-text-size` attribute, so every `text-*` utility in the app — the weaver chat included —
  scales from that single place. No second font-size mechanism and no chat-only hack.
- Scale the whole authored scale proportionally; verify the extremes with rendered captures that the
  smallest stays legible and the largest does not overflow or clip the chat, the composer or the
  decisions pane.
- Answer the **user-vs-weaver size question with evidence**: capture both directions at one setting
  and state the measured computed font sizes (both render through the same `MessageBody` and
  `text-body`; the visual difference is the narrower user bubble, not a larger font).
- Make the **Approve control an inverse high-contrast pair**, removing the green entirely: a dark
  fill with white ink in light (replacing the saturated green `#15803d`) and today's near-white fill
  with dark ink in dark, and unify the blocked state so light and dark use the same recipe.
- Fix **`--review-clean` to one hue across themes**: keep light's green hue (`#15803d`) and give dark
  the same hue at a lightness that clears contrast on the dark ground (`#4ade80`), in place of the
  emerald `#34d399`.
- Audit **every semantic colour token** for a per-theme hue divergence; fix the ones above, and name
  the ones deliberately left (the `--syntax-*` code palette) with the reason.
- Update the token tests (`v2theme.test.ts`) to assert same-hue-across-themes and the new values, and
  allow the `.v2-root[data-text-size]` rule the scale needs.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `web-v2/settings`: the *This device* section gains a text-size control with a live preview; it
  persists per device, defaults to the current size, and applies one app-wide type scale including
  the weaver chat.
- `web-v2/theme`: the type-scale tokens become a single scaled family; a semantic colour must resolve
  to the same hue in both themes; the affirmative action is a neutral fill, not a hue.
- `web-v2/decision-card`: the Approve control and the reviewed-clean line read those
  theme-consistent tokens and present the same control and state in both themes.

## Impact

- `packages/ui/src/index.css` — type-scale tokens gain a `--fs-scale` multiplier; `--approve`,
  `--approve-ink`, `--approve-blocked*` and `--review-clean` change values; `.v2-root` gains the
  `data-text-size` scale rules.
- `packages/ui/src/v2/` — a new `textSize.ts` (key, ladder, read/write, hook) beside `theme.ts` and
  `prefs.ts`; `V2Root.tsx` carries `data-text-size`; a text-size section added to the device settings
  body with a preview built from `ChatMessage`/`MessageBody`.
- `packages/ui/src/settings/sections.tsx` — the *This device* section gains the control.
- `packages/ui/src/test/v2theme.test.ts` and a new/extended UI test for the text-size ladder,
  persistence and same-hue tokens.
- No daemon, API, schema or CLI change. No new dependency. The setting is browser-local.
