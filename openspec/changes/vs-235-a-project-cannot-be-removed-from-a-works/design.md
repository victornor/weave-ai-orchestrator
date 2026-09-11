## Context

See proposal.md for why. Constraints that shape the approach:

- `DELETE /api/w/:ws/projects/:id` already archives (`packages/core/src/projects/index.ts` `remove`):
  refuses while `agents.project_id` has rows whose status is not `retired`/`done`, sets
  `status: 'archived'`, drops the `workspace.yaml` declaration, emits `project.removed`, **leaves
  the clone on disk**. CLI `conductor project remove` already calls it. Settings does not.
- `POST /projects` is 202, starts a clone job, seeds knowledge, files a scout. `createRow` refuses
  a duplicate slug in **that** workspace even when the existing row is archived — so re-adding to
  the *same* workspace after remove is already impossible. A different workspace is a different
  SQLite database; the slug is free there.
- Each workspace is its own `db.sqlite`. Tickets, knowledge, specs, runs and usage have no
  cross-workspace table. A real row migration would remint ticket numbers, rewrite role and agent
  ids, and invent history the destination never had.
- `GET /projects` returns archived rows. Chat already hides them in the picker. The sidebar lists
  every fetched project today. Colour uniqueness (VS-173) must keep passing the full id list,
  including archived.
- VS-230 is landed: workspace settings is `/w/$ws/settings?section=projects`, no area switcher.
- `useAddProject` closes over `useWs()`. A destination add has to call `api.ws(destId, …)`
  explicitly (`packages/ui`'s `api.ws` already takes a workspace id).
- Wrapping a `<button>` in Settings' `Field` (a `<label>`) steals the button's accessible name
  (VS-135). Remove/Move must not sit inside `Field`.

## Goals / Non-Goals

**Goals:**

- Settings controls for remove and move, with honest confirm copy.
- Live-worker (and dest-slug) refusals as reasons.
- Sidebar drops archived projects so remove actually takes the project out of navigation.
- Recorded move semantics: remove-and-re-add, clone left, history stays.

**Non-Goals:**

- Cross-workspace ticket/knowledge/run migration.
- Changing `projects.remove`, clone-on-disk policy, or `GET /projects` (archived rows stay in the
  payload).
- Un-archive / re-add to the same workspace (slug still occupied).
- A dedicated move HTTP endpoint.
- CLI `project move` (remove already exists; add to the other workspace is `conductor project add`
  against that workspace).
- Deleting or relocating the source clone.

## Decisions

### D1 — Move is remove-and-re-add, not a migration

Captain's case is a project added to the wrong workspace with little or nothing accumulated.
Archiving in the source and adding in the destination serves that completely. Carrying tickets,
knowledge, spec index, runs and usage across two SQLite files is a different product: ticket
numbers are per-workspace, roles belong to the source, run history names agents that do not exist
in the destination. That work needs a real need, not this mistaken-add.

The UI must say so before confirm. A move that silently left a year of tickets behind would be
worse than no move.

Alternative considered: a daemon-level `POST /projects/:id/move` that copies rows. Rejected —
scope, identity problems, and it would still have to clone under the destination path. Alternative:
no Move button, only Remove plus "add it over there". Rejected — captain asked to move it, and
copying slug/url/settings into the dest add is what makes that one action instead of two easy-to-
get-wrong ones.

### D2 — Compose existing endpoints; add to dest first, then archive the source

Remove: `DELETE /api/w/:source/projects/:id`. Move: `POST /api/w/:dest/projects` with
`{ url, id: slug, name, defaultBranch, landingBranch, maxWorkers, setupCommand, policies }` from
the source row, then that DELETE. Refuse live workers and dest slug clash **before either write**.
Do **not** wait for the dest clone job to finish before archiving: `POST /projects` is 202
(`startAdd`) — the row exists as `cloning` and the pipeline is detached. The scout ticket and
conductor wake are the *last* step of `runAdd`, after clone / OpenSpec / knowledge, so they do not
fire on 202. Waiting for `ready` would hold the source active for minutes while git clones.

Failure copy:

- Dest POST fails → source is untouched. Retry Move.
- Dest POST 202, then source DELETE fails → dest has the project (likely still `cloning`); source
  is still active. Tell the operator dest already has it and to Remove it here (retrying Move will
  hit the slug-clash reason). "Present twice" is recoverable; "present nowhere" is not.
- Dest POST 202, DELETE succeeds, dest clone later fails → dest `error` with the existing retry;
  source is archived. That is a normal failed add, not a stranded move.

Archive-first (the previous call) is rejected: a failed dest POST after DELETE leaves the project
archived in the source with no un-archive, and Move is no longer offered on that inert row. The
git URL is still on the archived row, so they *could* Add on dest by hand — but that is a different
action than retrying Move, and it is the worse residual.

Alternative: wait for dest `ready` before DELETE. Rejected — minutes of dual-active, and new
workers can be hired on the source during the clone even though we refused live workers at confirm.
Alternative: new coordinating endpoint with rollback. Rejected — two databases, still not atomic.

### D3 — Confirm in a Sheet, not `window.confirm` and not type-to-confirm

Remove and Move need a paragraph of facts. `window.confirm` cannot hold that copy. Type-to-confirm
is for irreversible discard (worktree). Archive is reversible in the sense that history remains;
the danger is misunderstanding, not shredding. `Sheet` (bottom sheet on phone, dialog from `sm`)
already exists.

Remove sheet: title with the slug; body the three facts (archived, history stays, clone left);
Confirm / Cancel.

Move sheet: destination picker (`useWorkspaces()`, exclude current); body the travel/stay list
naming the chosen destination; Confirm disabled until a destination is chosen.

Do not wrap the triggers in `Field`.

### D4 — Live-worker reason matches DELETE, not the board's "live" set

`projects.remove` counts `agents` with `status NOT IN ('retired','done')` — paused, error and idle
block too. The UI pre-check MUST use that same predicate (from `useWorkers()`, which already
defaults to excluding retired). The 409 message from DELETE is the authority if a worker appears
between open and confirm. Board `LIVE_STATUSES` is the wrong set here.

Present as disabled + reason on the row (and on the sheet if opened via a race), not a toast
titled "failed".

### D5 — Dest slug clash is checked before either write

`useProjects(destId)` (`wsOverride` already exists). If any row — including archived — has the
same slug, refuse with a reason and write nothing. `createRow` would 409 anyway; doing it first is
what keeps the source active.

### D6 — Sidebar hides archived; Settings still lists them inert; colours still see them

Sidebar `ProjectsGroup` skips `status === 'archived'`. Settings shows archived rows with a badge
and without edit/remove/move: `projects.update` would `upsertConfigBlock` and write an archived
project back into `workspace.yaml` if those controls stayed. Colour `siblingIds` keeps every id
(VS-173: archived occupy a slot).

### D7 — Copied settings on move, new scout in dest

The dest add is a normal add, so dest gets a scout and a conductor wake. That is correct: dest's
conductor has never seen this project. Do not try to suppress the scout. Do not copy tickets.

## Risks / Trade-offs

- **[Partial move]** Dest add fails → source untouched, retry Move. Dest add 202 then source
  archive fails → dest has it, Remove here. Dest clone fails after both writes → dest `error` plus
  retry, source archived. No "present nowhere" residual.
- **[Paused workers block]** Stricter than "nothing is moving". → Match the existing DELETE;
  changing the server predicate is out of scope. The reason names workers, not "live".
- **[Same-workspace re-add impossible]** Archived slug still occupies the row. → Not this ticket.
  Move is to *another* workspace. Mention in the remove copy only if we would otherwise imply they
  can undo by adding again here — we will not imply that.
- **[Two clones on disk]** Source clone left, dest clones afresh. Disk grows. → Existing remove
  policy; ticket forbids changing it. Stated in both confirms.

## Migration Plan

None. No schema, no backfill. Rollback is revert the UI.

## Open Questions

None. Move semantics are D1; write order is D2 (add-first); clone policy is the existing
leave-on-disk; same-workspace un-archive is explicitly out of scope.
