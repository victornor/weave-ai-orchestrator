## Context

See proposal.md — Why. Ground truth verified on `main` @ `1cd00c1e` (VS-443):

- `generateV2PluginCss(v2Css, indexCss)` (`packages/core/src/artifacts/v2-theme.ts`) is a pure
  function: it parses `v2.css`'s token blocks and pulls each component recipe out with
  `extractRulesByPrefix(css, '.v2-card' | '.v2-tag' | '.v2-button' | '.v2-input' | '.v2-form-row' |
  '.v2-table')`. The prefix matcher requires a comma-separated selector *part* to start with the
  prefix, and the output re-roots `:root, [data-theme='dark']` / `[data-theme='light']` because a
  plugin page has no `.v2-root` wrapper.
- `v2.css`'s link rule is `.v2-root a.v2-link { color: var(--accent-link); … }` and
  `.v2-root a.v2-link:hover { color: var(--accent-hover); }`. Its selector starts with `.v2-root`,
  so the prefix matcher never selects it, and its `.v2-root` scope would not match a standalone
  plugin document even if it did.
- `.v2-link` in the app is used on anchors *and* on `<button>` elements (settings "Reset", "+ Add
  option", "← pull requests", …). The rule's `a.v2-link` element qualifier is what keeps those
  buttons unstyled as links. Any change to the app rule must preserve that.
- The scoping test `packages/ui/src/test/v2theme.test.ts` asserts every selector in `v2.css` starts
  with `.v2-`, so a bare `a { … }` rule cannot be authored there.
- A `complete` drift test (`packages/core/src/artifacts/v2-theme.test.ts`) checks every
  `WEAVE_PLUGIN_CLASS` value has a matching rule in the generated output, and that a mutated
  `v2.css` value changes the output.

## Goals / Non-Goals

**Goals:**

- A plugin page's links — the class and a bare `<a>` — are styled by V2's own rules, in both themes,
  with no CSS in the plugin.
- A table row can hold inline per-row controls in an `actions` cell, sized for small buttons.
- The generated stylesheet stays derivative of `v2.css`: a restyle reaches an installed plugin with
  no SDK version change.

**Non-Goals:**

- No change to the Services plugin (VS-381) — its worker adopts the vocabulary later.
- No token or palette change; no new theme values.
- No change to the app's own link styling (`.v2-root a.v2-link` keeps meaning exactly what it does).
- Not merging the stylesheet paths the generator reads — VS-457 owns that; whichever lands second
  rebases.

## Decisions

**Decision 1 — Link rules: extract by a suffix matcher, not the class prefix.** The link selector is
`.v2-root a.v2-link`, which `extractRulesByPrefix` cannot see and whose `.v2-root` half is inert in a
standalone document. Rather than add a bare `.v2-link` rule to `v2.css` (which would drop the
`a.v2-link` element qualifier and start underlining the settings `<button class="v2-link">`
elements), the generator gains its own extractor that selects rules whose selector *ends* in
`a.v2-link`/`a.v2-link:hover` and emits them re-targeted at `a, a.v2-link` and
`a:hover, a.v2-link:hover`. The declarations are `v2.css`'s own rule bodies — only the selector head
changes, so the rule keeps tracking `v2.css`. The app keeps `.v2-root a.v2-link` untouched.

*Alternatives considered:* (a) add a bare `.v2-link` rule to `v2.css` — rejected: it would style the
settings buttons as links; (b) hand-author the link CSS in the generator — rejected: it duplicates
`v2.css`'s declarations and can drift, which is the thing VS-385's design forbids.

**Decision 2 — The action cell is a data-cell role on the table recipe.** `[data-cell='actions']`
is added to `v2.css` beside `primary`/`secondary`, and travels into the generated stylesheet for
free because it lives under the `.v2-table` prefix the generator already extracts. It uses
`margin-left: auto` to sit at a row's trailing edge, a flex row with a small gap, and `flex: 0 0
auto` so it never collapses. No new generator code is needed for it.

**Decision 3 — A compact button variant, since none exists.** `.v2-button` is 36px tall and 12px
text; a table row is 10px padding and 12px text, so a full-size button is oversized. `v2.css` gains
`.v2-button[data-size='small'] { height: 28px; padding: 0 8px; font-size: 11px; }`. It is an
attribute variant of the existing button recipe, not a new class, so the vocabulary stays a small
set of roles and the rule is extracted with `.v2-button`.

**Decision 4 — Cell roles live in their own SDK constant.** `WEAVE_PLUGIN_CLASS` is defined as
"class names only"; `data-cell` values are attribute values. Adding `actions` to that object would
break its own contract. Instead a new `WEAVE_PLUGIN_TABLE_CELL` constant
(`{ primary, secondary, actions }`) is exported beside it, and the `link` class is added to
`WEAVE_PLUGIN_CLASS`. Both are names only — no visual value — so the SDK keeps its versioning rule.

**Decision 5 — Evidence comes from the `notes` example.** The example plugin gains an anchor and an
actions cell so the vocabulary is exercised in a real page; the rendered evidence captures that page
inside the V2 frame in dark and light. This is the smallest in-tree page that already goes through
the bridge.

## Risks / Trade-offs

- **Styling every `<a>` in a plugin page is broad.** A plugin page is a standalone document with no
  app chrome, so a bare-`a` rule has nothing else to leak into. The class rule is the documented
  path; the bare element is the safety net the ticket asks for.
- **`a, a.v2-link` gives a plugin's `<a>` slightly higher specificity than the app's prose links.**
  Both resolve to the same tokens, so the rendered result is identical. → The drift test asserts the
  emitted rule's colour is a token, and the token itself is compared to `v2.css`.
- **A future V2 restyle that splits the link rule's selector shape** (e.g. moves off `a.v2-link`)
  would make the suffix matcher throw at generation time. → That is deliberate: the generator throws
  rather than silently emitting no link rule, and the daemon's existing fallback stylesheet covers
  the gap until the matcher is updated. The completeness test fails loudly instead of shipping an
  unstyled link.

## Migration Plan

Additive. No migration, no data change, no config change. The daemon generates the stylesheet at
startup from the release's own `v2.css`; an upgraded release changes every already-installed plugin
page with no plugin or SDK change.

## Open Questions

None.