# Plugin styling: section spacing and the `hidden` attribute

Tracker change for [VS-465](weave://tickets/VS-465). A `task` ticket, so this change carries tasks
only — `skip_specs: true`.

## Why

Captain's rule is that a plugin inherits Weave's styling and ships no CSS of its own (VS-385,
2026-09-14). Two gaps in the generated plugin stylesheet (`generateV2PluginCss` in
`packages/core/src/artifacts/v2-theme.ts`) defeat that on a real plugin page:

1. **Adjacent sections sit flush (0px gap).** The vocabulary gives `.v2-card` and `.v2-table` their
   own surfaces but no vertical rhythm between them, so a page of stacked sections reads as one
   block. The Services plugin measured add card `0→296px`, update card `296→748px` (VS-381).
2. **`[hidden]` loses to the vocabulary.** The browser's `[hidden] { display: none }` has author
   origin and a lower specificity than the vocabulary's own `.v2-form-row { display: flex }`,
   `.v2-button { display: inline-flex }`, etc., so `<div class="v2-form-row" hidden>` stays visible.
   Plugins currently wrap hidden regions in classless containers to work around it.

## What changes

- **Section spacing.** `generateV2PluginCss` emits one hand-authored page-stack rule,
  `body > * + * { margin-top: var(--space-6); }`, alongside the existing hand-authored preflight
  reset. It uses a token the generated `:root` already defines (`--space-6` = 1rem, the design's own
  `--space-*` scale), so it needs no literal and no new vocabulary class — a plugin page stacks its
  top-level sections without changing its markup or bumping `@weave-ai/plugin-sdk`.
- **`[hidden]` wins.** The same hand-authored block gains `[hidden] { display: none !important; }`.
  The generated stylesheet only ever reaches a plugin document (inlined via `host.themeCss()` or
  pushed over the bridge), so the rule is scoped to plugin documents by construction.
- **Example.** `examples/plugins/notes` gains a second section and a toggled `hidden` form row.
- **Docs.** `docs/PLUGINS.md` documents both rules as part of the styling contract.
- **Tests.** `packages/core/src/artifacts/v2-theme.test.ts` asserts both generated rules.

## What was considered and rejected

- **A `page` container class in `WEAVE_PLUGIN_CLASS`.** It would require every plugin to opt in and
  change its markup, and adding a value is the one thing that changes the SDK's own shape (and so
  its published version). The page-stack rule fixes existing pages with no markup change.

## Out of scope

- The link role and table action cell (VS-458).
- Changing the Services plugin; its worker adopts this once this lands.
- VS-457 merges `index.css` and `v2.css` and moves the paths this generator reads; whichever lands
  second rebases.
