# V2 light mode repaints every element, not just some

Tracker change for [VS-367](conductor://tickets/VS-367). A `task` ticket, so this change carries
tasks only — `skip_specs: true`.

## Why

Switching V2 to light mode changed only a handful of elements; the rest stayed on V1's dark
palette. `v2.css` declares a full light override under `.v2-root[data-theme='light']`, and V2
components use token classes (`bg-bg-1`, `text-text-1`, …), not hard-coded colour — so the tokens
looked complete and the components looked clean, and the cause was not visible by reading either.

The actual cause is in `index.css`'s Tailwind v4 mapping:

```css
@theme {
  --color-bg-1: var(--bg-1);
  …
}
```

A custom property's value is resolved once, at the element that declares it — here `:root` — using
whatever that element's own cascade gives `--bg-1` at that point. The **result** of that resolution,
not a live reference, is what inherits down the tree. So every Tailwind utility class built on
`--color-bg-1` (`bg-bg-1`, `text-text-1`, and every other `bg-*`/`text-*`/`line-*` utility) keeps
reading `<html>`'s `--bg-1` forever, no matter what `--bg-1` is redeclared to further down — including
under `.v2-root[data-theme='light']`. Confirmed against a real Chromium render (`getComputedStyle`),
not jsdom, which does not resolve CSS custom properties at all.

The "some elements" that did restyle correctly were the ones bypassing this indirection: v2.css's
own hand-written rules (`.v2-card`, `.v2-row`, …) and a couple of inline styles, which reference
`--bg-1`/`--text-*` directly — one level of `var()`, which does re-resolve per element.

A second, independent gap: `ToastProvider` mounts once at the app root, above the router
(`main.tsx`), so its floating toast container is a DOM **sibling** of `.v2-root`, not a descendant.
It never received V2's tokens or `data-theme` by inheritance regardless of the fix above — a portal-
adjacent case the ticket named explicitly.

## What changes

- `packages/ui/src/index.css`: `@theme` becomes `@theme inline`, so Tailwind emits `var(--bg-1)`
  (one level) directly into each utility class instead of through `--color-bg-1` (two levels). This
  is the one-line, root-cause fix — every V2 component using a token utility class repaints on
  `.v2-root[data-theme='light']` with no per-component change. V1's own runtime `[data-theme]`
  toggle on `<html>` (no reload) still works identically: confirmed by simulating the switch on a
  built stylesheet in a real browser before and after the change.
- `packages/ui/src/components/Toast.tsx`: the toast container mirrors whichever `.v2-root` is
  currently mounted in the document — its class and its `data-theme` — via a `MutationObserver`,
  the same technique `KnowledgeGraphPage`'s `useThemeColours` already uses for the same reason. The
  mirrored class also paints `.v2-root`'s own background, which the container must not show (it is a
  transparent overlay around the actual toast cards), so that one property is reset back inline. V1
  (no `.v2-root` in the document) is unaffected — the container gets neither the class nor the
  attribute, exactly as before.
- No change to V1's own styling, no change to `v2.css`'s token values.

## Verification

Every V2 screen was compared against the light captures in `docs/design/v2/shots/desktop-light/`
and `phone-light/` (via a throwaway, uncommitted real-Chromium render of the compiled app — not
checked in; jsdom cannot resolve CSS custom properties, so this could not be done any other way).
Since the root cause is a single shared mapping every V2 component's token utility class goes
through, fixing it corrects every V1-primitive-reused-in-V2 (`Chart`, `PlanLimits`,
`RuntimeCredentials`, `DiffHunks`, `Heatmap`, `ac-card`/`ac-*`) and every plain V2 page at once,
rather than screen by screen.

## Out of scope

Any visual mismatch that is not a dark-vs-light token error (spacing, layout) — none was found in
this pass, but that is a distinct kind of bug from the one this ticket reported.
