## Context

See proposal.md for motivation. `newId()` in `packages/db/src/db.ts` is `ulid()` from `ulid@3.0.2` (range `^3.0.1`). A ULID is a 48-bit millisecond timestamp plus 80 random bits; two calls in the same millisecond sort randomly. The daemon is one Node process serving several workspaces; `newId` is already a module-level function, not per-`Db`.

The jobs flake is `jobs.test.ts` asserting `list({ entityId: 'p1' })` equals `[second, first]` after two `start()` calls. `list` is `ORDER BY started_at DESC, id DESC`. Under full-suite load those two `nowIso()` values often share a millisecond, so `id DESC` is a coin flip. Isolation is slower and usually does not tie.

## Goals / Non-Goals

**Goals:**

- Make `newId()` strictly increasing within a millisecond, process-wide.
- Prove the jobs list assertion is then deterministic; do not rewrite it unless it still flakes.
- Inventory every production `id DESC` / `id ASC` tie-break; confirm each is correct under monotonic ids or name the leftover.
- Prove the incident `since` bookmark for a same-millisecond group that fits in one page.

**Non-Goals:**

- No migration, no rewrite of stored ids, no id-format change.
- No keyset/`offset` rewrite of `IncidentListQuery.since` (VS-222's timestamp cursor stays).
- No change to queries that already tie-break on `rowid` (SQLite's insert order).
- No per-workspace factory.

## Decisions

### D1 — `monotonicFactory()`, one process-wide instance

`ulid@3.0.2` exports `monotonicFactory()`. Confirmed from the package docs and source: within a millisecond it increments the Crockford-base32 random component; if `seedTime <= lastTime` (clock went backwards, or the same ms) it reuses `lastTime` and increments rather than encoding the earlier wall clock. Overflow of the 80-bit random component throws; that is not reachable in this process.

```ts
import { monotonicFactory } from 'ulid';
const nextId = monotonicFactory();
export const newId = (): string => nextId();
```

One module-level factory is right: `newId` is already process-global; workspaces share the process and uniqueness is per-table anyway. Per-workspace factories would still be unique in practice but would re-randomise independently in the same millisecond for no gain. Vitest workers each load the module once, so tests stay isolated.

Alternative considered: leave `ulid()` and add `rowid` to every affected `ORDER BY`. Rejected: the changelog keyset and VS-173's "ULID order is creation order" already assume lexicographic creation order; fixing the factory makes every existing `id` tie-break correct without touching queries. `rowid` is already used where someone chose insert-order explicitly (`threads`, `runs/engine`, merge-queue activity).

Clock going backwards: encoded ULID time can sit ahead of wall clock until it catches up. Row timestamps still come from `nowIso()`, so a backwards jump can still disorder `ORDER BY created_at`. That is a pre-existing clock problem, not introduced here; the daemon's clock is NTP. Not in scope to freeze `nowIso` to the factory.

### D2 — Inventory: every `id` timestamp tie-break (ticket said nine)

Production sites that order by a timestamp **and** `id` (the ones the ticket meant; grep for `id DESC`/`id ASC` as a secondary key):

| # | Site | Order | Disposition |
|---|---|---|---|
| 1 | `packages/core/src/jobs/index.ts:96` `list` | `started_at DESC, id DESC` | Correct once ids are monotonic. The flake. |
| 2 | `packages/core/src/runs/index.ts:89` `traces` | `created_at DESC, id DESC` | Correct. Callers reverse to oldest-first. |
| 3 | `packages/core/src/incidents/index.ts:135` `list` | `created_at DESC, id DESC` | Correct for order. Paging: D3. |
| 4 | `packages/core/src/changelog/index.ts:128` list + keyset | `created_at DESC, id DESC` and `(created_at, id) < cursor` | Correct. Already tested as set-equality at one timestamp (`changelog.test.ts`); tighten to reverse-creation order. |
| 5 | `packages/server/src/upgrade.ts:104` latest | `requested_at DESC, id DESC LIMIT 1` | Correct: latest request in a tied millisecond is the later-created one. |
| 6 | `packages/server/src/upgrade.ts:433` announce | `requested_at, id` (ASC) | Correct: announce oldest request first, then earlier-created id. |

Indexes (same key, not extra queries): `activity_changelog` and `activity_changelog_project` (`created_at DESC, id DESC`). They serve site 4.

Nearby and **out of this fix** (already a total order, or no `id` key):

- `jobs.running()`: `ORDER BY started_at DESC LIMIT 1` — no id tie-break. Two running jobs for one entity in the same millisecond would still be a coin flip. One running job per entity is the product; not in scope.
- `rowid DESC` sites (`threads/service.ts:248`, `runs/engine.ts` ×3, `tickets/merge-queue.ts:84`): SQLite insert order, already monotonic. Leave them.
- Ticket list default `number DESC`: filing order, unrelated.

The ticket's "nine" over-counted; these six queries plus two indexes are the complete `id` tie-break set. Apply records the table in the PR so a later grep does not re-open it.

### D3 — Incident paging: same-ms group that fits, not a keyset rewrite

VS-222 D2: exclusive `created_at > since` after bookmarking the newest `createdAt`, on the assumption that every row sharing that timestamp was already on the page (`id DESC` plus page-until-short). That assumption is false today because `id DESC` is random (a same-ms pair can list in either order, but more importantly the *order* is not creation). After D1, a same-ms pair is a stable contiguous block, later-created first. A page whose `limit` covers the group, bookmarked at that `createdAt`, returns neither again.

A `limit` that splits the group still cannot reach the remainder through `since` (no offset, no `(created_at, id)` cursor). VS-222 called that theoretical given incident volume (default limit 100, max 200). Out of scope to replace `since` with a keyset. The new spec states that leftover explicitly.

Test: file two incidents in a tight loop (or seed the same `createdAt` with factory-issued ids), `list({ limit: 10 })` equals `[later, earlier]`, then `list({ since: thatCreatedAt })` is empty.

### D4 — `jobs.test.ts` stays; prove it under load

Once ids are monotonic, `[second, first]` is the `id DESC` order even when `started_at` ties. Do not change the assertion. Add a same-ms case (freeze or seed identical `started_at`) only if the existing test still cannot force a tie. Re-run the file under the full suite several times (at least 5 sequential `pnpm test` runs, and say the count).

The identity test lives next to `newId` in `packages/db` (same vitest as `migrations.test.ts`): generate ≥64 ids in a tight loop, assert strictly increasing, and that `decodeTime` of the first and last match (same millisecond) so the test actually covers the random-component increment, not just wall-clock progress. If a slow machine spans two milliseconds, retry once in-process rather than loosening the assertion.

## Risks / Trade-offs

- [Factory state is process-global] → Intended. Tests that stub `Date.now` and call `newId` a lot will increment rather than collide; that is the desired behaviour.
- [Clock jump back keeps ULID time high until catch-up] → Documented package behaviour; row timestamps still use `nowIso()`. No extra handling.
- [Existing same-ms ids stay randomly ordered relative to each other] → Accepted: no migration. Only newly issued ids gain the guarantee. Mixed old/new in one millisecond of upgrade is not a live case (those rows already have past timestamps).
- [Incident `since` still cannot page through a same-ms group larger than `limit`] → Named leftover from VS-222; not this ticket.

## Migration Plan

None. Deploy is the usual merge. Rollback restores non-monotonic `newId`; rows issued in between keep their (still valid) ULIDs.

## Open Questions

None.
