## Context

See `proposal.md` for motivation. The constraints that shape the approach:

- The type scale lives in `packages/ui/src/index.css`'s theme-independent `:root` block as
  `--fs-display … --fs-nano` (rem values), re-exported to Tailwind by `@theme inline`
  (`--text-body: var(--fs-body)`, …), so `text-body`, `text-meta` and friends are the only route most
  components take to a font size. `.v2-root` and `body` each set `font-size: var(--fs-body)`.
- V2's theme is carried on `.v2-root` via `data-theme`, not `<html>` (VS-343), and `.v2-root` paints
  its own ground/ink (VS-482). `V2Root.tsx` owns the root div and the theme state.
- Settings is one global screen with a scope row and a section row (`web-v2/settings`). The
  daemon-scoped *This device* section already holds browser-local preferences (theme, silent turns);
  it is rendered with `themeControl="note"` in V2.
- The two decision cards are separate: `v2/DecisionCard.tsx` (Needs you, chat) renders the Approve
  control as a raw `.v2-button` with `data-variant="primary"`; `components/DecisionCard.tsx` (ticket
  page) uses the shared `Button` `variant="primary"` (`bg-accent`, already greyscale). Only the V2
  card reads `--approve`.
- `--approve` is near-white `#f2f3f5` in dark and green `#15803d` in light; `--review-clean` is
  emerald `#34d399` in dark and green `#15803d` in light. `--review-clean` is also the `passed` CI
  chip ink (`components/CiChip.tsx`).
- 19 components carry a hardcoded `text-[Npx]` (login, onboarding, shell), which would ignore a
  token-level scale.

## Goals / Non-Goals

**Goals:**
- One device preference that resizes the app's whole type scale, defaulting to today's sizes.
- The setting and its live preview in *This device*, built from the real message rendering.
- A token-level proof of the user-vs-weaver size question (same font size; narrower bubble).
- Semantic colours resolve to one hue across themes; Approve is neutral in both.
- Tests updated so the new values and the same-hue rule are enforced, not just documented.

**Non-Goals:**
- No daemon, API, schema or per-workspace setting; the preference is browser-local like theme.
- No arbitrary font-size slider and no per-component font overrides — one bounded ladder.
- No change to the syntax palette (a code colouring, not a semantic colour).
- No change to the ticket-page (`components/DecisionCard`) approve, which is already greyscale.

## Decisions

### 1. One multiplier on the type-scale tokens, applied as `.v2-root[data-text-size]`

Make each `--fs-*` a `calc(<base> * var(--fs-scale))` and declare `--fs-scale: 1` in `:root`, then
override it from attribute rules on the root the app already owns:

```css
.v2-root[data-text-size='xs'] { --fs-scale: 0.9; }
.v2-root[data-text-size='sm'] { --fs-scale: 0.95; }
.v2-root[data-text-size='lg'] { --fs-scale: 1.1; }
.v2-root[data-text-size='xl'] { --fs-scale: 1.2; }
```

`V2Root.tsx` puts `data-text-size={size}` on the same `.v2-root` div it already gives `data-theme`.
Because Tailwind's `@theme inline` defers to `var(--fs-body)` at the consuming element, every
`text-*` utility resolves against the scoped multiplier with no second mechanism.

*Alternatives considered:* scaling the document root's `font-size` (also resizes spacing, borders and
radii, because they are rem-based — a layout change, not a type-scale change); a chat-only font-size
(a second mechanism the ticket explicitly forbids); per-component overrides (drift, and no single
place). Chosen because it is exactly "scale the type scale from one place".

*Consequence:* three deliberate test edits are needed — the `text-[Npx]` literals are converted to
scale tokens so no surface is left stale, and `v2theme.test.ts`'s rule banning any `.v2-root[X]`
selector is narrowed to permit the `data-text-size` selectors while still banning theme token scoping
and descendant rules.

### 2. The ladder is five bounded steps, default `md` = 1

`TEXT_SIZE_STEPS` in a new `v2/textSize.ts`:

| key | label | scale |
|---|---|---|
| `xs` | Smallest | 0.9 |
| `sm` | Smaller | 0.95 |
| `md` | Default | 1 |
| `lg` | Large | 1.1 |
| `xl` | Largest | 1.2 |

Stored under `weave.v2.textSize` (the `weave.v2.*` family, beside `weave.v2.theme` and
`weave.v2.rail`), read with a fallback to `md` for an absent or junk value, so an untouched install
is unchanged. `0.9` keeps the `text-body` reading size ≈12.6px; `1.2` tops body out ≈16.8px. The
apply verifies both extremes against rendered captures and narrows a bound if the smallest reads
illegibly or the largest clips.

### 3. State via `useSyncExternalStore` in the module, not a new context

`v2/textSize.ts` owns the value, the ladder and a module-level subscriber set; `useTextSize()` reads
it with `useSyncExternalStore` and `setTextSize` writes localStorage and notifies. `V2Root` and the
settings section both call the one hook, so they cannot disagree. *Alternative:* a React context like
`V2ThemeContext`; not chosen because the root and the control are already in one tree and the module
keeps the storage contract in one file that a unit test can exercise without mounting providers.

### 4. The preview reuses the real message components

Extract the bubble container currently inline in `ChatMessage.tsx` into an exported `MessageBubble`
(its `mine`/`w-full`, bubble classes and padding), and render two of them in the settings section
through `MessageBody` with real prose. The user bubble's `max-w-[78%]` produces the narrower column
in the preview exactly as in chat. *Alternative:* a bespoke preview with copied classes; rejected
because it would drift from the thing it previews.

### 5. The user-vs-weaver question is answered by measurement, not by eye

The captures pair a user message and a weaver reply at one setting, and the apply records the
computed `font-size` of each body measured in a real headless Chromium (jsdom cannot resolve `var()`
or lay anything out). Expected: both are byte-identical `font-size`/`line-height` from the same
`text-body` class; the visual size difference is the 78%-width bubble. If the measurement disagrees,
the finding replaces the expectation in the report.

### 6. Approve becomes one neutral fill; review-clean keeps one green hue

- **Captain's decision (2026-09-18): the Approve control is an inverse pair, not one fill.** In light
  it is a dark fill (`#3d4148`, the greyscale accent) with white ink; in dark it stays today's
  near-white fill (`#f2f3f5`) with dark ink (`#0b0b0d`). Green is removed from the control entirely,
  so hue stays reserved for live state. Each fill's own ink clears contrast (light 10.25:1, dark
  ~17:1), and the control is the same inverse high-contrast action against each ground. This
  deliberately supersedes the plan's first reading of "just dark in dark mode"; the conductor
  relayed captain's choice of the inverse pair on 2026-09-18.
- `--review-clean: #4ade80` dark, `#15803d` light — the same green hue (≈142°); the dark value is
  lighter to clear 11.3:1 on the dark card. `#34d399` (hue ≈158°, the "teal") is dropped.
- Blocked Approve gets one recipe in both themes: a muted neutral fill (`#222226`/`#868c95` dark,
  `#eaecef`/`#565a61` light), applied without the `:not([data-theme='light'])` guard, so a disabled
  action is not a different control per theme.
- `CiChip`'s `passed` tone follows `--review-clean` and so stops diverging by theme too; recorded in
  the report rather than given its own token, because it is the same "clean" meaning.

*Alternatives considered:* one neutral fill in both themes (the plan's first choice; captain chose the
inverse pair instead); a restrained green Approve in both themes (rejected — the design reserves hue
for live state); an outline Approve (rejected — weaker than the card's ordinary action should be).

### 7. Hue audit method and result

A hue comparison of every paired token (HSL hue, dark vs light) was run over `index.css`:

| tokens | dark hue → light hue | verdict |
|---|---|---|
| `--approve`, `--approve-ink` | 220°/near-white → 142° green | **fixed** (decision 6: no hue either theme, inverse pair) |
| `--review-clean` | 158° → 142° | **fixed** (decision 6) |
| `--status-*` (idle/working/stalled/blocked/needs-you/merging/done/failed/paused) | each pair within 1–3° | fine |
| `--diff-add-fg`, `--diff-remove-fg`, `--diff-*-bg` | within 4° | fine |
| `--project-1…5` | within 3° | fine |
| `--accent*` | 218° both | fine |
| `--syntax-string` (95°→123°), `--syntax-meta` (354°→288°), `--syntax-comment` | diverge | **left, with reason**: a per-theme code palette, not a semantic colour (theme spec exempts it) |

The apply re-runs this comparison and records the final table on the ticket.

## Risks / Trade-offs

- **Smallest step reads too small** (nano ≈8.75px) → the acceptance judges the reading text; the
  apply captures the smallest at desktop and phone width, and narrows the floor if it fails. The
  ladder is data, so narrowing is a one-line change.
- **Largest step clips the chat/composer/decisions pane** → the pane is width-constrained, not
  height-constrained, so overflow would come from wrapping prose in a fixed-height row; the apply
  captures the largest at both widths and narrows the ceiling if anything clips.
- **`calc()` in `--fs-*` breaks a consumer that assumed a literal** → only `index.css` and the tests
  read `--fs-*` as literals; `v2theme.test.ts` reads other tokens and does not parse `--fs-*`.
- **`useSyncExternalStore` writes during render** → the setter only runs in an event handler; reads
  are pure, so no tearing.
- **Converting `text-[Npx]` changes a pixel value** → each conversion picks the nearest scale token;
  the login/onboarding/shell captures at default confirm they look unchanged.
- **Two DecisionCards, one token** → the ticket-page card uses `bg-accent` and is untouched; the
  report names it so a reviewer does not expect it in the captures.

## Migration Plan

No data or protocol migration. The preference is absent by default and resolves to `md`; removing the
key restores the default. Rollback is the commit itself — the tokens change values, no structure.

## Open Questions

None that would change the specs or the task breakdown. The exact ladder bounds are settled by the
apply's rendered-capture check, which the tasks already require.
