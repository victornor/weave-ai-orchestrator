## 1. Monotonic `newId`

- [x] 1.1 In `packages/db/src/db.ts`, replace `ulid()` with a module-level `monotonicFactory()` instance (`import { monotonicFactory } from 'ulid'`) and keep the `newId(): string` export. Verify: `packages/db` typechecks (`pnpm --filter @agent-conductor/db exec tsc -b --pretty false` or the repo `pnpm typecheck`).

- [x] 1.2 Add `packages/db/src/id.test.ts` that generates at least 64 ids in a tight loop, asserts each is strictly greater than the previous, and asserts the first and last share a millisecond (`decodeTime` from `ulid`, retry the loop once in-process if a slow machine spans two milliseconds). Verify: `pnpm exec vitest run packages/db/src/id.test.ts`.

## 2. Call-site proofs

- [x] 2.1 Keep the existing `jobs.test.ts` assertion (`list({ entityId: 'p1' })` equals `[second, first]`). If that test cannot force a same-millisecond `started_at`, add one case that seeds two jobs with the same `started_at` and factory-issued ids and asserts later-created first. Verify: `pnpm exec vitest run packages/core/src/jobs/jobs.test.ts`.

- [x] 2.2 In `packages/core/src/incidents/incidents.test.ts`, file (or seed with factory ids) two incidents that share a `createdAt` millisecond; assert `list` returns `[later, earlier]` twice, then `list({ since: thatCreatedAt })` returns neither. Verify: `pnpm exec vitest run packages/core/src/incidents/incidents.test.ts`.

- [x] 2.3 Tighten `changelog.test.ts` "breaks a tie inside one timestamp…" so the concatenated pages are reverse creation order of the four factory-issued ids, not only set equality. Verify: `pnpm exec vitest run packages/core/src/changelog/changelog.test.ts`.

- [x] 2.4 Re-grep `packages/**/*.ts` for `, id DESC`, `, id ASC`, and `.id DESC` / `.id ASC`. Confirm each production hit is one of the six queries plus two indexes in design.md D2 (or record a newly found hit and its disposition on the ticket). No query text change unless a hit is wrong under monotonic ids. Verify: the grep output matches the D2 table.

## 3. Checks

- [x] 3.1 Run `jobs.test.ts` under full-suite load at least five sequential times (`pnpm test` from the repo root, or `pnpm exec vitest run packages/core/src/jobs/jobs.test.ts` as part of each full `pnpm test`). Record the run count and that the "lists a project's jobs newest first" case passed every time. Verify: five green runs, count stated on the ticket.

- [x] 3.2 `pnpm lint && pnpm typecheck && pnpm test`. Paste **both** suite blocks verbatim in the ticket comment (core/server and UI separately; do not add the totals). Verify: `openspec validate vs-229-ids-are-not-monotonic-so-every-id-desc-t --json --strict` clean.
