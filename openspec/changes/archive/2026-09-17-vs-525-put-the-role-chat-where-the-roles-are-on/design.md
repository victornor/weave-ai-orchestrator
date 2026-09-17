## Context

See `proposal.md` — Why. The relevant current state:

- VS-495 added `kind='session'` agents with a lazy open-or-resume endpoint, `POST /workers/persistent-session` (`packages/core/src/workers/index.ts` → `ensureSession`), and one UI door: a `Chat` text link inside `RoleCard` in `packages/ui/src/v2/RolesPage.tsx` that calls `usePersistentSession()` and navigates to `/w/$ws/workers/$workerId`.
- `WorkersService.list` hardcodes `kind = 'worker'` (`packages/core/src/workers/index.ts:247`), so no existing read returns `session`-kind agents. The roles detail route's `workers` bundle and the presenter's worker list are the same worker-only query.
- The V2 project overview composes ordered sections from `V2_PROJECT_SECTIONS` in `packages/ui/src/v2/project/sections.tsx`; Roadmap is the third entry. A new section is a new entry plus a body component that reads its own data (`reserved-sections` requires content to be supplied separately from presentation).
- `ensureSession` does not check the role's status, and the dispatcher includes `kind='session'` regardless of its role's status (`runs/dispatcher.ts` candidate query's role-active guard is `kind='worker'`-scoped). So a paused role's session, if opened, does run. The product decision here is nevertheless not to *offer* it.

## Goals / Non-Goals

**Goals:**
- One project-overview section, below Roadmap, that lists the project's roles and opens each one's persistent session through the existing open-or-resume call.
- Know before activation whether a session already exists, and show it.
- One shared control and one wording used by both the overview and the Roles screen.
- A read that exposes `session`-kind agents without disturbing the many worker-only callers.

**Non-Goals:**
- No change to `ensureSession`, the session lifecycle, the dispatcher, or role status semantics. The "cannot serve" gate is a UI gate, not a new server rule (see Decisions).
- No second session-opening call, hook or endpoint; the overview reuses `usePersistentSession`.
- No new page or route; the roles screen and the project overview are the two surfaces.
- No redesign of `RoleCard`'s worker feed, charter drawer, or management menu.

## Decisions

### Existence is read from a `kind` filter on the existing workers list

Options considered:
1. A dedicated `GET /sessions` or `GET /workers/sessions` route. Explicit, but a new route, a new hook, new docs, and a duplicate of the list route's per-row joins.
2. Enriching `GET /roles` with a per-role session summary. Keeps one request per page, but changes a documented route's response shape and the `Role[]` type every `useRoles` caller relies on.
3. **Add an optional `kind` filter to `GET /workers` and to `WorkersService.list`.** Chosen. It matches the route's existing filters (`status`, `project`, `role`, `includeRetired`), reuses the whole `WorkerListItem` plumbing and the `useWorkers` hook, and defaults to `['worker']` so every current caller (presenter, roles detail, the weaver's worker tool) is byte-for-byte unchanged. The new read is `useSessions(projectId)` → `GET /workers?kind=session&project=…`.

### One shared control, not two implementations

A new module exports the control and its pure helpers; `RoleChatsSection` (overview) and `RoleCard` (Roles screen) both render it. The control owns the `usePersistentSession` mutation and the `useGo` navigation, taking the role and its session (or `null`) as props; the pages own the reads. This is what keeps the two surfaces' wording and gating identical instead of drifting.

Labels: **"Open chat"** when the session exists, **"Start chat"** when it does not; a line above the control reads "Conversation ready" or "No conversation yet — opening starts one". The overview section is labelled **"Roles"**. This replaces the Roles screen's bare `Chat`, which captain read as meaning nothing next to `Charter` and `Start session`; `Start session` (the ticket-bound interactive session) is left untouched.

### Non-active roles: a UI gate, not a server change

The spec says a role that cannot serve a session must not offer one. In the current server, a paused role's session is still dispatched, and `ensureSession` will create one for a paused role. Making `ensureSession` reject non-active roles would change existing behaviour beyond this ticket's UI ask and could break a path that works today. Instead the control is withheld in the UI for any role whose status is not `active`, with the reason per status (paused → resume to chat; retired → this role can no longer chat; awaiting hire approval → named as such). If the server should also refuse, that is a separate decision and a separate change.

### Pure helpers for the states

`roleChatActionLabel(hasSession)`, `roleChatStateLabel(hasSession)` and `roleChatBlockedReason(role)` are exported pure functions (the pattern `RolesPage.tsx` already uses for `roleStateLabel`/`liveWorkersOf`), so the start/open and blocked states are unit-testable without a browser.

### Rendered evidence

Acceptance requires light and dark at desktop and phone width. The `ui-screenshot-harness` route is used to render the overview with seeded roles and sessions in four captures (light/dark × desktop/phone); the files are written outside the worktree (which must end `git status --porcelain`-clean) and their absolute paths reported on the ticket. Automated tests assert the behaviour; the captures are the visual evidence.

## Risks / Trade-offs

- **[Risk]** Widening a broadly used list route could leak `session` rows where a caller expected only workers. → Mitigation: the filter defaults to `['worker']`; only the new `useSessions` opt-in passes `kind=session`, and a core test asserts the default still excludes sessions.
- **[Risk]** "Start chat" beside "Start session" on the Roles screen is still two starts. → Mitigation: the session control carries an existence line ("Conversation ready" / "No conversation yet") and the persistent-session-vs-ticket distinction is what the ticket asks to preserve; the ticket-bound control is left as-is rather than renamed in this change.
- **[Risk]** A session can exist while the role is not active, and the UI hides it, so a working conversation becomes temporarily unreachable from the overview and the Roles screen. → Accepted: this is what the ticket asks for; resuming the role restores the control, and no data is lost.
- **[Trade-off]** The overview's role list and the Roles screen issue separate session reads. → Accepted: both are cached by the same query key family and the alternative (enriching `GET /roles`) is the bigger contract change.

## Migration Plan

Additive and safe to roll back by revert. No schema, no data migration. The new query parameter defaults to today's behaviour, and the new section is absent until the UI ships. No feature flag.
