## Context

See `proposal.md` — Why. The constraints that shape the approach are all already in the tree:

- **`activity` already is the log.** `packages/db/src/migrations/0001_init.sql:153` defines `activity(id, workspace_id, actor_kind, actor_id, run_id, action, entity_type, entity_id, ticket_id, details_json, created_at)`, and `recordActivity` (`packages/core/src/events.ts:27`) is called from every service. Every event the ticket names is already written: `ticket.create`, `ticket.transition`, `ticket.cancel`, `ticket.work_product`, `ticket.delivery_landed`, `role.hire`. Nothing reads the table back — `rg "FROM activity"` finds only test assertions.
- **The one gap is the daemon upgrade.** `upgrades` lives in `daemon.sqlite` (`0007_upgrades.sql`), which has no `workspace_id` and no workspace services; the upgrade service is `packages/server/src/upgrade.ts` and its reconciliation runs at daemon start (`packages/server/src/daemon.ts`). That service already holds every workspace runtime (`upgrade.ts:64`, `uniqueWorkspaces` at `:78`), so it can reach each workspace's db from `reconcile()` (`:277`) without new plumbing.
- **`activity` has no `project_id`.** Per-project scoping today would mean a join through `tickets`, `roles` or `entity_id`, differently per row.
- **Knowledge scopes are budgeted, curated and injected.** `KnowledgeScope` is a fixed union in `packages/shared`; `relPathFor` (`packages/core/src/knowledge/files.ts:64`) maps each scope to a file, `budgetOf` gives it a budget, and `bootstrapDigest` (`knowledge/service.ts:436`) injects `SHARED.md`, the project KB and the last 30 lines of `decisions.md`. Anything that becomes a scope inherits all three.
- `packages/render` holds the pure, golden-tested view-model functions shared by web and TUI. `packages/ui/src/components/Chart.tsx` is pure SVG with no chart library.

## Goals / Non-Goals

**Goals**

- One source of truth for the record, queryable by project, by date and by kind.
- Existing history visible with no operator step.
- Exactly one one-line summary per entry, produced once and shared by every surface.
- A per-day aggregation cheap enough to run over a year on every view load.

**Non-Goals**

- A general-purpose audit viewer over all of `activity`. The changelog is a deliberately narrow projection; the operational rows stay invisible.
- Real-time streaming of new entries into an open Changelog view. It refreshes like the rest of the Knowledge area.
- Configurable event kinds or a configurable productivity measure. One fixed set, one stated measure.
- Editing, annotating or exporting entries from the web app.

## Decisions

### D1 — Database-backed, not a markdown file under `knowledge/`

**Chosen:** the changelog is a read-only *projection* over the `activity` table, surfaced by a new `ChangelogService`. There is no `knowledge/**/CHANGELOG.md`.

The ticket asked for this trade-off explicitly, so both sides:

| | Markdown file under `knowledge/` | Table-backed projection |
|---|---|---|
| Human-readable and portable | yes, natively | only through the CLI's output |
| Matches "in the knowledge base" literally | yes | it lives in the Knowledge *area* of the app, not as a knowledge *file* |
| Heatmap over a year | must parse the whole file on every load | one indexed `GROUP BY` |
| Paging older history | must parse the whole file to find page *n* | one indexed range scan |
| Backfill of existing history | a migration job that walks `activity` and writes a file | nothing: the rows are already there |
| Growth without bound | a single file that every read parses in full | rows, indexed |
| Append-only guarantee | a file anyone can edit, and `knowledge` already exposes `PUT`, `revert` and `curate` over files | no write operation exists to expose |
| Stays out of agent context | needs an explicit carve-out from scope, budget, curation, digest and search | inherent: it is not a knowledge file and no agent tool reads `activity` |

The deciding points are backfill and the append-only guarantee. A file would need a real backfill job for an acceptance criterion the table satisfies for free, and putting the record under `knowledge/` would place it inside machinery — `PUT /knowledge/:scope`, `revert`, `curate`, `bootstrapDigest` — that exists to rewrite and inject knowledge files, so every one of those paths would need a carve-out and a test that the carve-out holds. Not being a knowledge file is the cheapest way to guarantee it is never treated as one.

Portability is recovered by `conductor changelog`, which prints the record for any range; the owner can redirect that to a file whenever they want one. This is called out because it is the one thing the file option was better at.

### D2 — A projection over `activity`, not a new `changelog` table

**Chosen:** derive entries at read time from `activity` rows whose `action` is in a fixed set. **Rejected:** a materialised `changelog` table written alongside `recordActivity`.

A second table means a dual write at every call site, a real backfill job, and a class of bug where the two disagree. The projection has none of that and satisfies "existing history is backfilled" by construction. Its cost is that the summary must be rendered from `details_json` at read time — which D4 turns into an advantage.

The mapping, fixed in `packages/shared`:

| changelog kind | `activity.action` | notes |
|---|---|---|
| `filed` | `ticket.create` | |
| `plan_approved` | `ticket.transition` | only where `details.to = 'approved'` |
| `pr_opened` | `ticket.work_product` | only where `details.type = 'pull_request'` |
| `landed` | `ticket.delivery_landed` | carries the landing detail |
| `cancelled` | `ticket.cancel` | |
| `hired` | `role.hire` | |
| `upgraded` | `daemon.upgraded` | new; see D3 |

Two of these are filtered on `details_json`, which SQLite reads with `json_extract`. Both are covered by the index in D5.

`landed` rather than `ticket.transition → done` is deliberate: `delivery_landed` is written once, by `mergeDone`, when the work actually reached the clone. A ticket can reach `done` other ways, and a transition row would also fire for a re-landing.

### D3 — The daemon upgrade is pushed into each workspace

The upgrade record is daemon-level and the changelog is per workspace, so the upgrade must be projected outward. On the reconciliation that runs after the daemon comes back (`upgrade.ts:277`, already the place that sets `came_back_version` at `:285`), the daemon writes one `daemon.upgraded` activity row into each registered workspace, with the from/to release and the requester as the actor, guarded by the upgrade id so a second reconciliation of the same upgrade writes nothing.

This is the only new write path in the change. It cannot be backfilled for upgrades that already happened — the `upgrades` rows predate the marker — so upgrades appear in the changelog from the first upgrade after this ships. Called out in Risks.

### D4 — Summaries are rendered, not stored

A pure `changelogEntry(row) -> Entry` in `packages/render` turns an activity row into `{ at, kind, actor, projectId, ticketIdentifier, summary, link }`. Server, CLI and web app all call it, so the spec's "identical summary on every surface" holds by construction rather than by discipline, and it is golden-tested like the other renderers there. It also means a wording fix is a one-line change that applies retroactively to the whole record — which a stored summary could not do without rewriting append-only rows.

### D5 — `activity.project_id`, backfilled in the migration

Migration `0011_activity_project.sql`:

- `ALTER TABLE activity ADD COLUMN project_id TEXT` (nullable; SQLite adds it with a NULL default, no table rebuild).
- Backfill in the same migration: from `tickets.project_id` via `activity.ticket_id`; for `role.hire` from `roles.project_id` via `entity_id`; for project actions from `entity_id` itself.
- `CREATE INDEX activity_changelog ON activity(workspace_id, created_at DESC, id DESC)` for workspace paging and the heatmap range scan, and `CREATE INDEX activity_changelog_project ON activity(workspace_id, project_id, created_at DESC, id DESC)` for a project's.

`recordActivity` gains an optional `projectId` so new rows carry it directly.

**Reversibility.** Adding a nullable column and two indexes is additive: an older daemon reading this schema ignores both. Rolling back the release needs no down-migration, which matches how the other migrations in this repo are written.

### D6 — Paging by `(created_at, id)`

`activity` has no monotonic sequence — `events` has `seq`, `activity` does not. The cursor is the last returned `(created_at, id)` and the page predicate is `(created_at, id) < (?, ?)` descending. Ids are ULIDs, so they are monotonic within a timestamp and the ordering is total. This gives the spec's stability guarantee: a row inserted during paging sorts above the cursor and is simply not in the older pages.

### D7 — Day bucketing in TypeScript with the caller's IANA timezone

The heatmap and the timeline separators must agree on where a day starts, and SQLite's date functions cannot do IANA timezones — only fixed offsets, which are wrong across a DST boundary and so wrong for part of any one-year range.

So: SQL narrows to the range and the projected actions, and the service buckets the rows in TypeScript with `Intl.DateTimeFormat` in the timezone the caller names, defaulting to the daemon's. The web app passes `Intl.DateTimeFormat().resolvedOptions().timeZone`; the CLI passes the machine's. A year of a busy workspace is on the order of thousands of rows over two indexed columns, which is well inside what this is worth. The returned series is dense — every day in the range, zeros included — so the grid needs no gap filling.

The measure the grid shades is **tickets landed that day** (`landed` entries), with the other kinds' counts in the hover detail. It is the one kind that means work reached the repository, which is what "how productive was the workspace" asks. The definition is rendered as a caption in the view, per the spec.

### D8 — Surfaces

- `GET /changelog?project=&before=&limit=` → `{ entries, nextCursor }`; `GET /changelog/heatmap?project=&from=&to=&tz=` → `{ days: [{ date, landed, total, byKind }], measure }`. Read-only, no `POST`/`PUT`/`DELETE` — the spec's "no client can change an entry" is enforced by there being no route.
- `ChangelogService` is declared as a real interface in `packages/core/src/api.ts`, not `Record<string, unknown>`, so the wire shape the UI reads is typechecked. (`SpecsService` being loosely typed there is what caused the VS-35 crash.)
- Web app: a fourth tab in `KnowledgeRoute`, reusing its existing project selector. The heatmap is a new pure-SVG component next to `Chart.tsx`, following its token-based colouring.
- CLI: `conductor changelog [--project <id>] [--from <date>] [--to <date>] [--json]`, following `conductor usage`'s option style. Default range: the last 30 days, stated in the output.

## Risks / Trade-offs

- **Adding `changelog` to `CoreServices` breaks unrelated tests.** Both `packages/core/src/testing/context.ts` and `packages/server/test/fakes.ts` proxy any unstubbed service into a throw, so every test that reaches the new member fails until both harnesses supply it. → Both harnesses are updated in the same task that adds the service, before anything else calls it.
- **New `packages/ui` hooks break route tests that mock `../api/hooks` wholesale.** → The mocks are updated in the same task, and the ui suite is run separately after every rebase, since the root `pnpm test` chains it with `&&` and its summary is easy to miss.
- **Upgrades are not retroactive.** Upgrades performed before this ships cannot appear in the changelog (D3). → Every other kind backfills fully; the gap is one kind, and it closes at the first upgrade after the release. Not hidden: worth stating to the owner.
- **The backfill of `project_id` is best-effort for orphaned rows.** An activity row whose ticket was hard-deleted, or which refers to nothing with a project, keeps `project_id` NULL and so appears only in the workspace changelog. → Acceptable: the projected kinds all refer to a live ticket, role or project, so this is a theoretical case.
- **Rendering summaries at read time couples the record to `details_json`.** A future change to what a service records could change how an old entry reads. → The renderer treats every field as optional and falls back to the ticket identifier and kind, so a missing detail degrades to a plainer line rather than an empty one; golden tests pin the current shapes.
- **A very large heatmap query.** A workspace with an extreme number of activity rows in one year loads them all to bucket in TypeScript. → The query selects only the projected actions and only `(created_at, project_id, action)`, over a covering index. If it ever matters, the fallback is offset-based SQL bucketing, at the DST cost D7 rejects.

## Migration Plan

1. Migration `0011_activity_project.sql`: add the nullable column, backfill it, create the two indexes. Additive and forward-compatible.
2. Ship the service, routes, CLI and web app. The changelog is populated from existing rows on the first read.
3. Rollback is the standard release rollback (`docs/adr` 0008 / the release symlink); the schema change needs no down-migration because the added column and indexes are ignored by an older release.

No data is rewritten and nothing existing is deleted at any step.
