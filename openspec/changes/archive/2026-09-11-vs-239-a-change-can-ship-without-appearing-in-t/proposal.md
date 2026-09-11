## Why

VS-227 shipped in the release announced 2026-09-11 but was missing from the announcement's list of landed tickets: its merge never went through `mergeDone` (the incident behind VS-232), so it left no `ticket.delivery_landed` activity row, and `landedTickets` in `packages/server/src/upgrade.ts` only ever reads that row. The design choice — the delivery record, not a second opinion re-derived from git — is sound and stays. The defect is that the gap is silent: nothing in the notice or the wake says the accounting might be incomplete, so an operator reading "eleven tickets landed" has no way to know a twelfth shipped without being told.

VS-232 already fixed the verification bug that produced this specific gap. This change is about the announcement being honest about its own bookkeeping the next time some other path produces the same shape, not about chasing every way a merge could bypass `mergeDone`.

## What Changes

- **The announcement counts ticket-referencing commits in the release window independently of the delivery records**, using the release directories' own git history (both SHAs are already on the `upgrades` row) and the workspace's own ticket prefix — never used to build the landed list itself, only to size the gap.
- **When that count exceeds the number of identifiers the delivery records already list, the announcement says so**: both the chat line and the conductor's wake name how many commits have no matching delivery record, and the wake lists their identifiers when they can be read from the commit subjects (`<PREFIX>-<n>: ...`).
- **The normal case is unchanged.** When every ticket-referencing commit matches a landed identifier, nothing new is added to the message or the payload.
- **The conductor's job description gains a line** telling it to relay the discrepancy when the wake carries one.

## Capabilities

### Modified Capabilities

- `daemon-upgrade/upgrade-announcement`: the announcement additionally reports ticket-referencing commits in the release window that have no matching delivery record, instead of silently omitting them from the tickets it already lists.

## Impact

- `packages/release/src/index.ts` — a function to read commit subjects between two commits inside a release directory's own clone.
- `packages/shared/src/types.ts` — `UpgradeAnnouncement` gains a field for the undelivered commits.
- `packages/server/src/upgrade-announce.ts` — compute the discrepancy from facts; extend the chat line.
- `packages/server/src/upgrade.ts` — read the workspace's ticket prefix and the release's commit subjects, wire them into `AnnouncementFacts`.
- `templates/conductor.AGENTS.md.tmpl` — the line about the wake.
- Tests: `packages/server/test/upgrade-announce.test.ts`, `packages/release/src/index.test.ts` (or equivalent).

## Out of scope

- `mergeDone`, the merge path, or how a delivery record is produced (VS-232 already fixed the bug that caused this instance).
- The changelog's data model (`recordUpgradeInChangelogs`, the per-workspace `daemon.upgraded` changelog row) — unchanged.
- Whether a ticket that reaches `done` with `prState: merged` and no `mergeCommit` should be visible as an inconsistency elsewhere (e.g. a ticket list or a health check). Decision: file a separate follow-up ticket for that rather than widening this one — it is a ticket-data-model concern, not an announcement concern, and the announcement no longer depends on it being fixed to stay honest.
