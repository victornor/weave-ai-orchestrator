## 1. Detection

- [x] 1.1 `GhForge.hasCiWorkflows` counts only active workflows under `.github/workflows/` (`per_page=100`), with gh tests for file, dynamic, disabled and failing cases
- [x] 1.2 Pin that `statusCheckRollup: []` reads `ciState: 'none'` through `GhForge.prState`

## 2. Landing sequence

- [x] 2.1 `repoHasCiWorkflows` caches only definite answers and retries a failed query (injectable delay)
- [x] 2.2 Key the unclassified no-CI wait by pull request and head; do not reset it on a head mismatch or a pending read
- [x] 2.3 `onNoCiRepository` callback fires once when landing on a repository with no workflows; wire it to a ticket comment in `service.ts`
- [x] 2.4 Tests: zero workflows plus empty rollup lands at once with the comment; failed query retries then lands after a wait measured from the first attempt across several calls; combined pending/zero treated as none; workflows + all-skipped does not land; workflows + success on the head lands

## 3. Docs and verification

- [x] 3.1 Document no-workflow landing and `requireCi: false` in `README.md` and `docs/PLAN.md`
- [x] 3.2 lint, typecheck and both test suites green, counts pasted in the PR
