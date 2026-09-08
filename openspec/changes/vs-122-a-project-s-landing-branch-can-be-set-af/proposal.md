## Why

VS-119 let a project declare a landing branch distinct from its default branch, and rerouted every
"has this work landed?" check through it — but the only place to declare one is `POST /projects` at
creation. Fernwood, the project VS-119 was built for, was added before the field existed, so its
`landingBranch` is null and there is no human-usable way to set it: `conductor project` has no
`update`-shaped command, and the web app's Settings page has no field for it. `projects.update()` and
`PATCH /projects/:id` already accept `landingBranch`, so the capability exists in the daemon and
nothing reaches it. Fernwood still cannot use the feature it was requested for.

## What Changes

- `conductor project set-landing-branch <id> [branch]` — a new CLI command that sets a project's
  landing branch, following the existing `role set-max-workers`/`set-runtime`/`set-model` naming
  convention (a one-value `set-<field>` verb, not a generic `update`). Passing `--clear` (with no
  branch) clears it back to "use the default branch".
- A landing-branch text field on each project's row in the web app's Settings page
  (`ProjectsSection`, alongside the existing inline `maxWorkers` and `yolo` controls that already use
  `usePatchProject()`), following the same on-blur-patch pattern. An empty value is shown with the
  placeholder text naming the default branch actually in effect, so an unset field never reads as
  unexplained emptiness.
- Server-side validation in `projects.update()`: setting a non-empty `landingBranch` fetches the
  project's primary clone and rejects the request with a `validation` error naming the branch when it
  does not exist on `origin`, instead of accepting it and failing later when a ticket tries to land.
  Clearing it (empty string) is always accepted and skips the check.
- No restart is required for the daemon to pick up a changed `landingBranch`: every call site that
  resolves a project's effective landing branch already re-reads the project row per use (per-ticket
  merge verification, worktree creation, landed-work test, worker briefing), not a value cached across
  requests. The UI and CLI both say so at the point of change.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `ticket-delivery/landing-verification`: adds the requirement that a project's landing branch can be
  set, changed and cleared after creation (not only at `POST /projects` time), that setting it to a
  branch absent from the project's remote is rejected at set-time, and that a change takes effect
  without a daemon restart.

## Impact

- `packages/core/src/projects/index.ts` — `update()` gains the remote-branch-existence check for a
  non-empty `landingBranch` patch, and a documented convention for clearing (empty string → `null`).
- `packages/server/src/routes/projects.ts` — no route shape change; `PATCH /projects/:id` already
  accepts `landingBranch` through `ProjectConfigSchema.partial().strict()`.
- `packages/cli/src/commands/project.ts` — new `set-landing-branch` subcommand.
- `packages/ui/src/routes/Settings.tsx` (`ProjectsSection`) — new inline field, `usePatchProject()`
  reused as-is.
- `docs/PLAN.md` §20 (CLI command table) and `docs/API.md` (`PATCH /projects/:id` body) gain the new
  surface.
- Out of scope, per the ticket: what a landing branch means or where it is consulted (VS-119 settled
  that), and the per-ticket override, which stays creation-only by design.
