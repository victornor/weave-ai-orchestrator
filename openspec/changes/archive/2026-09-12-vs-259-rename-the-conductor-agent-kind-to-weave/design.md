## Context

See `proposal.md` - Why/What Changes for motivation and the full surface list; VS-257's report
(`ac_ticket_document_get VS-257 report`) is the underlying inventory. Three facts drive every
decision below:

- `agents.kind`, `decisions.owner`, and `roles.created_by` are three **independent** CHECK/default
  constraints containing the literal `'conductor'` — not one constraint reused three times — and
  `agents`, `decisions`, and `roles` are each FK-referenced tables (`agent_sessions.agent_id`,
  `role_revisions.role_id`, `tickets.assignee_role_id`, `agent_handovers.agent_id`, …), so rebuilding
  any of them needs this repo's `-- ac:foreign_keys_off` convention (established by migration 0023;
  `Db.migrate()` disables FK enforcement before `BEGIN` for the whole file and restores it after).
- VS-258 already shipped `resolveWorkspaceStateDir()` (`@agent-conductor/release`) and
  `workspacePaths()` (`packages/core/src/context.ts`), which pick the per-workspace runtime-home
  directory name (`conductor/` vs `weaver/`) from whichever already exists on disk, falling back to
  the new name for a fresh workspace. That resolution logic is **out of scope here** — this change
  only needs to confirm it keeps working once `ensureConductor()`/`WorkersService` start writing the
  `weaver` kind value, and stop hard-coding the old literal alongside it.
- The raw string `'conductor'` meaning this agent kind is scattered, uncentralized, across ~280
  TypeScript call sites (confirmed by `rg "'conductor'" packages/ --type ts`, not the ~12 VS-257's
  report named as load-bearing) — mostly test fixtures and UI/TUI display code, not schema. The
  schema/constraint sites are the small, high-consequence minority; the rest is a mechanical sweep
  verified by the ticket's own acceptance criterion (`rg "'conductor'"` across `packages/` returns
  nothing meaning the agent kind).

## Goals / Non-Goals

**Goals:**
- One migration, one pass, rebuilding every constraint that names `'conductor'` as this agent kind's
  identity, updating every existing row in the same transaction.
- Every application code site that reads or writes one of those values follows, with no site left
  comparing against the old literal.
- An existing workspace's on-disk `conductor/` directory keeps being found after this ships — not
  moved, not copied, not required to be renamed by hand.
- Prose describing the renamed kind, in `docs/`, `skills/`, and `templates/`, reads `weaver`.

**Non-Goals:**
- Building or changing directory name resolution — VS-258 already did that; this change only stops
  writing the old kind value into it.
- Touching `openspec/specs/**`'s existing requirement text (e.g. `human-decisions/conductor-review`'s
  prose, which says "the conductor" throughout) — its *behavior* is unchanged, only the
  implementation's column and field names move. Rewriting spec prose that describes unrelated,
  already-shipped requirements is out of this change's stated prose-pass scope (`docs/`, `skills/`,
  `templates/` only) and would be pure churn against a capability this ticket does not modify.
- `workspace.yaml`/`daemon.yaml`'s `conductor:` config keys — VS-263, deliberately sequenced after
  this change lands in `packages/shared` to avoid a collision (captain's decision on VS-259's
  gate-finding ask).
- The `agent-conductor-` product-name prefix anywhere (package names, CLI binary, other skill
  directories, `agent-conductor-engineer`-style role-id convention) — VS-260.
- The `ac_` MCP tool prefix and `CONDUCTOR_TOOLS`'s member *names* (the `ac_*` strings themselves) —
  pending with captain. `CONDUCTOR_TOOLS` the **array identifier** does rename (see Decision 4); the
  62 tool-name strings inside it do not.

## Decisions

### Decision 1 — One migration file, three table rebuilds, combined with the column rename

`packages/db/src/migrations/0027_agent_kind_weaver.sql` rebuilds `agents`, `decisions`, and `roles`
in one file under a single `-- ac:foreign_keys_off` marker (FK enforcement is a database-connection
setting, not a per-statement one — one marker covers all three rebuilds in the same transaction).

For each table, following 0023's precedent exactly (`CREATE TABLE <t>_new`, transformed `INSERT`,
`DROP TABLE`, `RENAME TO`, then every index the original file declares):

- `agents`: CHECK becomes `kind IN ('weaver','worker')`; `agents_one_conductor` is recreated as
  `agents_one_weaver ON agents(workspace_id) WHERE kind = 'weaver'` (index name and predicate both
  move — an index still named `_one_conductor` after this ships would be exactly the "half-renamed,
  no error" failure this ticket exists to prevent). `agents_one_worker_per_ticket` and `agents_ws_status`
  are unchanged and just need to be re-declared after the rebuild, per 0023's pattern.
- `decisions`: CHECK becomes `owner IN ('human','weaver')`. The `kind` CHECK (already listing
  `action_approval` per 0023) is copied forward unchanged. **The four `conductor_review_*` columns
  are renamed to `weaver_review_*` in this same rebuild**, rather than as a separate `ALTER TABLE …
  RENAME COLUMN` pass — `decisions` is already being torn down and rebuilt for the `owner` CHECK, so
  doing both in one `CREATE TABLE decisions_new (...)` avoids a second rebuild of the same table in
  the same release and keeps the "one row, one migration, one moment it becomes internally
  consistent" property the ticket's context section asks for. `decisions_open_corr`, `decisions_ws_status`,
  and `decisions_ws_project` are re-declared unchanged.
- `roles`: no CHECK on `created_by`, but SQLite has no `ALTER TABLE … ALTER COLUMN SET DEFAULT`, so
  changing the default from `'conductor'` to `'weaver'` needs the same rebuild-and-copy treatment.
  `role_revisions`'s FK is unaffected (it targets `roles(id)`, not a column being renamed).

Because the rename changes *data*, not just a constraint's accepted set (0023's simpler case), every
`INSERT INTO <t>_new SELECT …` names its columns explicitly with a `CASE WHEN <col> = 'conductor'
THEN 'weaver' ELSE <col> END` on the one column being transformed per table — `SELECT *` cannot
express that transform and would additionally fail the new CHECK mid-copy for any row still holding
the old value.

**Two more columns hold the literal and need the same data-level fix, without needing a rebuild**
(found by the conductor scanning every column of this workspace's live database for the value, not
by hunting constraints the way the rest of this decision did — the same lesson the ticket's own
`roles.created_by` note already gave once):

- `role_revisions.author` — plain `TEXT NOT NULL`, no CHECK, no default naming `'conductor'`. Every
  row this workspace has today got its value from `packages/core/src/roles/index.ts`'s
  `writeRevision` callers (task 2.3 already renames those call sites; without this row-level fix the
  existing rows they already wrote would stay `'conductor'` while every new one says `'weaver'`,
  splitting one actor into two as far as any reader grouping or filtering by author is concerned). A
  plain `UPDATE role_revisions SET author = 'weaver' WHERE author = 'conductor'` in the same
  migration file suffices — no rebuild, since no CHECK or default is being changed, just row data.
- `incidents.reporter_kind` — plain `TEXT NOT NULL`, no CHECK either (0022's own header notes this
  table has no workspace FK and is shared verbatim between `daemon.sqlite` and every workspace
  database — incidents are filed at the daemon level, so the workspace copies of this table are
  expected to stay empty). **`daemon.sqlite` — the database that actually holds this data — carries
  six rows with `reporter_kind = 'conductor'` right now**, confirmed directly; the three workspace
  databases hold none, which is the expected distribution for this table, not evidence there is
  nothing to migrate. `packages/core/src/incidents/index.ts` validates writes against
  `INCIDENT_REPORTER_KINDS` (renamed by task 1.1) and `packages/server/src/tools.ts`'s
  incident-listing route filters with `z.enum(INCIDENT_REPORTER_KINDS)`, so those six existing rows
  need the same transform as everything else here, not only future ones. Same `UPDATE … WHERE
  reporter_kind = 'conductor'` treatment, unconditionally (a no-op against an empty table), covers
  both `daemon.sqlite` and every workspace database the migration runs against — one migration file,
  applied by the same `Db.migrate()` regardless of which database it opens.

Both `UPDATE`s run inside the same `-- ac:foreign_keys_off` file as the three rebuilds above (neither
needs FK off itself, but nothing forbids a plain `UPDATE` sharing a migration file that has it on for
other statements).

**Alternative considered**: three separate migration files (one per table), for smaller individual
diffs. Rejected — it multiplies the foreign-keys-off ceremony three times for no isolation benefit
(all three land in the same release regardless), and it would leave a window, mid-sequence, where
some tables' constraints disagree about whether `'conductor'` is still valid.

### Decision 2 — The directory is not moved; the migration only stops re-creating it under the old name

VS-257's report flagged the `conductor/`→`weaver/` directory as an open question ("symlink-back vs.
one-time migration vs. manual move"). This change answers it: **do nothing to existing directories.**
`resolveWorkspaceStateDir()` already resolves an existing `conductor/` directory and keeps it; a
fresh workspace created after this change lands gets `weaver/` from the same resolver, because
`ensureConductor()`'s (renamed) provisioning path no longer hard-codes `'conductor'` as the literal it
mkdirs and stores as `homePath`. No workspace's directory is renamed, symlinked, or copied by this
change or its migration — consistent with `path-compatibility`'s own requirement that resolution
never performs an implicit move.

**Alternative considered**: rename `conductor/` to `weaver/` on every workspace as part of the
migration, now that the resolver supports either name. Rejected — the migration runs inside the
database's transaction; moving a directory is not transactional, cannot be rolled back with the SQL
if a later statement in the same file fails, and buys nothing the resolver doesn't already provide
for free. `path-compatibility`'s own spec requires resolution to never migrate a directory as a side
effect; performing that move here, keyed off the same signal, would contradict the capability this
change explicitly leaves alone.

### Decision 3 — The literal sweep is verified by grep, not enumerated by hand in this document

`rg "'conductor'" packages/ --type ts` currently returns ~280 hits — overwhelmingly test fixtures,
display strings (`'Conductor'` as a display name derived from `kind === 'conductor'`), and TUI/UI
code deriving a label from the kind. Listing each site here would drift the moment any of them is
touched by an unrelated change before this one applies. `tasks.md` breaks the sweep into the
same package-boundary groups CLAUDE.md's repo map already uses (`shared` → `core` → `server` →
`render`/`ui`/`tui`), each ending in re-running the grep scoped to that package, with the *ticket's*
own acceptance criterion — a workspace-wide `rg "'conductor'"` returning nothing that means the
agent kind — as the final task's exit condition. `AGENT_KINDS`/`INCIDENT_REPORTER_KINDS` are updated
first so any call site that already imports the constant instead of hand-spelling the literal needs
no further change; CLAUDE.md's own convention ("never branch on a raw string literal") means sites
still doing so are the ones this sweep is fixing, not sites to leave alone.

### Decision 4 — `CONDUCTOR_TOOLS` renames; the tool-name strings inside it do not

`packages/shared/src/tools.ts`'s `CONDUCTOR_TOOLS` array is a TypeScript identifier grouping which
`ac_*` tools this agent kind gets — it is not one of the 62 tool-name strings the ticket's "Not in
scope" section defers (`ac_*` naming is pending with captain). Its **name** is exactly the kind of
scattered-literal-adjacent identifier Decision 3 sweeps (`packages/server/src/tools.ts:788`'s
`kind === 'conductor' ? [...COMMON_TOOLS, ...CONDUCTOR_TOOLS] : …` already compares the kind value
this ticket renames). It becomes `WEAVER_TOOLS`; every re-export and import site follows
(`packages/server/src/tools.ts`, `packages/server/src/openapi.ts`).

### Decision 5 — Skill directory: rename and re-point the manifest, don't leave a redirect

`skills/agent-conductor-conductor/` → `skills/agent-conductor-weaver/`, `skills/manifest.json`'s
entry updated (`name`, and its `audience` value stays `"conductor"` only if VS-263 is the one that
renames the manifest's `audience` vocabulary — **this change does not touch `audience`**, since that
field is part of the config-key/manifest surface VS-263 owns per the gate-finding answer, and
`audience: conductor | worker | all` is a manifest vocabulary, not the `agents.kind` DB value this
ticket's identity surface is about). Every template/skill file that names
`` `agent-conductor-conductor` `` in prose is updated in the same commit as the directory move, so
the reference and the target never disagree even for one commit.

### Decision 6 — The migration's own evidence is a column-value scan, not the list above

The list in Decision 1 was built by reasoning outward from CHECK constraints and defaults —
correct method, incomplete coverage, since `role_revisions.author` and `incidents.reporter_kind`
carry the same value with no constraint naming it at all. Trusting this document's list (or the
ticket's) as the definition of "done" would repeat the miss. Instead, `tasks.md`'s migration test
(task 1.3) seeds a database and, after migration, scans **every column of every table** for the
literal value `'conductor'` (a generated `SELECT` over `sqlite_master`'s column list per table, or
the equivalent one-by-one, whichever is less code) and asserts zero matches — the same method the
conductor used to find the two columns this design initially missed, made repeatable rather than a
one-time manual check. This scan is the migration's actual acceptance evidence; the itemized
rebuild list above is the design record of *how*, not the proof of *complete*.

## Risks / Trade-offs

- **A three-table rebuild in one migration is a bigger single transaction than any prior migration in
  this repo** → Mitigated by following 0023's exact recipe per table (nothing novel per table, just
  three of them) and by the acceptance-criteria-mandated test that runs the migration against a
  database shaped like this workspace's own (a live agent row, decisions it owns, roles it created)
  rather than only an empty schema.
- **Missing a scattered literal site leaves a silent half-rename** (the exact failure this ticket
  exists to prevent) → Mitigated by making the final sweep task's exit condition the same grep the
  ticket's own acceptance criterion names, run after every other task, not trusted to have been
  caught incidentally while touching call sites for other reasons.
- **Renaming `decisions.conductor_review_*` touches a column set with its own dedicated spec**
  (`human-decisions/conductor-review`) **and its own source file** (`conductor-review.ts`) →
  Mitigated by Non-Goals: the spec's behavior is unchanged, so no spec delta is needed, but the
  implementation rename must be complete in one commit (file rename, every field name, every read/
  write site) rather than partial, since a half-renamed field name would compile-fail rather than
  silently drift — TypeScript's own type-checking is the safety net here that the DB migration needs
  application-level care to get.
- **This workspace is itself the live installation the migration runs against on `conductor daemon
  upgrade`** → Out of this change's control (the human runs the upgrade, per this project's own
  "Developing AgentConductor inside AgentConductor" rule); the acceptance criterion testing against a
  workspace-shaped database is the closest verification reachable from inside a worker's worktree.
- **A constraint-driven inventory finds every column with a CHECK or default naming the value, and
  silently nothing else** → this is not hypothetical — it is exactly how `role_revisions.author` and
  `incidents.reporter_kind` were missed from this design's first pass despite `roles.created_by`
  (found the same way, by a different reader) already being a warning shot. Mitigated by Decision 6:
  the migration's acceptance evidence is a scan of every column for the value, not the itemized list.
- **Leaving `openspec/specs/**` untouched is deliberate, but ships a real inconsistency**: shipped
  spec prose (e.g. `human-decisions/conductor-review`) will keep saying "the conductor" while the
  code and schema say `weaver` → Not mitigated within this change (see Non-Goals); called out here so
  it is a known, argued gap rather than something VS-260 discovers unannounced. The delivery report
  for this ticket states this explicitly for whoever picks up VS-260 next.

## Migration Plan

Single forward migration (`0027_agent_kind_weaver.sql`), applied by `Db.migrate()` on next daemon
start after this PR is built and deployed — no separate rollout step. Rollback is this repo's
existing one-way migration story (`conductor daemon upgrade` snapshots the database first; rolling
back to a pre-0027 release restores from that snapshot, per `packages/release`'s documented backup
step referenced by 0012's own migration header). No feature flag, no dual-read/dual-write period:
the rename is atomic within the migration transaction, and application code is deployed in the same
release as the migration, so there is no window where code expects `weaver` while the database still
says `conductor`, or vice versa.
