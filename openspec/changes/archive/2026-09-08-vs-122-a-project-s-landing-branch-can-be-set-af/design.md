## Context

`projects.update()` (`packages/core/src/projects/index.ts:280-294`) already merges a `Partial<ProjectConfig>`
patch over the project's declared config, re-validates through `ProjectConfigSchema`, writes the DB row
(`landingBranch: merged.landingBranch ?? null`) and calls `upsertConfigBlock(merged)`, which round-trips
the whole `workspace.yaml` through `ctx.saveConfig` (`packages/core/src/workspace/loader.ts:253-259`).
`PATCH /projects/:id` (`packages/server/src/routes/projects.ts:30`) already calls it with
`ProjectConfigSchema.partial().strict()`-validated body. None of this is new; see proposal.md - Why.

Every resolver of a project's effective landing branch (`landingBranchOf`, `packages/shared`) is called
against a freshly-fetched project row, not a value cached across requests or held on a long-lived
in-memory object — confirmed at `packages/core/src/tickets/land.ts:60`, `packages/core/src/workers/index.ts:94,403`,
`packages/core/src/prompts/index.ts:102,260`, `packages/server/src/tools.ts:615`,
`packages/server/src/routes/worktrees.ts:34`. That settles proposal AC #3: no restart is needed.

`ProjectConfigSchema.landingBranch` (`packages/shared/src/config.ts:53`) is `z.string().optional()` —
there is no `null` in its type. The route's `.strict()` schema will reject a literal `null` in the PATCH
body. This design treats an **empty string** as the "clear" sentinel, matching how a text `<input>`
naturally reports itself once the user deletes its content (`onBlur`, like the existing `maxWorkers`
field), and how a CLI omitting its optional value would send the same thing.

There is no existing branch-existence check that *rejects* rather than *falls back*:
`detectDefaultBranch()` (`packages/core/src/projects/index.ts:41-47`) silently substitutes the actual
HEAD when the declared branch is missing, because at add-time there is always a sensible fallback.
There is no such fallback at set-time — the human declared this branch on purpose — so this design adds
a new, rejecting check rather than reusing `detectDefaultBranch`.

## Goals / Non-Goals

**Goals:**
- Reach `projects.update()`'s existing `landingBranch` handling from `conductor project` and from the
  web app's Settings page.
- Reject, at set-time, a landing branch absent from the project's remote.
- Make "clear" and "what's in effect when nothing is declared" unambiguous on both surfaces.

**Non-Goals:**
- Changing what a landing branch means or where it is consulted (VS-119's contract stands).
- A per-ticket override surface (creation-only by design, per the ticket).
- An `ac_project_update` MCP tool. The ticket scopes this to the web app and the CLI; the MCP surface
  the conductor uses to call `ac_project_add` has no `ac_project_update` today, and adding one is a
  separate, unrequested surface. Noted as a gap, not built here.
- Fetching the remote automatically before validating. See Decisions.

## Decisions

**Clear sentinel is an empty string, handled in the service layer, not the schema.** `update()` gains:
`patch.landingBranch === '' → merged write is null` (clear, no validation), `patch.landingBranch` a
non-empty string → validate against the remote, reject or accept, `patch.landingBranch` absent →
unchanged (existing merge behavior). Alternative considered: make the Zod field nullable
(`z.string().nullable().optional()`) end-to-end. Rejected — `ProjectConfigSchema` also describes the
declared block written into `workspace.yaml`, where the field's *absence* already means "unset";
introducing a parallel `null` state into the same schema used for `POST /projects` and the on-disk
config duplicates the "unset" representation for no behavioral gain, and every other optional string in
that schema (`setupCommand`) already uses omission, not `null`, as the "no value" plainly.

**Validation checks the already-fetched remote-tracking ref, not a live `git fetch origin` on every
request.** `git rev-parse --verify --quiet origin/<branch>` against the project's `clonePath` (mirroring
`resolveBaseRef`, `packages/core/src/util/git.ts:30-34`, but rejecting instead of falling back to a
second candidate). A branch created on the remote seconds ago and not yet fetched will be rejected until
the daemon's own periodic fetch (or `POST /projects/:id/fetch`) catches up. Alternative considered:
`git fetch origin` before every check, or `git ls-remote --heads origin <branch>` (a real network call
per request). Rejected for this change — the daemon already fetches every project's primary clone
periodically and after every ticket lands, and a network round-trip on every keystroke-driven `PATCH`
would make the web app's inline field noticeably slower and add a failure mode (remote unreachable) to a
local write. The error message says "not found in the last fetch" rather than "does not exist", so a
human hitting this on a brand-new branch knows to fetch first (`conductor project fetch <id>`) rather
than concluding the branch name is wrong. This is a narrower guarantee than the ticket's AC #4 taken
literally ("does not exist on the remote") but matches every other branch check already in this
codebase, none of which fetch first either.

**CLI shape: `project set-landing-branch <id> [branch]`, with `--clear` required when no branch is
given.** Matches the `role set-max-workers`/`set-runtime`/`set-model` (`packages/cli/src/commands/role.ts`)
one-value-per-command convention rather than the merged-object `project set-policy <key>=<value>`
convention (`packages/cli/src/commands/project.ts:125-152`) or a generic `project update`. Requiring an
explicit `--clear` (rather than treating a bare `project set-landing-branch <id>` as "clear") avoids a
forgotten positional silently clearing a value someone meant to inspect or leave alone; `project show
<id>` already prints the current landing branch, so there is no separate "read" gap this closes.

**Web app: reuse `usePatchProject()`, add one inline text field to the existing per-project row in
`ProjectsSection` (`packages/ui/src/routes/Settings.tsx:313-409`).** Same `onBlur`-fires-`patch.mutate`
pattern as the existing `maxWorkers` number input (Settings.tsx:378-384), since a branch name is
free text like that field and not an enum like `yolo`. The input's `placeholder` reads the project's
`defaultBranch` when `landingBranch` is empty, so an empty field always names the branch actually in
effect rather than reading as unset-with-no-explanation (ticket AC #2). A validation rejection surfaces
through the existing mutation's error path (whatever `usePatchProject` already does with a non-2xx
response — no new error-display mechanism).

## Risks / Trade-offs

- [A landing branch pushed to the remote after the daemon's last fetch is rejected as "not found" even
  though it exists] → the error message names `conductor project fetch <id>` as the next step; this
  matches existing behavior for every other branch reference in the codebase and is not a regression.
- [Clearing via empty string is an implicit contract between the two surfaces and the service, not
  enforced by the schema type] → covered by a service-layer test asserting `''` clears and `undefined`
  leaves the field unchanged, so a future refactor that tightens the type will be caught by that test
  rather than silently reintroducing the ambiguity.
- [`ProjectConfigSchema.partial().strict()` on the route still requires `landingBranch` to be a
  `string` when present — an empty string is a valid string, so no schema change is needed at the route
  layer] → no mitigation needed, noted for the implementer.

## Migration Plan

No data migration: `landingBranch` already exists on `projects` (VS-119). Ship order: service-layer
validation and clear-sentinel handling, then the CLI command, then the UI field — each independently
testable and each already exercising the same `update()` path, so partial delivery within the change
leaves no broken intermediate state. Once merged, setting Fernwood's landing branch to `edge` is
`conductor project set-landing-branch fernwood edge` (or the equivalent Settings-page field); state this
literally in the PR per the ticket's Verification section.
