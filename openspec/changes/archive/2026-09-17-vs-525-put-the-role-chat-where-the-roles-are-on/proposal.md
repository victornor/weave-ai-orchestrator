## Why

VS-495 shipped persistent role sessions, but its only entry point is a small `Chat` text link on each role's card on the Roles page — a page captain does not work from. He looked for the persistent sessions on the project page, under the roadmap, and concluded the feature had disappeared. The feature working but being unfindable is the defect.

## What Changes

- The project overview gains a **Roles** section, immediately below Roadmap, listing that project's roles with a control that opens each role's persistent session — reusing the existing open-or-resume call the Roles page already makes, not a second implementation.
- Each listed role shows its name, its state (active / paused / awaiting hire approval / retired), and whether its persistent session already exists or would be created on use, so resuming an existing conversation and starting a new one are visibly different actions.
- A role that is not active SHALL NOT offer a session it cannot serve: the row states why rather than presenting a control that fails on click.
- The Roles page keeps its control and adopts the same wording, so the two surfaces do not use two different words for one thing.
- To know whether a session already exists before opening it, `GET /workers` gains an optional `kind` filter so the web app can list a project's `session`-kind agents. The default stays workers only, so every existing caller is unchanged.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `role-management`: a role's persistent session is reachable from the project overview as well as the roles surface; the entry point names whether it starts or resumes and is withheld, with the reason, for a role that cannot serve it.
- `web-v2/project-overview`: the overview's sections now include Roles, listing the project's roles under Roadmap and opening their persistent sessions.
- `web-v2/roles`: the role row's session control names whether it starts or resumes, aligned with the project overview.

## Impact

- **Core**: `packages/core/src/workers/index.ts` — `WorkersService.list` accepts an optional kind filter, defaulting to `['worker']` so the presenter, the roles detail route and the weaver's worker tool are unaffected.
- **Server**: `packages/server/src/routes/workers.ts` — `GET /workers` accepts `kind` (a comma-separated list of agent kinds); `docs/API.md` documents it.
- **UI**: a new shared role-chat control module; a new `packages/ui/src/v2/project/RoleChatsSection.tsx` registered in `packages/ui/src/v2/project/sections.tsx`; `RolesPage.tsx` switches its `Chat` link to the shared control; `packages/ui/src/api/hooks.ts` gains the `kind` filter and a `useSessions` convenience.
- **Tests**: the core kind filter, the server route's `kind` parameter, the new overview section, and the aligned Roles control.
- **No change** to how a session is created, resumed or dispatched; no change to transient worker spawning, role hiring or the persistent-session lifecycle. The new `kind` filter is read-only.
