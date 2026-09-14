## Why

YOLO mode — the daemon granting a ticket's plan and merge approvals itself (PLAN §15) — is
controlled by a workspace-wide `defaults.yolo` that every project without an override inherits. One
switch therefore turns automatic approvals on for every project, including ones added later, so
granting autonomy is never a deliberate choice about one repository. Scoping YOLO to a project makes
the grant explicit and keeps a new project safe by default.

## What Changes

- **BREAKING**: YOLO becomes a per-project setting only. `defaults.yolo` stops granting anything;
  a project with no `policies.yolo` is off; a project added later starts off.
- A one-time migration copies `defaults.yolo: true` onto every existing project that has no explicit
  `policies.yolo`, logging what it changed, so no running workspace silently loses autonomy. An
  explicit per-project `false` is preserved. The workspace key is then ignored, and writing it is
  refused as deprecated.
- Settings → Projects gains a per-project YOLO toggle (off by default) that requires explicit
  confirmation and states that plan and merge approvals are granted for that project while action
  approvals always stay with the human. A project with YOLO on shows a marker in its row and in the
  V2 project overview header.
- The workspace-wide YOLO switch is removed from Settings (V1 and V2) and replaced with a one-line
  note pointing at Projects. The global workspace YOLO banner is removed, because there is no longer
  a workspace-wide mode it could truthfully announce.
- The CLI and API follow the same model: `weave project set-policy <id> yolo=on|off` stays the way
  to set it, a project's value is visible on read, and `weave workspace set-default yolo=…` /
  `PATCH /config` refuse the deprecated workspace key.
- V2 onboarding's "Let the weaver decide" chip no longer writes `defaults.yolo`; it writes
  `policies.yolo: true` onto the projects added in that onboarding run (recommended over removing
  the chip, so the designed autonomy question still means something).
- PLAN §15 and the affected capabilities are updated.

## Capabilities

### New Capabilities
- (none)

### Modified Capabilities
- `human-decisions/auto-approval`: YOLO is a project setting with no workspace fallback; the
  migration and deprecation of the workspace key; the auto-approval answer names the project; the
  per-project marker replaces the workspace-wide indicator.
- `web-settings/project-policies`: a per-project YOLO control that requires confirmation and is
  marked when on, replacing the inherit/on/off select.
- `web-v2/onboarding`: the autonomy question writes per-project YOLO for the projects being added
  instead of `defaults.yolo`.
- `web-v2/project-overview`: the overview marks a project with YOLO mode on.

## Impact

- `packages/shared/src/config.ts` (`yoloEnabled`, `WorkspaceDefaultsSchema.yolo`), and
  `packages/core/src/workspace/loader.ts` (one-time migration).
- `packages/core/src/tickets/service.ts` and `packages/core/src/prompts/index.ts` (resolution and
  the recorded answer text).
- `packages/server/src/routes/workspace.ts` (refuse the deprecated `defaults.yolo`).
- `packages/cli/src/commands/workspace.ts` and `project.ts` (drop/warn on the workspace key, keep
  the project-policy path).
- `packages/ui`: `lib/yolo.ts`, `routes/Settings.tsx`, `app/AppShell.tsx`,
  `v2/settings/sections/Workspace.tsx`, `v2/V2Onboarding.tsx`, `v2/project/ProjectPage.tsx`.
- `docs/PLAN.md` §15. Existing tests across core/server and UI that assert `defaults.yolo`.
