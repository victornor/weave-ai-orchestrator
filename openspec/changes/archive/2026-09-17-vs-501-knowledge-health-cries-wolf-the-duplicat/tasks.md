## 1. Candidate and redirect classification

- [x] 1.1 Add the documented duplicate candidate floor, hub-pointer predicate, and explicit moved-to redirect-stub predicate in `packages/core/src/knowledge/files.ts`; verify unit tests cover the real `**Status:**` fragment, the `[[daemon-test-suite]] — ...` pointer form, the real `design-contract` heading/body, and ordinary entries that remain eligible.
- [x] 1.2 Make the existing similarity helper's containment shortcut selectable without changing its write-time default; verify the existing near-duplicate note and document-write tests still reject punctuation-only and whitespace-only restatements while a no-containment comparison does not score a short contained fragment as 0.95.

## 2. Knowledge service filtering

- [x] 2.1 Filter short entries and hub section pointers before applying the existing bounded duplicate-entry and pair caps, and use the no-containment comparison for sweep scoring; verify `knowledge.duplicates()` reports the real gateway retry near-duplicate, omits the six-style `**Status:**` false-positive pattern and repeated hub pointer, and preserves `{ pairs, scanned, capped }` plus read-only behavior.
- [x] 2.2 Exclude explicit redirect stubs from `health().orphans` while retaining them in the document catalogue and all other health measures; verify the exact `design-contract` redirect body is not reported as an orphan and an ordinary zero-backlink document still is.

## 3. Health wake regression coverage

- [x] 3.1 Add supervisor coverage proving that a sweep containing only filtered duplicate/pointer/redirect cases contributes no issue keys and does not wake the conductor, while an actionable pair still wakes once and persists silently; verify the existing first-sweep, threshold, cooldown, and improving-health tests remain green.
- [x] 3.2 Run the focused knowledge and supervisor test files and the repository validation suite, including `openspec validate vs-501-knowledge-health-cries-wolf-the-duplicat --strict`; record the exact results before delivery.
  - Focused Vitest: 3 files passed, 235 tests passed.
  - `pnpm typecheck`: passed.
  - `pnpm lint`: passed (`boundaries ok`, `console ok`, `test fixtures ok`).
  - OpenSpec strict validation: 1 change passed, 0 failed.
  - `pnpm test` core/server: `Test Files  243 passed | 1 skipped (244)`; `Tests  3802 passed | 1 skipped (3803)`.
  - `pnpm test` UI: `Test Files  138 passed (138)`; `Tests  1739 passed (1739)`.
