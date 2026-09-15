## Context

See proposal.md — Why. Ground truth read on this branch's base (`02283f2c`, VS-456):

- `.v2-table` is a flex column (`packages/ui/src/v2/v2.css` lines 435-479). A row is `[data-row]`
  (flex row, `gap: 12px`, `padding: 10px 14px`); the cells are `[data-cell='primary']`
  (`flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap`),
  `[data-cell='secondary']` (`flex: 0 0 auto`, mono, `--text-3`) and `[data-cell='actions']`
  (flex row, `gap: 6px`, `flex: 0 0 auto`, `margin-left: auto`). Rows are divided by
  `.v2-table [data-row] + [data-row] { border-top: 1px solid var(--line-1) }`.
- `generateV2PluginCss` (`packages/core/src/artifacts/v2-theme.ts`) emits only the class recipes
  listed in `COMPONENT_CLASS_PREFIXES` (line 53: `.v2-card`, `.v2-tag`, `.v2-button`, `.v2-input`,
  `.v2-form-row`, `.v2-table`), pulling each with `extractRulesByPrefix`, plus the re-rooted link
  recipe and the hand-authored page rules. A new class must be added to that list or it is absent
  from every plugin page.
- `packages/core/src/artifacts/v2-theme.test.ts` asserts every `WEAVE_PLUGIN_CLASS` value has a
  matching `.class {` rule in the generated output. `packages/ui/src/test/v2theme.test.ts` asserts
  every selector in `v2.css` starts with `.v2-`.
- The generated base `:root` carries `index.css`'s whole plain `:root` block, so the `--space-*`
  tokens are available to the emitted recipes (VS-465 already relies on `--space-6`).
- There is no browser-test dependency in the repo, and CI (`ubuntu-latest`) has no browser. Rendered
  verification in this project is a throwaway headless-Chromium harness, with captures left
  uncommitted and their paths reported (VS-206, VS-458, VS-465).

## Goals / Non-Goals

**Goals:**

- A real row — primary text, a long muted detail, and one or two row actions — fits and truncates at
  390px, with nothing pushed off-screen and no horizontal scroll.
- An edit form opens under a row using only the vocabulary: no card, no plugin CSS.
- Two or more row actions read as one right-aligned group.
- The generated stylesheet stays derivative of `v2.css`; a V2 restyle reaches an installed plugin
  with no plugin change and no new SDK version.

**Non-Goals:**

- No change to the Services plugin.
- No new colour, spacing or font value in `@weave-ai/plugin-sdk` — names only, as before.
- No committed browser-test infrastructure.
- No token or palette change.

## Decisions

**Decision 1 — Change `secondary`; do not add a cell role.** `[data-cell='secondary']` already *is*
"a right-aligned muted detail" (`docs/PLUGINS.md`), which is exactly what a deployment line is. The
fix is to let it shrink and truncate: `flex: 0 1 auto; min-width: 0; overflow: hidden;
text-overflow: ellipsis; white-space: nowrap`, and raise `primary`'s floor from `min-width: 0` to
`min-width: var(--space-9)` so a shrink can never collapse the main text either. On overflow the two
shrinkable cells absorb the loss in proportion to their content (`actions` is `flex: 0 0 auto`, so
it never gives ground), primary stops at its floor and secondary truncates.

*Alternatives considered:* (a) a new `metadata` cell role — rejected: it duplicates `secondary`'s
exact muted/mono look, forces every plugin to change markup to get the fix, and leaves the existing
role broken; it also grows the vocabulary, which VS-458's design deliberately keeps small.
(b) `min-width: min-content` on primary — rejected: with `white-space: nowrap` a flex item's
`min-content` is the whole string, so primary would never truncate and `actions` would overflow.

**Decision 2 — The panel is a class role on the table recipe, `v2-table-panel`.** A panel is a
structural region (like `.v2-card`/`.v2-table`), so it belongs in `WEAVE_PLUGIN_CLASS` (key
`rowPanel`), not in `WEAVE_PLUGIN_TABLE_CELL`, which holds `data-cell` attribute values. It is a
direct child of `.v2-table`, placed after the row it expands, so the table's own column flex makes
it full width. Its only rule is the divider: `border-top: 1px solid var(--line-1)`, the same
divider rows carry. Its content is the host's `.v2-form-row`s, which already supply the settings-form
label/field layout and the same 14px horizontal inset as a row — the panel therefore adds **no
padding of its own**, so a panel's fields align with the table without a doubled inset.

*Alternatives considered:* (a) a `data-panel` attribute — rejected: the vocabulary models structural
regions as classes and cell roles as attribute values; a panel is a region. (b) Giving the panel its
own padding — rejected: it would double-inset the `.v2-form-row`s the panel exists to hold.

**Decision 3 — Generalize the row divider to `.v2-table > * + *`.** A panel between two rows breaks
`[data-row] + [data-row]`, leaving the row after a panel with no divider. Replacing that rule with
`.v2-table > * + * { border-top: 1px solid var(--line-1); }` divides every child from its
predecessor — rows as before, a panel from its row, and a row from a panel. For existing markup the
computed result is identical.

**Decision 4 — Harden `actions` in place; add no name.** The cell already right-aligns with
`margin-left: auto` and carries a 6px gap. The change is to make that guarantee explicit:
`flex-wrap: nowrap`, the gap expressed as the design token that equals it today
(`gap: var(--space-3)` = 6px), and `.v2-table [data-cell='actions'] .v2-button { flex: 0 0 auto }` so
a control never shrinks. Nothing new is exported; the existing `WEAVE_PLUGIN_TABLE_CELL.actions` is
the group container and `docs/PLUGINS.md` now says so.

**Decision 5 — Rendered evidence is a throwaway headless-Chromium check, not a committed test.** The
acceptance's geometry assertions (button boxes inside the viewport, no horizontal scroll, truncated
not wrapped at 390) cannot be made in jsdom, which has no layout, and the repo has no browser-test
dependency or CI browser. Adding one is out of scope for a styling fix. So: committed automated
coverage is unit + generated-stylesheet + a jsdom cascade check where a cascade question is real,
and the geometry check is a throwaway Node script driving Chromium over CDP (as VS-379 did) against
a source-built scratch daemon serving the fixture page, at 1440×900 and 390×844. Captures are
uncommitted and their absolute paths reported on the ticket; per this worker's AGENTS.md they live
outside `work/`.

## Risks / Trade-offs

- **`secondary`'s overflow behavior changes for pages that exist today.** A page whose rows already
  fit renders identically; the only change is the case that was broken (a row that overflowed put
  `actions` off-screen). This is the ticket's intent. → The fixture captures the same page before
  and after and describes the difference.
- **`primary`'s `var(--space-9)` floor could still crowd `actions` at an extreme width.** At 390px
  a two-button group plus the floor and padding fit with room to spare. → The geometry check asserts
  every button box is inside the viewport at 390×844.
- **A panel draws no surface of its own, so a plugin that wants a recessed edit area gets the
  table's background.** That is the table-native look the ticket asks for (no second card). → A
  plugin wanting a distinct surface composes a `.v2-card` inside the panel if it must, and the docs
  say the panel itself is a divider + full-width region.
- **The divider generalization touches a `.v2-table` rule.** Only a direct non-row child changes
  behavior, and the only sanctioned one is the new panel. → The generated-stylesheet test asserts
  the emitted divider rule, and the captures confirm rows are unchanged.
- **`generateV2PluginCss` throws if a component prefix is missing.** Adding `.v2-table-panel` to
  `COMPONENT_CLASS_PREFIXES` makes the generator throw at daemon startup if the class is ever
  removed from `v2.css`. That is deliberate: it fails loudly at build/test time instead of shipping
  an unstyled panel.

## Migration Plan

Additive and release-scoped. No migration, no data change, no config change. The daemon generates
its plugin stylesheet at startup from the release's own `v2.css`; an upgraded release changes every
already-installed plugin page with no plugin or SDK change.

## Open Questions

None.
