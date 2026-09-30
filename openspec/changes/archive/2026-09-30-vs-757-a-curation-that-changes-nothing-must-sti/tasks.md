## 1. Stamp on ticket completion

- [x] 1.1 Add `markCurated(scope, projectId)` to `KnowledgeService` (`api.ts`, `knowledge/service.ts`): update every file row of the scope + project (`last_curated_at`, `curation_pending = 0`) and stamp the interval; reuse it for the interval stamp in `write()`. Verify a `knowledge.test.ts` case where files with NULL `last_curated_at` are reset with `updated_at` untouched.
- [x] 1.2 Call it from `propagateTerminal` in `tickets/service.ts` for a `done` ticket with `originKind: 'curation'`. Verify tests: a no-write `done` curation leaves no stale file on the next sweep; a `cancelled` one leaves staleness unchanged; a non-curation `done` ticket stamps nothing.
- [x] 1.3 Verify a simulated sweep over 2 days after a no-op curation files no second ticket, and one after 14 days files one; VS-732 scenarios still pass.

## 2. No-role failure logged once per interval

- [x] 2.1 In `requestCuration`, stamp the interval when a non-forced spawn fails with `wrong_status`, then rethrow. Verify a supervisor/knowledge test: repeated sweeps on a no-role project log one failure; a forced request throws every time.

## 3. Verify

- [ ] 3.1 Run lint, typecheck and both test suites; paste both blocks verbatim in the delivery.
