# Tasks

## 1. V2 recipes in `v2.css`

- [x] 1.1 Add `[data-cell='actions']` to the `.v2-table` recipe (flex row, small gap, `flex: 0 0 auto`, trailing-aligned, sized for small buttons).
- [x] 1.2 Add the `.v2-button[data-size='small']` compact variant (28px height, 8px side padding, 11px text) beside the existing button recipe.

## 2. Plugin SDK vocabulary

- [x] 2.1 Add `link: 'v2-link'` to `WEAVE_PLUGIN_CLASS`.
- [x] 2.2 Export `WEAVE_PLUGIN_TABLE_CELL` (`primary`, `secondary`, `actions`) and update the surrounding doc block.

## 3. Generated stylesheet

- [x] 3.1 Add a link extractor to `generateV2PluginCss` that pulls `v2.css`'s `a.v2-link` rules and emits `a, a.v2-link` / `a:hover, a.v2-link:hover` with the source rule's own declarations.
- [x] 3.2 Emit the link rules (and the existing recipes) into the generated output, throwing if no link rule is found.

## 4. Tests

- [x] 4.1 Assert the generated stylesheet contains the bare-`a`/`a.v2-link` link rule and the `[data-cell='actions']` rule.
- [x] 4.2 Assert `WEAVE_PLUGIN_CLASS.link` and `WEAVE_PLUGIN_TABLE_CELL.actions` are exported with the expected values.
- [x] 4.3 Keep the completeness drift test green (every `WEAVE_PLUGIN_CLASS` value has a rule) and prove it bites for `link`.

## 5. Docs and evidence

- [x] 5.1 Update `docs/PLUGINS.md` with the link role, the table cell roles including `actions`, and the compact button variant.
- [x] 5.2 Add a link and an actions cell to `examples/plugins/notes`, and capture the page inside the V2 frame in dark and light as the rendered evidence.

## 6. Verify

- [x] 6.1 `pnpm lint && pnpm typecheck && pnpm test` are green (both suite blocks reported verbatim).