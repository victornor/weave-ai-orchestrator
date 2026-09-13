## 1. Shared label rule

- [x] 1.1 In `packages/shared/src/types.ts` add `export function projectLabel(p: Pick<Project, 'name' | 'slug'>): string { return p.name?.trim() || p.slug }` (exported through the existing `export * from './types.js'`). In `packages/shared/src/types.test.ts` cover: a non-empty name wins; an empty name and a whitespace-only name fall back to the slug; surrounding whitespace is trimmed. Verify `pnpm vitest run packages/shared` is green.

## 2. Clearing semantics in core

- [x] 2.1 In `packages/core/src/projects/index.ts` `update`, treat a `name` that is empty once trimmed as the clear sentinel, like `landingBranch`: the row's `name` becomes the empty string, the `workspace.yaml` block omits the `name` key, and an omitted `name` still keeps the existing value. In `packages/core/src/projects/projects.test.ts` add cases: `{ name: 'Weave AI' }` writes the row and the config block; `{ name: '' }` (and `{ name: '   ' }`) clears both; a patch omitting `name` leaves an existing name in place. Verify the file passes.

## 3. The daemon's own project labels

- [x] 3.1 In `packages/core/src/prompts/index.ts` build the weaver's project list as `` `- \`${p.slug}\` — ${projectLabel(p)}` `` (the slug stays the identifier; the label follows it and is never empty for an unset name), name the project in the role lines by `projectLabel`, and set the worker-brief data's `project.name` to `projectLabel(p)` (line ~118) so a cleared name never reaches a worker template as a blank. In `packages/core/src/prompts/render.test.ts` assert the shipped weaver instructions contain the named project's label, keep the slug, that a project with an empty name renders its slug with no dangling separator, and that the worker brief's project name falls back to the slug when the name is cleared. Verify `pnpm vitest run packages/core/src/prompts` passes.
- [x] 3.2 In `packages/core/src/roles/index.ts` (the hire decision title), `packages/core/src/workers/index.ts` (the curation ticket title) and `packages/core/src/projects/index.ts` (the add scout title/wake reason), name the project by `projectLabel(project)` where the text names the project to a person, keeping the slug wherever the string identifies a path or an id. Verify the affected core tests pass and `pnpm typecheck` is clean.
- [x] 3.3 In `packages/core/src/changelog/index.ts` and `packages/render/src/changelog.ts`, make a "Hired" entry that names a project use the project's label (resolve the name from the project row/config the service already reads) rather than the slug. Add or extend a test so a project with a display name yields the label. Verify the changelog tests pass.

## 4. Settings display-name field

- [x] 4.1 In `packages/ui/src/routes/Settings.tsx` add a display-name field to `ActiveProjectRow` with `useCommittableField` + `CommitStatus`, committing `patch.mutateAsync({ id: p.id, patch: { name: raw.trim() } })` through `usePatchProject`, and render the row's own label with `projectLabel`. Also render `ArchivedProjectRow` with `projectLabel`. In `packages/ui/src/test/settings.test.tsx` assert: committing a name sends exactly `{ name: 'Weave AI' }` (no other project field); clearing sends an empty name and the row then shows the slug; a project with a name renders it. Verify the file passes.
- [x] 4.2 Where the move and remove sheets name the project to the operator in copy (`Remove ${…}`, `Move ${…}`, the "destination already has a project named …" message), use `projectLabel`, while the destination slug-clash check and `lib/moveProject.ts` identity stay on the slug. Verify `pnpm --filter @weave-ai/ui exec vitest run src/test/settings.test.tsx` passes with the updated strings.

## 5. The label across the web app

- [x] 5.1 Sidebar and phone menu: `packages/ui/src/app/WorkspaceNav.tsx` and `packages/ui/src/app/MoreSheet.tsx` show `projectLabel(p)` as the row label (keep `p.slug` in the `/p/$project` link param and the project-colour key on `p.id`). Update `packages/ui/src/test/workspacenav.test.tsx` and `packages/ui/src/test/moreSheet.test.tsx` with distinct names per fixture and assert the name renders while the `href` still uses the slug. Verify both files pass.
- [x] 5.2 Board and AppShell palette: `packages/ui/src/routes/Board.tsx` project filter options use `projectLabel(p)` as the label (value stays `p.id`); `packages/ui/src/app/AppShell.tsx` palette scope and its sub-line use the label of the project it addresses. Keep the `Board.tsx` (and `TicketCard.tsx`) edits to the project label only — VS-328 edits those same files in parallel. Cover the label in `boardRoute`/`appshell` tests. Verify those files pass.
- [x] 5.3 Ticket and worker pages: `packages/ui/src/routes/TicketPage.tsx` (project meta at the header and in the facts row) and `packages/ui/src/routes/WorkerPage.tsx` (project meta) show the label; any project id/slug used as a key stays. Add/extend `ticketPage`/`workerPage` tests with a named and an unnamed project. Verify both files pass.
- [x] 5.4 Team and merge queue: `packages/ui/src/routes/Team.tsx` (per-project heading and the card meta) and `packages/ui/src/routes/MergeQueue.tsx` (project header and selector) use `projectLabel`. Update `team.test.tsx` and `mergeQueue.test.tsx` (which currently omit `name`) and assert name-when-set, slug-when-not. Verify both files pass.
- [x] 5.5 Knowledge and usage: `packages/ui/src/routes/Knowledge.tsx` (project filter, and the search/hub labels that receive a `projectSlug`), `packages/ui/src/routes/project/KnowledgeSection.tsx`, `packages/ui/src/routes/KnowledgeGraph.tsx` and `packages/ui/src/lib/knowledgeExplorer.ts` resolve `projectId → projectLabel` from the loaded project list and fall back to the slug; `packages/ui/src/routes/Usage.tsx` project bars/legend use the label (key stays `p.id`). Verify with the knowledge and usage tests. `[[links]]`, knowledge paths and cluster identity stay on the slug.
- [x] 5.6 Map: `packages/ui/src/lib/map/model.ts` names the project node and its knowledge node with the project's label, keeping `href` and `projectSlug` as the navigation identifier. Update `mapModel.test.ts` and `globalMap.test.tsx` to assert the label renders and the nav param still uses the slug. Verify both pass.
- [x] 5.7 Decision and chat labels: split display from identifier — add a `projectLabel` prop to `packages/ui/src/components/DecisionCard.tsx` (display) alongside `projectSlug` (link), and pass it from `TicketPage`, `NeedsYou`, `GlobalNeeds` and `Chat`; change `Chat.tsx`'s `projectName` helper and the composer `ProjectTag` label to `projectLabel` (falling back to the slug, not a blank). Update `components.test.tsx`, `needsyou.test.tsx`, `globalNeeds.test.tsx` and `chat.test.tsx`. Verify the four files pass.

## 6. Live refresh

- [x] 6.1 In `packages/ui/src/test/events.test.tsx` assert a `project.updated` event invalidates `qk.projects(ws)` as well as the history and per-project sync keys it already invalidates. If the assertion fails, fix the mapping in `packages/ui/src/api/events.ts`. Verify the file passes.

## 7. Documentation

- [x] 7.1 In `docs/API.md` document the already-accepted optional `name` on the project `POST` and `PATCH` bodies (POST at `packages/server/src/routes/projects.ts:8`, PATCH accepting `ProjectConfigSchema.partial()`), noting that an empty value clears it. Verify the doc reads consistently with the route.

## 8. Full verification

- [x] 8.1 Rebase `ac/vs-330-rename-a-project-from-settings-and-show` onto `main` before opening the PR (VS-328 touches `Board.tsx`/`TicketCard.tsx`), keeping both changes if they conflict. Then run `pnpm lint`, `pnpm typecheck` and `pnpm test`, and report both suite blocks verbatim (core/server and UI) with their totals in the delivery. Do not merge on a red run.
