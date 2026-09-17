## 1. Core: global incident reads and the resolving workspace

- [x] 1.1 Add `packages/db/src/migrations/0051_incident_resolved_workspace.sql` — one nullable column
  `resolved_by_workspace_id TEXT` on `incidents`, with a comment saying it is the workspace a
  resolution was performed from (VS-499) and that it is null for pre-existing resolutions; add
  `resolvedByWorkspaceId: string | null` to `Incident` in `packages/shared/src/types.ts`; verify
  `packages/db/src/migrations.test.ts` still applies every migration and the column exists on a fresh
  database, and that `packages/shared/src/enums.test.ts` typechecks.
- [x] 1.2 In `packages/core/src/incidents/index.ts`: make `list`'s `workspaceId` an exact
  `workspace_id = ?` filter (drop the `OR workspace_id IS NULL` clause) and re-document it as the
  deliberate narrowing filter; remove `IncidentGetScope` and the `scope?` parameter from `get` and
  `resolve`; add `resolvedByWorkspaceId?: string | null` to `IncidentResolveInput` and persist
  `input.resolvedByWorkspaceId ?? null` on resolve. Do not change `since`, `status`, `reporterKind`
  or the ordering.
- [x] 1.3 Update `packages/core/src/incidents/incidents.test.ts` to the new contracts: unscoped
  `get`/`resolve` reach any workspace's row (no `forbidden`); `list({ workspaceId })` returns exactly
  that workspace's rows and excludes both another workspace's and workspace-less rows; unscoped
  `list()` remains every row; resolve stores and round-trips `resolvedByWorkspaceId`; an unknown id
  is still `not_found`; the existing `since`, same-millisecond and status-filter tests pass unchanged.

## 2. Server: global tools, workspace names, resolving-workspace record

- [x] 2.1 In `packages/server/src/tools.ts`: add an optional `workspaces` map to `ToolCtx` and a
  small `workspaceName(ctx, id)` helper returning the loaded workspace's configured name or null;
  change `weave_incident_list` to stop passing `ctx.claims.workspaceId` as a scope, add an optional
  `workspaceId` input passed to the service, and decorate both list items and the `weave_incident_get`
  and `weave_incident_resolve` results with `workspaceName` (and `resolvedByWorkspaceName` from
  `resolvedByWorkspaceId`); make `weave_incident_resolve` pass
  `resolvedByWorkspaceId: ctx.claims.workspaceId`. Rewrite the three tools' descriptions to say the
  read spans every workspace, that `workspaceId` narrows, and that the incident may come from any
  workspace.
- [x] 2.2 Populate the new context field at both tool front doors: `packages/server/src/mcp.ts` and
  `packages/server/src/routes/agent.ts` pass `workspaces: deps.workspaces` when building `ToolCtx`.
- [x] 2.3 Verify with `pnpm vitest run packages/server/test/mcp.test.ts packages/server/test/inspect.test.ts packages/server/test/planTools.test.ts packages/server/test/plugins.test.ts`
  that the tool registry and the other ToolCtx-building tests are unaffected; a ToolCtx without the
  new field must still work (the helper returns null), so no other test helper needs editing.

## 3. Server tests: the cross-workspace contract and the incidents-only guard

- [x] 3.1 In `packages/server/test/incidents.test.ts`, rewrite the VS-222 scoping tests to the new
  contract: a conductor's `weave_incident_list` with no `workspaceId` includes a row filed from
  another workspace and exposes it via `weave_incident_get` and `weave_incident_resolve` (no
  `forbidden`); the existing "never another workspace" assertions are inverted, not deleted; a
  `workspaceId` filter narrows to exactly that workspace; a worker is still `forbidden` on all three.
- [x] 3.2 Add a two-workspace end-to-end test (the `packages/server/test/plannerScoping.test.ts`
  pattern: two `makeHarness()` workspaces with real dbs plus one daemon-level incidents db, both
  runtimes in `deps.workspaces`) that files an incident in workspace A and, from a weaver run token of
  workspace B, asserts: the incident is listed and read with `workspaceName` naming A; resolving it
  records `resolvedByWorkspaceId` as B while `workspaceId` stays A; and — the incidents-only guard —
  a ticket and knowledge belonging only to A are not reachable from B. State in the test comment that
  ticket/knowledge isolation is structural (separate workspace dbs) and this proves it was not
  disturbed.
- [x] 3.3 Update the incident fixture in `packages/ui/src/test/v2incidents.test.tsx` with
  `resolvedByWorkspaceId: null`, and verify the existing page tests (filter, workspace-name
  resolution, pulsing dot, expansion, no controls) pass unchanged — the page itself does not change.

## 4. Docs

- [x] 4.1 Update `docs/API.md`: add `resolvedByWorkspaceId` to the `Incident` shape in the
  `GET /api/incidents` line; in the MCP section, replace the "scoped to the caller's workspace" and
  "forbidden for another workspace" wording for `weave_incident_list`/`_get`/`_resolve` with the
  global-plus-`workspaceId`-narrowing behaviour and the resolving-workspace record.
- [x] 4.2 Update `docs/PLAN.md` §9.2's `weave_incident_list`/`weave_incident_get`/`weave_incident_resolve`
  entry (the line starting `- \`weave_incident_list(...)\``) to the new global behaviour, and add a
  §23 decision-log entry dated 2026-09-17 recording captain's "incidents are global" instruction, the
  unconditional (not gated) choice, and that multi-tenant isolation is out of scope.
- [x] 4.3 Update the `## Purpose` of `openspec/specs/incidents/conductor-read/spec.md` so it no longer
  says the capability is scoped to its own workspace — `openspec archive` preserves an existing
  capability's Purpose, so this direct edit in the same change is the documented way to change it.
  Leave `incidents/resolution`'s Purpose as it is (still accurate).

## 5. Green

- [x] 5.1 Run `pnpm lint`, `pnpm typecheck` and `pnpm test` from the repo root; paste both suite
  blocks (core/server and UI) verbatim in the report and confirm all three are green.
