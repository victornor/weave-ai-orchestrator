## 1. Release history read

- [x] 1.1 Add a function to `packages/release/src/index.ts` that returns the commit subjects between two commit shas inside a release directory's own clone, empty when either sha is missing or the directory has no readable `.git`. Verify with a unit test against a real throwaway git repo (temp dir, a few commits) — not a mocked git binary, since the whole point is reading real subjects.

## 2. Undelivered-commit detection

- [x] 2.1 In `packages/server/src/upgrade.ts`, read the workspace's own `ticket_prefix` and use it plus the new release function to compute the set of ticket identifiers (`<PREFIX>-<n>`) named at the start of a commit subject within the release window, wired into `AnnouncementFacts` as a new fact function keyed off `Upgrade.toRelease` (not `deps.releaseRoot`). Verify by unit test: a fixture release directory whose commits include one identifier the landed-tickets fake does not have, and confirm the fact returns only that identifier.
- [x] 2.2 In `packages/server/src/upgrade-announce.ts`, compute the undelivered identifier set (commit identifiers minus landed identifiers) inside `buildAnnouncement`, and add it to `UpgradeAnnouncement` (`packages/shared/src/types.ts`) as a bounded, named field alongside `tickets`. Verify: the normal case (every identifier accounted for) produces no field content and an unchanged `tickets` value.

## 3. The message and the wake

- [x] 3.1 Extend `announcementText` so a completed upgrade with a non-empty undelivered set appends a clause naming the count (and identifiers, once bounded) — leaving the message byte-for-byte the same as today when the set is empty. Verify with a unit test asserting both the changed and unchanged cases.
- [x] 3.2 Reproduce the real VS-227 shape as a test in `packages/server/test/upgrade-announce.test.ts`: a release window whose commit history names an identifier no landed-tickets fixture accounts for (mirroring a `done` ticket whose delivery is `{prState: 'merged'}` with no `mergeCommit`), and assert both the posted message and the wake payload name the gap.
- [x] 3.3 Update the line about the wake in `templates/conductor.AGENTS.md.tmpl` to mention relaying the discrepancy when the wake carries one.

## 4. Follow-up

- [x] 4.1 File a follow-up ticket (VS-250) (once this ticket is approved) for the ticket-side inconsistency the source ticket raised — a `done` ticket whose delivery has `prState: 'merged'` and no `mergeCommit` — per design.md's decision to keep it out of this change's scope.

## 5. Verification

- [x] 5.1 `pnpm lint && pnpm typecheck && pnpm test` green; paste both `pnpm test` suite blocks verbatim with their real totals.
