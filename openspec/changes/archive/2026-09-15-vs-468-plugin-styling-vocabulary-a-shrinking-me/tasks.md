# Tasks

## 1. V2 table recipes in `packages/ui/src/v2/v2.css`

- [x] 1.1 Make the metadata cell shrink and truncate: `[data-cell='secondary']` becomes `flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap`, keeping its mono/`--text-3` look. Raise `[data-cell='primary']`'s `min-width` from `0` to `var(--space-9)`. Verify with the generated-stylesheet test in 4.2 and the geometry check in 6.2.
- [x] 1.2 Replace `.v2-table [data-row] + [data-row]` with `.v2-table > * + *` for the row divider, so a panel (1.3) and the row after it are divided too. Verify the rule is emitted by the generated-stylesheet test in 4.2 and that existing rows are unchanged in the captures (6.3).
- [x] 1.3 Add the `.v2-table-panel` recipe (full-width region under a row: `border-top: 1px solid var(--line-1)`, no padding of its own so its `.v2-form-row` children keep the table's 14px inset) with a comment naming the gap it closes. Verify the rule appears in the generated stylesheet (4.2) and that a panel renders under a row in the captures (6.3).
- [x] 1.4 Harden the actions group: `flex-wrap: nowrap` on `[data-cell='actions']`, its gap changed to `var(--space-3)` (6px, unchanged in value), and `.v2-table [data-cell='actions'] .v2-button { flex: 0 0 auto; }`. Verify with the generated-stylesheet test in 4.2 and the geometry check in 6.2.
- [x] 1.5 Confirm `packages/ui/src/test/v2theme.test.ts`'s "every selector starts with `.v2-`" check still passes for the new rules (it will, but run it).

## 2. Plugin SDK vocabulary (`packages/plugin-sdk/src/index.ts`)

- [x] 2.1 Add `rowPanel: 'v2-table-panel'` to `WEAVE_PLUGIN_CLASS` and extend the object's doc block to describe the panel role (names only, no visual value). Verify with the SDK test in 4.1.

## 3. Generated plugin stylesheet (`packages/core/src/artifacts/v2-theme.ts`)

- [x] 3.1 Add `'.v2-table-panel'` to `COMPONENT_CLASS_PREFIXES` so the generated stylesheet carries the panel rule and the generator throws if the class ever leaves `v2.css`. Verify with the completeness test in 4.2.

## 4. Unit tests

- [x] 4.1 Extend `packages/plugin-sdk/src/vocabulary.test.ts`: `WEAVE_PLUGIN_CLASS.rowPanel` is `v2-table-panel`, and the new value still matches `^[a-z0-9-]+$` and carries no visual value. Run `pnpm --filter @weave-ai/plugin-sdk exec vitest run src/vocabulary.test.ts`.
- [x] 4.2 Extend `packages/core/src/artifacts/v2-theme.test.ts`: the generated stylesheet contains a `.v2-table-panel` rule, the `[data-cell='secondary']` rule carries `flex: 0 1 auto`/`min-width: 0`/`text-overflow: ellipsis`/`white-space: nowrap`, the `[data-cell='primary']` rule carries `min-width: var(--space-9)`, the `actions`-cell rule carries `flex-wrap: nowrap` and a `--space-3` gap, and the table divider rule is the generalized `.v2-table > * + *`. Keep the existing completeness tests green. Run `pnpm vitest run packages/core/src/artifacts/v2-theme.test.ts`.

## 5. Docs and the example fixture

- [x] 5.1 Update `docs/PLUGINS.md`'s vocabulary section: describe the shrinking/truncating metadata cell (and that `primary` keeps a minimum), the `rowPanel` role and how to lay out its fields with `.v2-form-row`, and the `actions` cell as a right-aligned group of small buttons. Verify the names in the doc match the SDK exports and `v2.css` classes.
- [x] 5.2 Extend `examples/plugins/notes/index.js` with a fixture row set: one row with a long `secondary` value, one row with its panel open holding `.v2-form-row` fields, and one row with a two-button `actions` group. Verify it renders without console errors and with no inline CSS of its own when served by the scratch daemon (6.1).

## 6. Verification

- [x] 6.1 `pnpm lint && pnpm typecheck && pnpm test` green, with **both** suite blocks pasted verbatim in the PR/comment.
- [x] 6.2 Render check on a source-built daemon: `pnpm build`, start `scripts/scratch-daemon.sh start` with the fixture plugin, and drive headless Chromium over CDP (throwaway script outside `work/`) at 1440×900 and 390×844. For every row assert: each action button's box is inside the viewport; the table and the page do not scroll horizontally (`scrollWidth <= clientWidth`); and at 390 the long metadata is truncated, not wrapped. Record the assertion output.
- [x] 6.3 Captures-compared check: capture the fixture at 1440 dark, 1440 light and 390 dark before and after the change (the before uses the generated stylesheet from the base commit's `v2.css`), leave the images uncommitted outside `work/`, report their absolute paths, and describe the differences.
- [x] 6.4 `openspec validate vs-468-plugin-styling-vocabulary-a-shrinking-me --json --strict` clean.
- [x] 6.5 Push the branch and open the pull request with the ticket's work product recorded.
