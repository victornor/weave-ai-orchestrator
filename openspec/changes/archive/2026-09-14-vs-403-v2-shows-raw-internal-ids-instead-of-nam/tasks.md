# Tasks — VS-403

## 1. Expose the workspace's internal id

- [x] 1.1 `GET /api/workspaces` sends `internalId` (`w.ctx.workspaceId`) beside the slug it sends as `id`.
- [x] 1.2 `WorkspaceListItem` carries `internalId`; `docs/API.md` records the field.

## 2. Needs you resolves the asking agent

- [x] 2.1 `V2DecisionCard` takes the resolved asker name and its meta line never joins a raw id
      (neutral fallback: the weaver, else "an agent").
- [x] 2.2 `NeedsYouPage` resolves `askedByAgentId` to the agent's name from the workspaces' workers
      and weavers.
- [x] 2.3 `NeedsYouPage`'s scope filter normalises the decision's internal id to the slug before
      comparing, so the workspace-scoped screen is not empty.

## 3. Incidents resolves the workspace

- [x] 3.1 `IncidentsPage` matches an incident's `workspaceId` against `internalId` or `id` and shows
      the name, with a neutral fallback (never the ULID).

## 4. Sweep the remaining raw-id fallbacks

- [x] 4.1 `ChatPage`'s decisions pane and inline cards resolve the asker name.
- [x] 4.2 The Runs list and Run detail agent name fall back to a neutral label, resolving the weaver too.
- [x] 4.3 Scheduled's project label falls back to a neutral label instead of the project id.

## 5. Tests

- [x] 5.1 A Needs you card with a known asker shows its name; an unknown asker shows a neutral label, never the id.
- [x] 5.2 An incident whose run-token id differs from the workspace slug shows the workspace name.
- [x] 5.3 The swept call sites are covered (Chat card, Runs list, Run detail, Scheduled).

## 6. Verify

- [x] 6.1 `pnpm lint`, `pnpm typecheck` green.
- [x] 6.2 Both suites run and pasted verbatim.
- [x] 6.3 Rendered check on a scratch daemon: Needs you with a held merge card, Incidents with an
      incident, dark and light.
