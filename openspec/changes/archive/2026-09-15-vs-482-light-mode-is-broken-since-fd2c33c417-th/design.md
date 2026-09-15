## Context

See `proposal.md` — Why. The relevant current state:

- `packages/ui/src/lib/theme.ts` writes `data-theme` on `<html>`, but after VS-457 nothing calls it
  except the (now unreachable) V1 settings section. `packages/ui/src/v2/theme.ts` writes V2's own
  key and `V2Root.tsx` puts `data-theme` on the `.v2-root` element, not `<html>`.
- `index.html` carries `<html data-theme="dark">` and a first-paint script that reads the stale V1
  key `conductor.theme`, so `<html>`'s theme and `.v2-root`'s theme can disagree.
- In `packages/ui/src/index.css` the dark tokens are keyed `:root, [data-theme='dark']` and the
  light tokens `[data-theme='light']`. Because `:root` is in the dark selector, `<html>`/`body` are
  dark unless the document carries `data-theme="light"`.
- `body` sets `background: var(--bg-0)` and `color: var(--text-1)` in `@layer base`. `V2Page`'s body
  region and `V2Root`'s own `div` set no background, so the app ground is whatever `body` resolves.
- A rule-diff of the deleted `packages/ui/src/v2/v2.css` against the merged `index.css` finds
  exactly one missing top-level rule:

  ```css
  .v2-root {
    background: var(--bg-0);
    color: var(--text-1);
    font-family: var(--ff-ui);
    font-size: var(--fs-body);
    line-height: 1.5;
    font-feature-settings: 'tnum' 1, 'cv05' 1;
    -webkit-font-smoothing: antialiased;
  }
  ```

  (The old file also declared the token names on `.v2-root`; VS-457 moved those to
  `:root, [data-theme='dark']` / `[data-theme='light']` deliberately, and `@theme inline` makes the
  utilities re-resolve per element, so that half of the merge is sound.)

- `packages/ui/src/components/Toast.tsx` already documents the expectation: its container mirrors
  `.v2-root`'s class for the tokens "only its token declarations are wanted here, on a container
  that must stay invisible", and pins `style={{ background: 'transparent' }}`.

## Goals / Non-Goals

**Goals:**

- V2 light mode repaints the ground, panels and inherited ink light, on every V2 page, and dark mode
  is byte-identical to today.
- The app is correct regardless of the theme on `<html>`, which is the same independence V2 had
  before V1 was deleted.
- One automated regression test that fails on current `main` and passes after the fix.

**Non-Goals:**

- Moving where the theme attribute lives, unifying the two theme keys, or removing the stale V1 key
  from `index.html`'s first-paint script (see Decisions).
- Changing any token value, and any V2 screen or component markup.
- Changing the artifact-kit generator or its markers.

## Decisions

### Decision 1: Restore the dropped `.v2-root` paint rule

The fix is to re-add the one rule the merge dropped, with its original declarations, placed in the
theme section of `index.css` (before the theme-independent `:root` block is also acceptable; it
carries no custom properties, and `V2_BASE_TOKEN_NAMES` extracts only the plain `:root` block, so
the rule is invisible to `generateV2PluginCss`).

- *Why not "patch the body rule" or hardcode a light background:* `body` cannot know V2's theme —
  the theme lives on `.v2-root`, which is a descendant. Painting on `.v2-root` is the element that
  actually carries the tokens.
- *Alternatives considered:* give `V2Root`'s `div` a Tailwind `bg-bg-0 text-text-1` utility. Rejected:
  it splits the paint contract between markup and stylesheet, and the deleted stylesheet's rule also
  carried base typography. Restoring the stylesheet rule keeps one source and is exactly the
  pre-V1-deletion state.

### Decision 2: Keep the token pair keyed on the bare `data-theme` attribute

Tokens stay `:root, [data-theme='dark']` and `[data-theme='light']`. A bare attribute selector
matches whichever element carries it, so the tokens resolve correctly when `data-theme` is on
`<html>` (first paint) and on `.v2-root` (React) — the acceptance's both-places requirement.

- *Alternative:* re-scope the tokens back to `.v2-root` / `.v2-root[data-theme='light']`, as the old
  `v2.css` had. Rejected: it is a larger change for a regression fix, `<html>` would be left with no
  tokens at all, and `generateV2PluginCss` / `kit.test.ts` / `v2-theme.test.ts` all locate the theme
  blocks by the current markers. Scoping the tokens is a separate question from the dropped paint
  rule, and nothing in the report points at it.

### Decision 3: Do not unify the theme source

The `<html>`/`.v2-root` mismatch is real and pre-existing; it is the condition that made the dropped
rule visible, not the regression. Unifying it (driving `<html>` from `weave.v2.theme`, deleting the
V1 key from `index.html`) changes first-paint behavior and the theme architecture, and is not what
"restore it exactly as it was" asks for. It is called out as out of scope in the proposal; if it is
wanted, it is its own ticket.

### Decision 4: Regression test asserts the paint contract in the stylesheet source

There is no browser in the test suite (no Playwright/Puppeteer), and jsdom does not resolve custom
properties in computed styles (see `[[web-app-testing]]` and `v2-theme.dom.test.ts`'s own comment).
So the automated test parses `packages/ui/src/index.css` — the repo's established pattern
(`themeTokenInline.test.ts`, `kit.test.ts`) — and asserts that a `.v2-root` rule declares
`background: var(--bg-0)` and `color: var(--text-1)`. On current `main` there is no such rule, so it
fails; after the fix it passes. Actual computed colours are proven by the rendered evidence below,
not by jsdom.

## Risks / Trade-offs

- *The restored `background` could paint a container that mimics `.v2-root` for its tokens.* The
  toast container is the only such case and already pins `background: transparent` inline (which
  outranks the rule); its test covers the contract. → Keep the existing toast test green.
- *The rule could change dark mode.* The declarations are theme-agnostic (`var(--bg-0)` /
  `var(--text-1)`); in dark they resolve to today's values, and `body` already paints the same
  colours. The screenshot evidence captures dark Chat/Work/Settings to confirm no drift.
- *Stylesheet source parsing is brittle to rule formatting.* → Assert on extracted declarations, not
  whitespace, matching how the existing parser tests behave.

## Migration Plan

CSS-only; no data, no API, no config. Nothing to migrate. After merge, captain's `weave daemon
upgrade` deploys the built UI; there is no separate step for this change.

## Open Questions

None.