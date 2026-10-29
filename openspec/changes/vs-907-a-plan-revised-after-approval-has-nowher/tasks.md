## 1. Daemon
- [ ] 1.1 Let `republishRevisedPlan` accept `approved` for `change` tickets; inside the write transaction re-check the status and, for `approved`, set it to `proposed` and record the activity with both revisions
- [ ] 1.2 Raise the fresh card with the "revised after approval (rev N → M)" context and add the status comment; update the doc comments in `service.ts` and `engine.ts`

## 2. Tests
- [ ] 2.1 In `plan-republish.test.ts`: revised plan on `approved` → revision 2, status `proposed`, open card on revision 2 mentioning both; approve → `approved` and worker woken
- [ ] 2.2 Unchanged and invalid plans on `approved` change nothing; a status moved mid-validation writes nothing
- [ ] 2.3 `transition` to `proposed`/`proposing` from `approved` is still refused with the allowed set

## 3. Skills
- [ ] 3.1 Document the post-approval revision path in `skills/weave-ai-worker/SKILL.md` and `skills/weave-ai-openspec/SKILL.md`

## 4. Verify
- [ ] 4.1 Run the changed test files, then the full core and UI suites once
