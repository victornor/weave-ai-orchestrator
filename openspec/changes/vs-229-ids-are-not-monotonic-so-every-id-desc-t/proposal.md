## Why

`newId()` calls the non-monotonic `ulid()` factory. Two ids generated in the same millisecond have random low bits, so every `ORDER BY <timestamp> DESC, id DESC` tie-break is a coin flip. That is the `jobs.test.ts` "lists a project's jobs newest first" flake (failing under full-suite load since 2026-09-10), and it is the same hole under the changelog keyset cursor and the incident list's `createdAt` bookmark.

## What Changes

- Switch `newId()` (`packages/db/src/db.ts`) to a process-wide `monotonicFactory()` from the pinned `ulid@3.0.2`. Ids generated in the same millisecond increment the random component and sort in creation order. Existing rows are untouched — no migration, no format change.
- Assert that guarantee with a tight-loop test (many ids in one millisecond, strictly increasing).
- Leave the SQL tie-breaks in place; they become correct once ids are monotonic. Assess every production `id DESC` / `id ASC` site (the ticket said nine; the inventory is in design.md) and name any that still need more than the id.
- Confirm the incident list's VS-222 paging contract for a same-millisecond group: with a stable `id DESC` order, a page that contains the whole group, bookmarked by the newest `createdAt`, neither drops nor repeats a row.
- `jobs.test.ts` should then pass without rewriting the assertion; say so after proving it under repeated full-suite load.

Not a broader id-format change. Not a keyset rewrite of `since`. Not a rewrite of queries that already use `rowid` as the tie-break.

## Capabilities

### New Capabilities

- `identity/monotonic-ids`: every id `newId()` issues is a ULID that sorts in creation order, including two ids generated in the same millisecond, so timestamp-then-id order is a total order of creation.

### Modified Capabilities

- `workspace-setup/setup-jobs`: listing jobs "most recent first" is a total order of start time then creation, so two jobs started in the same millisecond list in creation order (newer id first).
- `incidents/conductor-read`: two incidents filed in the same millisecond form a stable newest-first block; a `since` bookmark of that `createdAt` after the caller has consumed the whole group returns neither of them again.
- `workspace-changelog/entry-recording`: changelog paging's `(created_at, id)` cursor is a total order, including two entries recorded in the same millisecond.

## Impact

- `packages/db/src/db.ts` (`newId`), plus a new unit test next to it.
- Callers of `newId()` and every `ORDER BY …, id DESC` / `id ASC` site: jobs list, run traces, incident list, changelog list (and its keyset), upgrade latest/announce. No query text change expected.
- `packages/core/src/jobs/jobs.test.ts` — expected to stay as written; prove under repeated full-suite load.
- Incident list tests for the same-millisecond bookmark. Changelog already keysets on `(created_at, id)`; add a same-ms page test if none exists.
- No schema, no migration, no API shape change, no new dependency (already on `ulid@^3.0.1`, lockfile `3.0.2`).
