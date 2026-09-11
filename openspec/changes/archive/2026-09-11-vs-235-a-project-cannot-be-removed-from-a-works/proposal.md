## Why

Captain added a project to the wrong workspace and cannot move it, and there is no control in
workspace settings to remove a project at all. Removal already exists as `DELETE /api/w/:ws/projects/:id`
and is non-destructive (archive the row, drop the declaration, leave the clone on disk); nothing in
the UI calls it. Moving cannot be a field change: each workspace is its own SQLite database.

## What Changes

- **Remove from workspace settings.** Each active project row in the Projects section offers Remove.
  Confirming calls the existing DELETE. The confirm copy states what actually happens: the project
  is archived (not deleted), tickets and knowledge stay in this workspace, the clone is left on disk.
  It does not claim a shred or a disk cleanup.
- **Move is remove-and-re-add, not a cross-database migration.** Confirming a move adds the project
  to the destination first (`POST /projects`, 202 — the clone job starts), then archives it in the
  source (same DELETE). Copied across: git URL and project config (`id`/slug, branches, max workers,
  setup command, policies). Tickets, knowledge, spec index, runs and usage **stay in the source**
  under the archived project. The destination clones afresh and gets a new scout once that add
  finishes, as any add does. The source clone stays on disk; the destination does not reuse it.
  Add-first means an add failure leaves the source untouched; an archive failure after a successful
  add leaves the project in both places, which is fixed by Remove on the source.
- **The human is told that before they confirm.** The move sheet names the destination and lists
  what travels (the repo and the project settings copied into the add) versus what stays behind
  (history in the source workspace; the source clone).
- **Live workers block both actions.** A project with live workers cannot be removed or moved. The
  UI shows that as a reason on the control, not as a failed request. A 409 from DELETE is shown the
  same way if a worker appears between open and confirm.
- **Archived projects leave the sidebar.** After remove (and after the source side of a move) the
  project is no longer listed in that workspace's sidebar group. Settings may still show the
  archived row, without edit/remove/move controls, so the operator can see it was archived rather
  than shredded.
- **No new server endpoint, no data migration, no clone-on-disk policy change.**

## Capabilities

### New Capabilities

- `web-settings/remove-project`: offering Remove on an active project in workspace settings, the
  archive semantics the control must state, the live-worker refusal as a reason, and that an
  archived project leaves the sidebar and is not editable from Settings.
- `web-settings/move-project`: offering Move to another workspace as add-in-destination then
  archive-in-source, the confirm copy that names what travels and what stays, copied project config,
  the same live-worker refusal, the dest-already-has-that-slug refusal before either write, and
  the recovery copy for add-fail (source untouched) vs archive-fail-after-add (Remove here).

### Modified Capabilities

- `workspace-navigation/sidebar-workspaces`: an expanded group lists the workspace's **active**
  (non-archived) projects. Archived projects SHALL NOT appear as sidebar rows.

## Impact

- `packages/ui/src/routes/Settings.tsx` — Remove and Move on `ProjectRow` / `ProjectsSection`,
  confirm sheets, archived-row presentation.
- `packages/ui/src/api/hooks.ts` — `useRemoveProject` (DELETE); move composes that with
  `useAddProject` against the destination workspace id (`api.ws(dest, …)` already takes an explicit
  workspace).
- `packages/ui/src/app/WorkspaceNav.tsx` — skip `status === 'archived'` when listing project rows;
  colour uniqueness still uses the full id list including archived (VS-173).
- Tests: `settings.test.tsx` (remove/move sheets, copy, live-worker reason, dest picker, dest-slug
  conflict, archived row); `workspacenav.test.tsx` (archived not listed). Hooks mock gains the new
  mutation.
- `DELETE /projects/:id` and `POST /projects` unchanged. No CLI `project move` (CLI already has
  `project remove`). No core/schema change.
