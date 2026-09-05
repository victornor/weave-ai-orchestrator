## Context

See `proposal.md` — Why. The constraints that shape the approach:

- `decisions.kind` was given a literal seven-value CHECK in `packages/db/src/migrations/0001_init.sql:93`.
  SQLite has no `ALTER TABLE … ALTER COLUMN` and no way to drop or replace a CHECK, so widening it
  means rebuilding the table.
- `Db.migrate()` (`packages/db/src/db.ts:21`) runs each `.sql` file, whole, inside its own
  `BEGIN`/`COMMIT`, and rolls the file back on any error. A migration is therefore already atomic and
  must not need statements that are illegal inside a transaction.
- The connection is opened with `PRAGMA foreign_keys = ON` (`db.ts:19`), and `0001_init.sql` sets it
  again. `PRAGMA foreign_keys` is a no-op inside a transaction, so the usual "turn foreign keys off,
  rebuild, turn them on" recipe is not available to a migration file here.
- `decisions` has two outgoing foreign keys (`workspace_id → workspaces`, `ticket_id → tickets`) and
  two indexes (`decisions_open_corr`, `decisions_ws_status`). Nothing in the schema references
  `decisions`, so it is a leaf.
- `parkForHuman` (`packages/core/src/runs/engine.ts:434`) wraps its whole body — pause the agent,
  raise the decision, block the ticket, book the quota retry — in one `try`, whose `catch` logs at
  `warn`. The agent is paused first, so today's CHECK failure leaves a paused worker, an unblocked
  ticket, no card, and a `warn` line.

## Goals / Non-Goals

**Goals:**

- The rebuild is a normal migration file: one transaction, no pragma juggling, no separate tooling.
- The widened CHECK is verified against `DECISION_KINDS` by a test, not by review.
- A future failure of the parking path is diagnosable from the log alone and does not cascade into
  skipping the ticket transition.

**Non-Goals:**

- Deriving the SQL CHECK from `DECISION_KINDS` at migration time. Migrations are static `.sql` files
  read off disk; generating SQL from TypeScript would change the migration mechanism for one column.
  The drift is caught by a test instead (see Decisions).
- Any change to `DECISION_KINDS`, the decisions service, the API, the CLI or the web app.
- Any change to the retry ladder, its timings, the families that are retried, or the conditions under
  which a worker is parked.
- Backfilling or repairing workers parked before this change. None produced a decision row, and the
  system has no record of them beyond the `warn` lines; recovering them is the human's `Relaunch`.

## Decisions

### Rebuild `decisions` in place, inside the migration's own transaction

The 12-step SQLite rebuild reduces here to five statements, because `decisions` is a leaf table:

1. `CREATE TABLE decisions_new (…)` — the `0001_init.sql` definition verbatim except for the widened
   `kind` CHECK, including both foreign keys.
2. `INSERT INTO decisions_new SELECT * FROM decisions;`
3. `DROP TABLE decisions;`
4. `ALTER TABLE decisions_new RENAME TO decisions;`
5. Recreate `decisions_open_corr` and `decisions_ws_status` (dropped with the old table).

This is safe with `foreign_keys = ON`, which is what makes it usable from a migration file:
step 2 re-checks rows that already satisfied the same constraints; step 3 drops a table nothing
references; step 4 has no `REFERENCES decisions` clauses anywhere to rewrite. Verified on a database
built by replaying every migration and seeded with an open correlated decision, an answered one and a
ticketless one: all three survive with their status, answer, correlation key and target intact, both
indexes and both foreign keys come back, `PRAGMA foreign_key_check` returns no rows,
`PRAGMA integrity_check` returns `ok`, a `retry_approval` insert then succeeds, and an undefined kind
is still refused.

*Alternative considered — drop the CHECK entirely* and rely on the shared enum and the service layer.
Rejected: the CHECK is the only thing that stops a typo'd kind reaching storage, and the ticket asks
for a constraint that accepts every defined kind, not for no constraint.

*Alternative considered — `PRAGMA writable_schema`* to edit the stored DDL text in place. Rejected:
undocumented-by-contract, easy to corrupt, and no faster here.

### Catch the drift with a test, not with generated SQL

The test reads the persisted CHECK from `sqlite_master` for the live `decisions` table, extracts the
literals of the `kind IN (…)` clause, and asserts set equality with `DECISION_KINDS` imported from
`@agent-conductor/shared` (already a dependency of `@agent-conductor/db`). Adding a kind to the enum
without a migration then fails a test in the package that owns the schema, which is where the
omission happened.

Set equality, not containment, in both directions: a kind removed from the enum but left in the CHECK
is the same class of drift.

### Make `parkForHuman` step-independent and log failures at `error`

Each of the four steps gets its own `try`/`catch` logging at `error` with the run id, the agent id,
the step and the reason. The order is unchanged and no step is added or removed, so the retry policy
is untouched; only the blast radius of one step failing changes. This is what turns "a paused worker
and nothing else" into "a blocked ticket, a booked retry where applicable, and an error in the log"
if storage ever refuses a card again.

The existing `warn` on the outer path becomes `error` for the same reason: parking is the last resort
before a human has to notice by hand, so its failure is not a warning.

## Risks / Trade-offs

- **An existing `decisions` row violates a foreign key, so step 2 fails and the whole migration rolls
  back, leaving the daemon unable to start.** → The two foreign keys were enforced on every insert
  since `0001_init.sql`, and neither `workspaces` nor `tickets` rows are hard-deleted anywhere in the
  codebase, so no such row can exist. The migration is atomic: a failure rolls back to the current
  schema and the daemon reports the migration error rather than starting on a half-rebuilt table. The
  release procedure already backs the database up before migrating.
- **A large `decisions` table makes the copy slow, lengthening daemon start.** → It is one workspace's
  decision history, tens to thousands of rows; the copy is a single-table scan.
- **The rebuilt DDL drifts from `0001_init.sql`, so a fresh database and an upgraded one differ.** →
  The new file is the old definition with one clause changed, and the drift test asserts the CHECK on
  a database built by replaying all migrations, which is the same path both cases take.
- **The step-independent parking makes a partly-parked worker look parked.** → It already could; the
  difference is that the failure is now at `error` with the step named, instead of one `warn` for the
  whole block.

## Migration Plan

- One new file, `packages/db/src/migrations/0010_decision_kinds.sql`. Nothing else in the deploy
  changes: `Db.migrate()` applies it on the daemon's next start, records it in `meta`, and skips it
  on every start after that.
- A normal `conductor daemon upgrade` is sufficient — no manual step, no data fix-up, no downtime
  beyond the restart the upgrade already takes.
- **Rollback:** rolling the daemon back to a release without this migration leaves the widened table
  in place. The old code never writes `retry_approval`, and a wider CHECK accepts everything the
  narrower one did, so the old release runs unchanged against it. The `meta` row for the migration is
  harmless to the old code. No down-migration is needed and none is written, consistent with every
  migration in this repo.
