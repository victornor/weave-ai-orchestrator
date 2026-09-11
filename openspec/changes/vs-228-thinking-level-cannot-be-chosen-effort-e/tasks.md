## 1. RuntimeModel shape

- [x] 1.1 Add optional `efforts?: string[]` to `RuntimeModel` in `packages/runtime-sdk/src/index.ts` and the UI copy in `packages/ui/src/api/types.ts`. Verify `pnpm typecheck` still passes after the field exists and no adapter yet fills it (omitted is valid).
- [x] 1.2 Document the field on `GET /api/runtimes/:id/models` in `docs/API.md`: non-empty list, empty list, omitted. Verify the sentence names all three states.

## 2. OpenCode — detect variants

- [x] 2.1 Capture a real `opencode models --verbose` dump into `packages/runtimes/opencode/test/fixtures/` (existing `listModels` test already spawns this CLI; do not invent the JSON). Verify the fixture contains at least one `provider/model` line followed by a JSON object that has a `variants` key.
- [x] 2.2 Extend `parseModels` to read `--verbose` output: id line, then JSON, `efforts` = variant keys with `disabled` skipped; empty `variants` → `[]`. Verify unit tests against that fixture cover a model with keys, a model with `{}`, and a disabled variant omitted.
- [x] 2.3 Pass `--verbose` from `listModels`. On parse failure or empty result, keep the static fallback with `efforts` omitted. Verify the existing listModels test still returns `provider/model` ids and that fallback rows do not grow a guessed efforts array.

## 3. Claude — static per-model efforts from the catalog

- [x] 3.1 Extract `supportedEffortLevels` / capability flags (`effort`, `xhigh_effort`, `max_effort`) for each id in `MODELS` from the installed Claude binary via `strings` (no spawn), same method as VS-129. Verify the adapter comment names the CLI version and that no model copies the five-value `configSchema` enum wholesale.
- [x] 3.2 Set `efforts` on each `MODELS` row from that extraction (`source` stays `static`). Verify a test that at least one listed model has a non-empty list and that `xhigh`/`max` are absent on a model the catalog does not flag for them.

## 4. Codex — bundled catalog dump

- [x] 4.1 Confirm the argv for a bundled dump (`codex debug models --bundled` or the spelling `strings` of `--help` shows) without spawning against credentials. Write a parser for the JSON catalog that reads `supportedReasoningEfforts` per model. Verify the parser against a fixture whose bytes come from that dump shape (fake CLI in tests), not a guessed field name.
- [x] 4.2 `listModels` runs that command when the binary is present and tags rows `source: 'detected'` with those efforts; on failure, keep today's static ids with `efforts` omitted. Verify a fake-binary test returns detected efforts and a missing-binary test omits them rather than applying `minimal|low|medium|high` to every row.

## 5. Gemini and Cursor — known none

- [x] 5.1 Set `efforts: []` on every Gemini `MODELS` row. Verify `listModels` returns `[]` for each, and that `buildArgs` still does not pass effort (existing args test / adapter source unchanged).
- [x] 5.2 Set `efforts: []` on every Cursor listed model (detected and static fallback). Verify `listModels` (fake `--list-models` and fallback) returns `[]`, and that `configSchema` still has no `effort` property.

## 6. Effort forwarding unchanged

- [x] 6.1 Re-run `packages/runtimes/claude/test/args.test.ts`, `packages/runtimes/codex/test/args.test.ts`, and `packages/runtimes/opencode/test/args.test.ts`. Verify the existing assertions that `--effort high`, `-c model_reasoning_effort="high"`, and `--variant high` still pass unchanged.

## 7. Web picker

- [x] 7.1 Add the thinking-level control to `ModelSettingFields`: picker when `efforts` is non-empty (plus unset), hidden when `[]`, free text when omitted or the model is custom; honor `disabled`; changing model clears a stale effort. Verify `packages/ui/src/test/models.test.tsx` covers picker options, hidden, free text, optional unset, and stale-effort clear on the workspace Models section.
- [x] 7.2 Include `effort` on `WorkerOptionsEditor`'s add `candidate` and the same control keyed off the chosen option model. Verify an add-option test submits `effort` when picked and omits it when hidden or unset.
- [x] 7.3 Confirm daemon overlay rows reuse `ModelSettingFields` so inheriting stays inert (VS-207 `disabled`). Verify a models test that changing thinking level while inheriting writes nothing.

## 8. Gate

- [x] 8.1 Run `pnpm lint`, `pnpm typecheck`, and `pnpm test`. Verify both suite blocks are pasted verbatim into the ticket (core and UI separately, no summed total, no "both suites passed" over one block).
