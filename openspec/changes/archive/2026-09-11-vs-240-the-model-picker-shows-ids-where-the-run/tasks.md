## 1. Opencode adapter reads the name it already parses

- [x] 1.1 In `packages/runtimes/opencode/src/adapter.ts`'s `parseModels`, set `model.label` from
      the parsed JSON object's `name` field when it is a non-empty string, leaving `label: id` as
      the fallback for a line with no JSON block. Verify with a unit test asserting the recorded
      `deepseek-flash` fixture entry (`test/fixtures/models-verbose.txt`) returns
      `label: 'DeepSeek V4.1 Flash'`, and that the non-verbose id-only fixture case still returns
      `label === id`.

## 2. Cursor adapter uses the CLI's own reported display name

- [x] 2.1 In `packages/runtimes/cursor/src/models.ts`, change `toModel` to accept an optional
      label override, and change `parseListModelsOutput` to extract the `<displayName>` half of
      an `<id> - <displayName>` line (after stripping any trailing `" (...)"` parenthetical) and
      pass it as that override; a bare id line (no `" - "`) keeps calling `toModel(id, 'detected')`
      with no override, unchanged. Verify with a unit test asserting
      `parseListModelsOutput('gpt-5.2 - GPT-5.2')` returns `label: 'GPT-5.2'` (not the
      humanizer's "GPT 5.2"), and that a bare-id line still returns the humanizer's derived label.
- [x] 2.2 Verify the existing `parseListModelsOutput`/`listModels` tests in
      `packages/runtimes/cursor/test/models.test.ts` still pass unchanged (they assert only on
      `id`/`source`, never `label`), confirming no regression to id parsing.

## 3. Shared picker formatter shows both name and id

- [x] 3.1 Add `modelOptionLabel(model: RuntimeModel): string` to `packages/ui/src/lib/runtime.ts`,
      returning `` `${model.label} (${model.id})` `` when `label !== id`, else `model.id`. Cover
      both branches with a unit test.
- [x] 3.2 Use `modelOptionLabel` in the `<option>` text (not `key`/`value`, which stay `m.id`) at
      the four call sites: `packages/ui/src/routes/Onboarding.tsx` (~line 354) and the three in
      `packages/ui/src/routes/Settings.tsx` (~lines 915-936, 1047-1067, 1174-1196). Verify by
      running the existing UI tests covering these selects
      (`packages/ui/src/test/onboarding.test.tsx`, `packages/ui/src/test/settingsScopes.test.tsx`,
      any others touching a model select) and confirming they still pass — update an assertion
      only if it asserted the old label-only text verbatim.

## 4. Verify the whole change

- [x] 4.1 Run `pnpm lint && pnpm typecheck` and confirm both are clean.
- [x] 4.2 Run `pnpm test` (root — chains the core/server vitest run then the ui suite) and paste
      both suite blocks verbatim with their real totals in the ticket report.
