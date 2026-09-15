## Why

VS-385 settled the plugin styling contract: a plugin page inherits V2's look through a small,
visual-value-free vocabulary, and the running daemon generates the stylesheet behind it from
`packages/ui/src/v2/v2.css`. Building the first real plugin — Services (VS-381) — exposed two gaps
in that contract:

1. **Links.** `.v2-link` lives in `v2.css` only as `.v2-root a.v2-link`. The generator extracts
   rules by a `.v2-*` class prefix and re-roots the tokens for a standalone document, so the link
   rule is never emitted, and a plugin page's `<a>` renders with the browser's default blue and
   underline. A plugin that wants a link has to style it locally, which is exactly what the
   contract forbids.
2. **Table actions.** The `.v2-table` recipe documents `[data-row]` and
   `[data-cell='primary'|'secondary']` only. There is no cell role for inline per-row controls, so
   the Services page puts editing in a separate form instead of a row's own buttons.

Both are small but concrete: without them a plugin page looks unfinished or must break the
"never style locally" rule. This change closes them in Weave AI itself, so the Services worker
adopts the vocabulary in a later PR with no workaround.

## What Changes

- Add a `link` role to `WEAVE_PLUGIN_CLASS` (value `v2-link`).
- Teach `generateV2PluginCss` to emit the link recipe from `v2.css`'s own `.v2-root a.v2-link`
  rules — re-rooted so it works in a plugin document (no `.v2-root` wrapper): the bare `<a>`
  element and `a.v2-link` are both styled, in dark and light via the theme tokens the generated
  stylesheet already carries.
- Add an `actions` cell role to the `.v2-table` recipe in `v2.css`
  (`[data-cell='actions']`), laid out for small buttons, plus a compact `.v2-button[data-size='small']`
  variant so a row's controls fit a table row. Export the cell roles from the SDK so a plugin names
  the role rather than spelling the attribute value.
- Update `docs/PLUGINS.md` with the link role, the table cell roles (including `actions`) and the
  compact button variant.
- Tests: the generated stylesheet contains the link and action-cell rules, and the SDK exports the
  link class and the action-cell role.
- Rendered evidence: a sample plugin page with a link and a table row carrying action buttons,
  captured inside the V2 frame in both dark and light.

**BREAKING (internal only):** none. `WEAVE_PLUGIN_CLASS` gains a key; the existing keys, the
generator's other recipes, and `docs/PLUGINS.md`'s existing contract are unchanged. A plugin that
ignores the new roles behaves exactly as it does today.

## Capabilities

### Modified Capabilities

- `plugins/web-pages`: the vocabulary gains a link role and a table action-cell role, and the
  daemon-generated stylesheet emits the rules behind both — including plain `<a>` — so a plugin's
  links and per-row controls are styled by V2 with no CSS of the plugin's own.

## Impact

- `packages/ui/src/v2/v2.css` — `[data-cell='actions']` on `.v2-table` and a
  `.v2-button[data-size='small']` variant; no token change.
- `packages/plugin-sdk/src/index.ts` — `WEAVE_PLUGIN_CLASS.link`, a `WEAVE_PLUGIN_TABLE_CELL` roles
  constant, and the doc block describing both.
- `packages/core/src/artifacts/v2-theme.ts` — `generateV2PluginCss` emits the link recipe
  (class + bare `a`) derived from `v2.css`; `v2-theme.test.ts` gains completeness assertions.
- `docs/PLUGINS.md` — the vocabulary section's link and table documentation.
- `examples/plugins/notes/index.js` — a link and a row action button, so the example exercises the
  new vocabulary (the rendered evidence is captured from it).