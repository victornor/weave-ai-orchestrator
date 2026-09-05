## Why

The workspace owner cannot see how productive the workspace has been. Every ticket filed, plan approved, PR opened, delivery landed, cancellation, hire and daemon upgrade is already written to the `activity` table — and nothing in the product ever reads it back. There is no route, no CLI command and no screen over it, so a year of real history sits in the database and is invisible.

The knowledge bases cannot fill this gap: they are budgeted, curated and injected into agent context, so a growing record of "what happened when" is exactly what they must not hold. This change gives the owner a human-facing, append-only changelog per project and for the whole workspace, with a timeline and a productivity heatmap, without putting a single extra token into any agent's context.

## What Changes

- **The changelog is a read-only projection over the existing `activity` table**, not a new log and not a knowledge file. A fixed set of `action` values (ticket filed, plan approved, PR opened, delivery landed, ticket cancelled, role hired, daemon upgrade) becomes changelog entries; every other activity row stays operational detail. Because the projection reads history that is already recorded, **backfill is inherent** — the view is populated on first upgrade with no migration job.
- **`activity` gains a `project_id` column**, backfilled from the ticket, role or project each existing row refers to, so a per-project changelog is one indexed query rather than a join chain. Two indexes support paging and the heatmap range scan.
- **A daemon upgrade becomes visible per workspace.** Upgrades are recorded in `daemon.sqlite`, which has no workspace; on the daemon's post-upgrade reconciliation each registered workspace gets one activity row for the version it came back on. This is the only new write path.
- **A `ChangelogService`** in core exposes `list` (newest first, cursor-paged) and `heatmap` (per-day counts over a range, bucketed in a named timezone).
- **Entry summaries are rendered by a pure function in `packages/render`**, so web app, CLI and future surfaces produce the same one-line summary from the same row.
- **The web app's Knowledge area gains a Changelog tab**, per project and for the whole workspace: a heatmap of the last year above a newest-first timeline with day, week and month separators, entries linking to their ticket or PR, older history loaded on demand.
- **The CLI gains `conductor changelog`**, printing a project's or the workspace's changelog for a date range.
- **The changelog is never injected into any agent's context** and is outside the knowledge budget and curation machinery entirely. A test asserts it.

Not breaking: no existing route, response shape, CLI command or knowledge file changes behaviour.

## Capabilities

### New Capabilities
- `workspace-changelog/entry-recording`: which events become changelog entries, the shape of an entry, the append-only and never-injected guarantees, project and workspace scoping, and that existing history is present without a backfill step.
- `workspace-changelog/timeline-view`: the web app's Changelog view — newest-first timeline, day/week/month separators, links to ticket and PR, paging on demand, and the activity heatmap with its stated productivity measure, per-day detail and click-to-scroll.
- `workspace-changelog/changelog-cli`: printing a project's or the workspace's changelog for a date range from the command line.

### Modified Capabilities

None. The changelog deliberately sits outside `knowledge/budgets`: it is not a knowledge file, so no budget, curation or bootstrap requirement changes. The guarantee that it stays out of agent context is stated as a requirement of the new capability rather than as a change to the knowledge capability.

## Impact

- `packages/db`: one migration adding `activity.project_id` plus indexes, backfilling existing rows.
- `packages/shared`: the changelog entry kinds and the entry/heatmap wire types.
- `packages/core`: a new `changelog` service on `CoreServices`; the two test harnesses that proxy unstubbed services must supply it. One new activity write in the upgrade reconciliation path.
- `packages/render`: a pure summary renderer plus timeline grouping, golden-tested.
- `packages/server`: `GET /changelog` and `GET /changelog/heatmap`; `docs/API.md` updated.
- `packages/ui`: a Changelog tab in the Knowledge route, a heatmap component alongside `Chart.tsx`, new query hooks — every route test that mocks `../api/hooks` wholesale needs the new exports.
- `packages/cli`: a `changelog` command.
- `docs/PLAN.md`: a new §13.6 recording the changelog and its identifiers, since the plan is the naming contract.
