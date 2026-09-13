## Context

See `proposal.md` for motivation. The constraints that shape the approach:

- The write path already exists: `PATCH /api/w/:ws/projects/:id` parses
  `ProjectConfigSchema.partial().strict()` and `projects.update` writes `name` to the `projects` row
  and the `workspace.yaml` block. No new route is needed.
- `projects.name` is `TEXT NOT NULL` and is defaulted to the slug at add time
  (`packages/core/src/projects/index.ts:172`), so a project's name is never null — the "no name"
  case is an empty or whitespace string, not a null.
- `projects.update` currently keeps the existing name when the patch omits it
  (`merged.name ?? project.name`), so there is no clear sentinel for `name`; `landingBranch` already
  established the empty-string sentinel in the same method.
- The UI's `usePatchProject` optimistically merges the patch into the cached project list, and
  `project.updated` already invalidates `qk.projects(ws)` (a prefix key), so a committed name is
  reflected everywhere the moment the cache updates — no new event plumbing.
- The project route `/w/$ws/p/$project` resolves by **id or slug** (`lib/projectOverview.ts`), never
  by name. Several call sites reuse one `projectSlug` value as both the display label and the link
  target (`DecisionCard`, `Chat`, `TicketPage`, `NeedsYou`, `GlobalNeeds`), so label and identifier
  must be separated there.
- Knowledge payloads carry a project's `projectId` and `projectSlug` but not its name; the app
  already loads each workspace's project list, so a label can be resolved client-side from the id.

## Goals / Non-Goals

**Goals:**

- One shared label rule, used by core and the web app, so no surface disagrees.
- The Settings field, its clearing semantics, and the fallback to the slug.
- The label on every human-readable surface, and on the daemon's own human-facing text.
- The slug preserved wherever it is an identifier.

**Non-Goals:**

- Changing a project's slug/id (clone path, worktrees, `knowledge/projects/<slug>/`, routing,
  `workspace.yaml` id). Out of scope on the ticket.
- Renaming the GitHub repository.
- Unifying project-colour assignment (keyed on id today) or the routing resolver.

## Decisions

### 1. The label rule lives in `packages/shared`, as a pure function

`projectLabel(p: Pick<Project, 'name' | 'slug'>): string` returns
`p.name?.trim() || p.slug`, beside the existing `landingBranchOf` in
`packages/shared/src/types.ts`. `shared` is imported by core, the web app, the TUI and the CLI and
imports nothing itself, so one definition serves the daemon's own strings and every client. A UI-only
helper would have to be duplicated for the weaver's project list; a `render` helper would not be
reachable from the core prompt builders.

### 2. Clearing is the empty-string sentinel, stored empty, read as absent

The Settings field trims its draft and commits the empty string to clear, mirroring `landingBranch`.
`projects.update` trims an incoming `name`; an empty result clears it. Because the DB column is
`NOT NULL`, "cleared" is stored as the empty string, and the `workspace.yaml` block omits the key
rather than carrying a meaningless empty value. Every reader goes through `projectLabel`, which
treats empty/whitespace as absent and falls back to the slug.

Why not store the slug as the name on clear: the ticket asks for a fallback rule (`name` then
`slug`), which only exists because a cleared name is representable. Storing the slug would freeze it
and break when the project is renamed again. Why not a `null` name: the column and the `Project`
wire type are non-nullable, and threading a null through the schema would touch far more than this
ticket.

### 3. Label and identifier are separated at the five shared call sites

`DecisionCard` gains a `projectLabel` (display) prop distinct from its existing `projectSlug`
(navigation/PR-link) prop. Its callers (`TicketPage`, `NeedsYou`, `GlobalNeeds`, `Chat`) resolve the
label from the loaded project list by project id and keep passing the slug for navigation. The
`/p/$project` routes and `lib/projectOverview.ts` are untouched. Everywhere else the display site
and the link target are already separate (`WorkspaceNav` link param vs label; map node `href` vs
`title`).

### 4. Knowledge surfaces resolve the label from the project id the payload already carries

Knowledge nodes, files and hubs carry `projectId` and `projectSlug`. The knowledge area joins
`projectId → projectLabel` against the workspace project list it already fetches and falls back to
`projectSlug` when the project is not loaded. `projectSlug` stays the cluster/colour identity and
the path key. No server payload change is needed.

### 5. The daemon's strings use the same helper

`prompts/index.ts` builds the weaver's project list as
`` - `<slug>` — <projectLabel> `` and the role lines with the project's label; a project with an
unset name no longer renders a dangling separator. The same builder feeds the worker brief's
`project.name` from `projectLabel(p)`, so a cleared name never reaches a worker template as a blank
string. The other human-facing strings that name a
project — the hire decision title (`roles/index.ts`), curation/scout ticket titles
(`workers/index.ts`, `projects/index.ts`), the changelog entry's project label
(`changelog/index.ts`), and the chat dispatch wake reason (`threads/service.ts`) — resolve the name
from the project row/workspace config they already have and use `projectLabel`. Strings that name a
project *path* or id keep the slug.

### 6. Settings shows the label on the rows, the field shows the raw name

The row's label uses `projectLabel`; the editable field's value is `p.name` (empty when cleared),
so clearing is visible as an empty field rather than as a re-materialised slug. The move/remove
sheets keep the slug where it is identity (clash check, `moveProject`), and use the label where the
copy names the project to the operator. The workspace-level name field is unchanged.

### 7. The weaver's project list keeps the slug as the identifier

The rendered line stays `` - `<slug>` — <label> ``, so the weaver can still pass a slug to the CLI
and tools while reading the name first. This matches the ticket's `- <slug> — <name>` shape and the
existing "slug is the identifier" rule.

## Risks / Trade-offs

- **Two projects can share a display name** → the slug remains the identity everywhere it matters
  (routes, links, move/remove), and the project-overview header already shows both, so a name clash
  is visible rather than ambiguous. Not treated as an error.
- **The weaver list's line format changes** → a test asserts both the slug and the label are
  present and that an empty name does not leave a dangling separator.
- **Missing `name` on UI test fixtures would render `undefined`** → `projectLabel` falls back on
  falsy/whitespace, so fixtures without a name show the slug; a project fixture with a name and a
  project fixture without are both covered by the helper test and the surface tests.
- **The optimistic PATCH merges `{ name: '' }` into the cache** → `projectLabel` renders the slug
  immediately, which is the intended cleared state; `onError` restores the snapshot on rejection.

## Migration Plan

None. A released-web-app change; the daemon applies project config live and `weave daemon upgrade`
is the owner's deploy step. No data migration and no rollback beyond reverting the release. Existing
projects keep their seeded `name` (equal to the slug) until renamed.
