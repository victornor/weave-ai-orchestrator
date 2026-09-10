## 1. Parsing and labelling

- [x] 1.1 Add `packages/runtimes/cursor/src/models.ts` with `parseListModelsOutput(text: string):
  RuntimeModel[]`, matching the real formatter found by static analysis of the installed CLI
  (design.md "output format, verified by static analysis"): strip ANSI escapes; skip the
  `Available models` header and blank lines; stop entirely at the first line starting with `Tip:`;
  for each remaining line, the id is the text before the first `" - "` (or the whole line if none),
  with a trailing `" (...)"` parenthetical removed. Return `[]` (triggering the fallback, not a
  throw) if no line yields a non-empty id. Verify with unit tests built from the real formatter's
  shape: a mix of `id - displayName (current, default)`, `id - displayName`, and bare-`id` lines,
  including ANSI-colored input, producing the real ids from the ticket's captured rejection
  message.
- [x] 1.2 In the same module, add `deriveLabel(id: string): string` (family word + recognized
  variant/tier suffixes → e.g. `cursor-grok-4.6-high-fast` → contains "Grok 4.6"; an unrecognized
  id still returns a non-empty, non-raw humanized string). Verify with unit tests covering a known
  id and a synthetic unrecognized one.
- [x] 1.3 Add `parseUnknownModelRejection(text: string): { requested: string; available: string[] }
  | null` handling `Cannot use this model: <id>. Available models: <list>`, including a list
  ending in a truncated `, ...`. Verify with a unit test using the exact message from this
  ticket's description and a non-truncated variant.

## 2. Fallback catalogue

- [x] 2.1 Replace the static `MODELS` array in `adapter.ts` with a `FALLBACK_MODELS` array built
  from the real ids captured 2026-09-10 (`auto` plus the sixteen confirmed ids), each labelled via
  `deriveLabel`, `source: 'static'`. Verify `adapter.listModels()` with the fake CLI absent from
  PATH returns exactly this list and it contains no id from the old fictional list
  (`grok-4-6`, `opus-5`, `composer-5-6`, `fable-5-1`, `gpt-5`, `sonnet-4-thinking`).

## 3. Dynamic detection with cache

- [x] 3.1 Implement `listModels()`'s dynamic path: resolve `cursor-agent` via `which` (as
  `detectBinary` does), make exactly one spawn of `--list-models` with a bounded timeout (e.g. 20s
  — load-bearing against an interactive-login hang on a host with no stored credential, see
  design.md) and `maxBuffer`, parse via `parseListModelsOutput`, ensure `auto` is present (dedup if
  the CLI already included it), tag `source: 'detected'`. On missing binary, non-zero exit,
  timeout, or an empty parse, log a `warn` with the reason and a bounded (few-hundred-char, no
  credential) excerpt of the CLI's actual stdout/stderr, then return `FALLBACK_MODELS` — no retry,
  no second attempt. Verify with a fake-CLI test asserting the detected list and its `source`, a
  separate test with no fake CLI on PATH asserting the fallback list, and a test asserting the
  warn log fires with a non-empty excerpt on a simulated failure (non-zero exit / timeout).
- [x] 3.2 Add an in-process cache (module-level, TTL ~15 minutes) around the dynamic path so a
  second call within the window returns the previous result without spawning again; include a
  test-only reset/inject-clock hook so tests can assert both "cache hit does not respawn" and
  "cache expiry does respawn" deterministically. Verify with a fake CLI that records invocation
  count (e.g. increments a counter file) and tests asserting exactly one invocation across two
  in-window calls, and a second invocation once the cache is made to expire.

## 4. Rejection-message enrichment

- [x] 4.1 In `adapter.ts`'s `runTurn`, before falling through to `classifyError`, check
  `st.errorMessage` (and `outcome.stderr`) for the unknown-model rejection shape via
  `parseUnknownModelRejection`; when it matches, return a `TurnResult.error` whose `message`
  includes the parsed available ids. Verify with a fake-CLI test that emits the ticket's captured
  rejection text (including the truncated form) and asserts the returned error message contains
  the parsed ids.

## 5. Test harness

- [x] 5.1 Extend `packages/runtimes/cursor/test/fakeCli.ts` with a mode that responds to
  `--list-models` with a configurable payload (and, separately, a mode that exits non-zero with an
  unknown-model rejection message), following the existing `writeFakeCursorCli` /
  `writeSilentFakeCursorCli` pattern. Verify by using it from the tasks above.

## 6. Wrap-up

- [x] 6.1 Run `pnpm --filter @agent-conductor/cursor-runtime... test` (or the equivalent workspace
  filter) plus root `pnpm lint && pnpm typecheck && pnpm test`, all green, with no live
  `cursor-agent` invocation anywhere in the test suite.
- [x] 6.2 Write the PR description: state that the old catalogue's `gpt-5` / `sonnet-4-thinking`
  ids came from the CLI's own `--help` illustrative examples, not a real list; that
  `--list-models`'s output format was established by static analysis of the installed CLI bundle
  (never executed) and is stated as version-pinned, not guessed; state the 15-minute in-process
  cache and why a DB-backed per-workspace snapshot was not built, and the disclosed
  credential-singleflight risk accepted instead of threading `listModels()` through
  `ensureFreshCredential` (see design.md); state that fallback provenance is currently visible only
  in the daemon log and the API's existing `source` field, not in any picker UI — surfacing it
  there is explicitly out of scope for this ticket.
