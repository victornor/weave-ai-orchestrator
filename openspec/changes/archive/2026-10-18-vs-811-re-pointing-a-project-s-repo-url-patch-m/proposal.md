## Why

Editing a project's repo URL is cosmetic today: `projects.update()` merges `url` into the config block but never writes `projects.git_url` nor re-points the clone's `origin`, and Settings → Projects has no URL field. Weave AI cannot be moved to a new repo without standing up a second project.

## What Changes

- `projects.update()`: when `url` differs from the row's `gitUrl`, verify the new remote (reachable, default branch present), then set `origin` on the clone, fetch, update `projects.git_url`, and keep the config entry in step. Any failure writes nothing and leaves `origin` as it was.
- Settings → Projects shows the current URL and saves a new one through `PATCH /projects/:id`, surfacing the server's error.
- Tickets, knowledge, roles and the release pipeline are untouched.

## Capabilities

### New Capabilities
- `project-repo-url`: re-pointing an existing project at a different git remote.

### Modified Capabilities

## Impact

`packages/core/src/projects/index.ts`, `packages/server/src/routes/projects.ts` (patch schema, if `url` is not already accepted), `packages/ui/src/settings/sections.tsx` and its update hook.
