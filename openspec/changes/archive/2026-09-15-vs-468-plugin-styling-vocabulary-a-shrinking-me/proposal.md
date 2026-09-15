## Why

The plugin styling contract (VS-385) says a plugin page is styled entirely by Weave's vocabulary and
ships no CSS of its own. Building the first real plugin — Services (VS-381) — showed that the
`.v2-table` recipe is not usable for a real row:

1. **The metadata cell cannot shrink.** `[data-cell='secondary']` is `flex: 0 0 auto`, so a long
   value (a deployment line of commit, version, actor and time) takes the row's whole width at
   390px, squeezes `primary` to nothing and pushes `actions` off-screen. The Services plugin had to
   move all variable text into `primary` and lose the muted mono look to work around it.
2. **There is no inline row panel.** An edit form opened under a row has to be a `.v2-card` dropped
   into the `.v2-table`, which draws a second card border and radius inside the table.
3. **Row-action grouping is undocumented and fragile.** The `actions` cell can hold buttons, but
   nothing says a group of two or more right-aligns with a consistent gap, and the cell has no
   guard against its buttons wrapping or shrinking.

None of this can be fixed inside the Services plugin without shipping local CSS, which the contract
forbids. It belongs in Weave AI.

## What Changes

- **Metadata cell shrinks and truncates.** Make the existing `secondary` cell shrink after `primary`
  keeps a minimum, with an ellipsis and its muted/mono look unchanged. Chosen over adding a new cell
  role — `secondary` *is* the muted detail cell, and this fixes every existing page with no markup
  change and no new SDK name (see design.md Decision 1).
- **Inline row panel.** Add a `rowPanel` role to `WEAVE_PLUGIN_CLASS` (class `v2-table-panel`): a
  full-width region a plugin places after a row inside `.v2-table`, divided from it exactly as rows
  are divided, holding the host's own `.v2-form-row`s so fields look like a settings form.
- **Row action group.** Keep the `actions` cell as the group container, harden it so two or more
  small buttons stay right-aligned with a consistent gap and never wrap or shrink, and document the
  grouping.
- **Docs and SDK.** Document every new and changed name in `docs/PLUGINS.md`; export the new class
  from `@weave-ai/plugin-sdk`.
- **Compatibility.** Every existing vocabulary name keeps working. A page that fits today renders
  unchanged; the only rendering that changes is the overflow case this ticket exists to fix.

## Capabilities

### Modified Capabilities

- `plugins/web-pages`: the table recipe gains a shrinking metadata cell, an inline row panel, and a
  documented, hardened row-action group; the SDK and the daemon-generated stylesheet carry the new
  panel role and the changed cell recipe.

## Impact

- `packages/ui/src/v2/v2.css` — the `.v2-table` cell rules (`secondary`, `primary`), the divider
  rule, the new `.v2-table-panel` recipe, and the `actions`-cell guard.
- `packages/plugin-sdk/src/index.ts` — `WEAVE_PLUGIN_CLASS.rowPanel` and the doc block.
- `packages/core/src/artifacts/v2-theme.ts` — the completeness set gains `.v2-table-panel` so the
  generated plugin stylesheet carries the panel rule.
- `packages/plugin-sdk/src/vocabulary.test.ts`, `packages/core/src/artifacts/v2-theme.test.ts` —
  completeness and recipe assertions.
- `docs/PLUGINS.md` — the vocabulary's table section.
- `examples/plugins/notes/index.js` — exercises a long metadata value, an open panel and a two-button
  action group (also the fixture for the rendered evidence).

## Out of scope

- Changing the Services plugin; it adopts the new roles in its own follow-up.
- Any token or palette change.
- A committed browser test suite. The geometry check runs against a source-built daemon with
  headless Chromium and reports captures; the repo keeps no browser-test dependency (design.md
  Decision 5).
