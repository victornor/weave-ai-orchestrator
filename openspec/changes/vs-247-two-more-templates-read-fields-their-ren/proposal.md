# Two shipped templates stop reading fields their renderers never pass

Tracker change for [VS-247](conductor://tickets/VS-247). A `task` ticket, so this change carries
tasks only — `skip_specs: true`. No capability specifies what a shipped template may read; this is
template/renderer agreement plus test coverage, not product behavior.

## Why

VS-243 fixed the conductor template rendering its portfolio blank and its worker reported the same
class of drift in two more shipped templates. A template reads a field its renderer never supplies;
the field renders empty (or, worse, an `{{#if}}`/`{{#unless}}` built on it silently picks the wrong
branch). Both went unnoticed because the only shipped-template tests assert there are no leftover
`{{placeholder}}` markers — an absent value renders as empty, not as a marker.

### 1. `templates/charter.md.tmpl` — a blank header

The header reads

```
**Project:** `{{role.project}}` · default branch `{{project.defaultBranch}}` · delivery `{{project.deliveryMode}}` · merge method `{{project.mergeMethod}}`
```

`renderCharter` (`packages/core/src/prompts/index.ts`) passes `project: { id: spec.project }` only.
All four values render blank, so every role charter carries a header with gaps where its project
context should be. The values exist on the `projects` row (`slug`, `default_branch`) and its
`policies_json` (`deliveryMode`, `mergeMethod`) — the renderer simply never reads them, and the
header's own project field names `role.project`, which no renderer supplies either.

### 2. `templates/brief.md.tmpl` — the wrong block, not a blank one

The template chooses its curation block with `{{#if brief.noWorktree}}` and its worktree-setup block
with `{{#unless brief.noWorktree}}`, but `brief.noWorktree` is never supplied. Since the flag is
always falsy, a curation worker — which has no worktree — is handed the worktree-setup block,
describing a branch and path it does not have, and never sees the curation instructions. That is the
bug that makes this more than cosmetic.

## What changes

- **`renderCharter` supplies the four header values honestly.** It looks the project up by slug (as
  `hire` already does) and reads `slug`, `default_branch` and the resolved `deliveryMode`/`mergeMethod`
  from the row and its policies, with the same fallbacks `workerData` already uses; the header's
  project field is changed from the unsupplied `role.project` to `project.id`, the same object the
  other three already read from. A shared `projectHeaders` helper keeps the charter and the brief
  resolving those policies identically, so they cannot drift again.
- **`workerData` supplies `brief.noWorktree`.** The signal is the absence of a worktree on the agent
  (`!agent.worktreePath`) — the same fact `spawn({ noWorktree: true })` writes — so a curation brief
  selects the curation block and an ordinary worker keeps the worktree-setup block. The template is
  unchanged and its curation content is confirmed against
  `skills/agent-conductor-knowledge/references/curation.md`.
- **Shipped-template coverage in `packages/core/src/prompts/render.test.ts`.** One case renders the
  shipped charter and asserts the header names its project, branch, delivery mode and merge method;
  one renders a shipped brief for a no-worktree worker and asserts the curation block, not the
  worktree block, plus the ordinary-worker inverse. Both are confirmed failing against the pre-fix
  renderers.
- **A short audit of the remaining shipped templates.** The conductor and worker templates are
  checked against their renderer data for the same missing-field class and the result is recorded in
  the ticket report.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

(none — the renderers gain honest values from rows that already exist; `skip_specs: true`, tracker
task only)

## Impact

- `packages/core/src/prompts/index.ts` — `renderCharter` reads the project row; `workerData` adds
  `brief.noWorktree`; a `projectHeaders` helper shared by both.
- `templates/charter.md.tmpl` — the header's project field now reads `{{project.id}}` instead of the
  unsupplied `{{role.project}}` (the other three fields are unchanged).
- `packages/core/src/prompts/render.test.ts` — two shipped-template cases.
- No brief template change, no template engine change, no schema or data-model change.
