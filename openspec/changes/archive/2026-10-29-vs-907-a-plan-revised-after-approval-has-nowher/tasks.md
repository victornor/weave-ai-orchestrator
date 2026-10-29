## 1. Daemon
- [x] 1.1 Let `republishRevisedPlan` accept `approved` for `change` tickets; inside the write transaction re-check the status and, for `approved`, set it to `proposed` and record the activity with both revisions
- [x] 1.2 Compare plans with task checkbox state normalised on both sides (shared helper), for `proposed` and `approved`
- [x] 1.3 Raise the fresh card with the "revised after approval (rev N → M)" context and add the status comment; update the doc comments in `service.ts` and `engine.ts`

## 2. Tests
- [x] 2.1 In `plan-republish.test.ts`: revised plan on `approved` → revision 2, status `proposed`, open card on revision 2 mentioning both; approve → `approved` and worker woken
- [x] 2.2 Ticking every box on an `approved` ticket republishes nothing and leaves status, revision and cards unchanged; same on `proposed`; a reworded, added, removed or reordered task (ticked or not) does republish
- [x] 2.3 Unchanged and invalid plans on `approved` change nothing; a status moved mid-validation writes nothing
- [x] 2.4 `transition` to `proposed`/`proposing` from `approved` is still refused with the allowed set

## 3. Skills
- [x] 3.1 Document the post-approval revision path in `skills/weave-ai-worker/SKILL.md` and `skills/weave-ai-openspec/SKILL.md`

## 4. Verify
- [x] 4.1 Run the changed test files, then the full core and UI suites once
