## Why

Since `fd2c33c417` (the `fd2c33c417` release, after VS-457 deleted V1 and merged the two
stylesheets), V2 light mode renders a black page with near-white sidebar ink. VS-457's merge dropped
one rule from the deleted `packages/ui/src/v2/v2.css`: the `.v2-root` base rule that painted the app
root with `background: var(--bg-0)` and `color: var(--text-1)`. V2 declares its theme on `.v2-root`,
not on `<html>` (VS-343), so with that rule gone the document root paints through as dark (the
`:root` token default) and the app is dark ink on a black ground however V2's own switch is set.

## What Changes

- Restore the `.v2-root` base rule in `packages/ui/src/index.css`: `background: var(--bg-0)`,
  `color: var(--text-1)`, and the base typography it carried (family, size, line-height,
  font-feature-settings, smoothing), so the V2 app is self-contained on its own root again.
- Keep the single token pair keyed on the bare `data-theme` attribute (`:root, [data-theme='dark']`
  and `[data-theme='light']`), so the tokens resolve whether the attribute is on `<html>` (the
  first-paint script in `index.html`) or on `.v2-root` (React). This is the merged stylesheet's
  structure and the artifact generator's markers depend on it.
- Add a regression test that fails on current `main` and passes after: it asserts `.v2-root` declares
  its own painted ground and ink (`background: var(--bg-0)`, `color: var(--text-1)`), which is
  exactly the rule the merge dropped.
- Correct the merged stylesheet's header comment, which currently claims "the `.v2-root` token scope
  is gone" and does not mention the paint rule.
- Produce rendered light/dark evidence (Chat, Work, Settings at 1440, plus light at 390) from a
  source-built scratch daemon and publish it as an artifact.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `web-v2/theme`: adds the requirement that the V2 root paints its own ground and ink, so the app's
  theme is self-contained on `.v2-root` and a document root carrying a different theme cannot leave
  the app ground dark or its inherited ink light.

## Impact

- `packages/ui/src/index.css` — re-add the `.v2-root` base rule; comment fix.
- `packages/ui/src/test/` — one new regression test over the stylesheet source.
- No change to `index.html`, `V2Root.tsx`, `v2/theme.ts`, the token values, or the artifact kit
  markers. `packages/core/src/artifacts/v2-theme.ts` and `kit.ts` keep resolving the same
  `[data-theme='dark']` / `[data-theme='light']` / `body` markers; the new `.v2-root` rule is not a
  marker and is not extracted by any component prefix.
- Deliberately out of scope: unifying where the theme attribute lives. The `<html>` first-paint
  script still reads the stale V1 key `conductor.theme` and V2 still owns `weave.v2.theme`
  (VS-343); that mismatch is pre-existing and was not what regressed in `fd2c33c417`. Restoring the
  paint rule makes the app correct under it, exactly as it was before V1 was deleted.