## Why

VS-495 shipped persistent role sessions and VS-525 put a control for them on the V2 Roles screen and on the project overview's Roles section. Captain works from the sidebar, looked under each project's **Roadmap** for the role chats he had asked for, found nothing, and concluded the feature was missing. The sessions work; the sidebar entry he actually asked for was never built — VS-525 added a second door on the project page instead.

## What Changes

- Under each project's **Roadmap** row in the V2 sidebar — and in the phone **More** list, which renders the same project pair — add one child row per role of that project. Activating a role row opens that role's persistent session directly: it resumes the existing conversation, or starts one on first use, exactly as the existing role-chat control does. It does not route through the Roles screen or the project overview.
- A role that cannot serve a session (paused, retired, awaiting hire approval) is still shown, but as a disabled, non-interactive row carrying the reason from `roleChatBlockedReason`, so the roster stays complete and the reason is visible without a failed click.
- A project with many roles is capped: the first few roles render as rows and a final row says how many more there are, opening the project overview where the full Roles list lives. A project with no roles adds nothing.
- The role whose session is the current page is marked in place; no new live indicator is invented (no navigation row carries one today).
- The two existing doors (the Roles screen and the project overview's Roles section) keep working, and all three surfaces share one open-or-resume operation.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `web-v2/navigation`: each project's rail and More-list entry lists its roles' chat rows under Roadmap, with the role states, the current-conversation mark and the many-roles cap.
- `role-management`: a role's persistent session is also reachable from the shell's own navigation (the rail and the phone More list), through the same open-or-resume operation.

## Impact

- **UI**: `packages/ui/src/v2/V2Shell.tsx` fetches per-workspace roles and session agents and passes them down; `packages/ui/src/v2/roleChat.tsx` gains the shared open helper and the row control; `packages/ui/src/api/hooks.ts` lets `usePersistentSession` target an explicit workspace (the sidebar spans workspaces and sits above the workspace provider); `packages/ui/src/index.css` gains the current-child-row style.
- **Tests**: pure row-list tests (visibility by status, cap, empty project), a shell test that a role row opens the session in that project's workspace and navigates to it, and the phone More-list equivalent.
- **No change** to how a session is created, resumed or dispatched. No daemon, HTTP API, config or migration change. The sidebar change is read-only apart from the existing open-or-resume call.