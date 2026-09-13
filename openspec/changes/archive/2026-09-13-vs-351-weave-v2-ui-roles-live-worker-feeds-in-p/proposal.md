## Why

V2 (`/v2`, VS-343) ships the shell, the rail and a header for every destination, but the roles
screen is still a placeholder. Roles is where a person reads the shape of a workspace's staff: which
roles are hired per project, how many workers each is running, and what each worker is doing right
now. VS-345 already shipped the shared compact worker feed; this ticket is the screen that embeds it
and proves the feed is reusable outside Needs you.

The design leaves out the role management V1 has (pause/resume/retire, charter revisions with
rollback, max workers, the "awaiting hire approval" state, Start session). Captain's decision keeps
all of it, restyled to V2, on the existing `routes/roles.ts` endpoints.

Hiring is a chat request, not a new endpoint. Captain's decision: the Hire a role modal formats a
message — `/hire-role project=<slug>` followed by the description — and posts it to the workspace
weaver's chat thread as an ordinary message. The weaver skill gains a short rule recognising that
format so the weaver treats it as a hire request for that project and still drafts the role and
charter for human approval. No command parser, no endpoint.

## What Changes

- **V2 Roles at `/v2/w/$ws/roles`**, grouped by project. Each role shows its state (including
  `pending_activation` as "awaiting hire approval"), its live worker count against its cap, its
  charter summary, and its running workers.
- **Clicking a working worker expands its live feed in place**, reusing VS-345's
  `v2/WorkerFeed` compact variant, headed by the worker's model and ticket title and footed by its
  spend and an "Open in Live" link. A worker with no live session keeps the old behaviour and opens
  the worker page.
- **The Hire a role modal**: a project picker, a free-text field for what the role should own, a
  live preview of the exact message the weaver receives, and a footer stating the charter comes back
  for approval. Send posts the built message to the workspace weaver's chat thread through the
  existing thread-message endpoint (`usePostThreadMessage`) — the preview and the sent body are the
  same string.
- **The kept management actions**, in an overflow menu and a charter drawer: pause, resume, retire,
  charter edit with revision history and rollback, max workers, and Start session — all through the
  existing roles and workers hooks.
- **The weaver skill rule** for the `/hire-role project=<slug>` format in
  `skills/weave-ai-hire/SKILL.md`, plus the hiring line in `templates/weaver.AGENTS.md.tmpl` so a
  weaver recognises the request when it arrives.
- **Frontend only plus agent-facing prose.** No daemon, HTTP route, MCP tool, migration or config
  change; V1 at `/` is untouched.

## Capabilities

### New Capabilities

- `web-v2/roles`: the V2 Roles screen at `/v2/w/$ws/roles` — grouping roles by project, each role's
  state and worker count, the in-place expansion of a working worker's shared feed, the Hire a role
  modal and its preview-equals-sent message, and the kept management actions.
- `role-management/hire-request-format`: the `/hire-role project=<slug>` chat-message format, the
  weaver skill recognising it as a hire request for that project, and the charter still returning to
  the human for approval.

### Modified Capabilities

_None. V2 is additive; VS-343's shell and VS-345's feed keep their behaviour, and V1 is unchanged._

## Impact

- **New:** `packages/ui/src/v2/RolesPage.tsx` (with its role card, worker row/feed, hire modal and
  charter drawer sub-components) and the small pure helpers it needs. New UI tests under
  `packages/ui/src/test/`.
- **Modified:** `packages/ui/src/v2/pages.tsx` (`V2RolesPage` becomes the real screen, re-exported
  from its own module as `V2NeedsPage` is); `skills/weave-ai-hire/SKILL.md` and
  `templates/weaver.AGENTS.md.tmpl` (the format rule).
- **Reused, not forked:** `v2/WorkerFeed` (VS-345); `api/hooks` (`useRoles`, `useRole`,
  `useRoleAction`, `useUpdateRole`, `usePutCharter`, `useRollbackCharter`, `useStartSession`,
  `useWorkers`, `useProjects`, `useTickets`, `useThreads`, `useCreateThread`, `usePostThreadMessage`,
  `useWeaver`); `api/context` `useWs`; shared `agentUiStatus`, `projectLabel`.
- No HTTP route, MCP tool, CLI command, database migration or daemon change.
