# Design — V2 title legibility and the global run detail

See `proposal.md` for the problem. This covers how both halves are fixed and how they are verified.

## Context

- V2 is a parallel frontend at `/v2` on the same daemon; V1 stays at `/` and must not change (VS-367
  rules it, and this change repeats it).
- `V2Root` puts `data-theme` on `.v2-root` (not `<html>`), and `v2.css` declares the Mono tokens
  under `.v2-root` with a light block under `.v2-root[data-theme='light']`.
- `index.css` maps those tokens into Tailwind through `@theme { --color-text-1: var(--text-1), … }`.
  A non-inline `@theme` bakes each `--color-*` at `:root`; the utility class reads the baked result,
  so `.v2-root`'s own `--text-*` never reaches it. This is the mechanism VS-367 confirmed.
- V2's global routes (`needs`, `live`, `runs`, `map`, `incidents`, `scheduled`, `chats`) sit under
  `v2ShellRoute`, which has no `WorkspaceProvider`; `v2WsRoute` is what provides one. Runs is
  explicitly cross-workspace (HANDOFF §12).
- The runs API is per-workspace (`/api/w/:ws/runs/…`); there is no run-by-id lookup outside a
  workspace. `useRun` therefore calls `useWs()`, which throws on the global route.
- The design reference for the desktop run detail is the `12-run-detail.png` capture (reference set
  outside the repo; see the rendered check below). `RunPage` already matches it — the crash is the
  only defect.

## Goals / Non-Goals

**Goals**

- Every V2 primary title legible in both themes, with V1 unchanged.
- The global run detail render for a run in any workspace, on a click and on a bare URL.
- Cover both with tests and a real-browser render.

**Non-Goals**

- Re-styling screens per component.
- A general "global lookup" API for other entities; only runs needs one here.
- V1 behaviour, and any V2 visual mismatch that is not these two defects.

## Decisions

### D1 — Fix the title at the mapping, conditional on VS-367

The root cause is the non-inline `@theme` mapping; VS-367/#317 changes it to `@theme inline` and is
in merge. This change **rebases on main after #317 lands** and rebuilds. If the five title surfaces
are legible, that is the fix and no per-component code changes. If a surface is still dim, the real
cause is something else and is fixed at its source (a token value, a scoped override, or another
element-level resolution), never per screen.

- Alternative rejected: overriding `--color-*` inside `.v2-root`. It re-bakes at `.v2-root` but
  leaves the same fragile indirection and duplicates the mapping.
- Alternative rejected: changing each component to a hand-written class. Per-screen, and it hides the
  shared cause.

### D2 — The run detail resolves the run's workspace through a daemon route

Add `GET /api/runs/{id}` at the daemon level. It searches the loaded workspaces for the run (via each
`WorkspaceRuntime.services.runs.get`) and returns the first match — the same bare `Run` JSON the
per-workspace route returns, which already carries `workspaceId`. The UI gains a global run query
(`api.root('/runs/' + id)`), and `RunBody` uses the resolved `run.workspaceId` for the event stream
(`useRunEventStream(runId, { ws })`) and the worker-name lookup (`useWorkersMany([ws])`). The
per-workspace `useRun` stays for anything that still needs it.

Rejected alternatives:

- **Pass the workspace in the URL (`?ws=`) from the Runs list.** Works on a click, breaks on a
  refresh or a shared link — the route spec and the acceptance both want the bare URL to work.
- **Fan out `useWorkspaces()` + `useRunsMany(ids)` and search for the id.** Only finds runs inside the
  first page of each workspace, so an older run becomes "not found"; a page walk is unbounded and
  duplicates the list query.
- **Wrap the route in the first/remembered workspace.** Rejected by the ticket and wrong: it would
  fetch `.../runs/{id}` under the wrong workspace and 404.

The route is a small, additive read, authorized the same way as every session route (all workspaces
belong to one operator); it adds no new trust boundary.

### D3 — Verification is a real-browser render on a scratch daemon

The title defect is a computed-CSS resolution bug, and jsdom does not resolve custom properties
(established by VS-367 and the `web-v2` testing notes). So the rendered check is a real Chromium
render against a scratch daemon with two seeded workspaces, at desktop width, in dark and light, for
Needs you, Ticket, Roles and Run detail — the four screens the acceptance names. Captures go outside
the worktree; the comparison is listed screen by screen in the report. If the reference set
(`docs/design/v2/shots/`, or the copy VS-354 names) is not reachable, the report says which comparison
was possible and which was not.

## Risks / Trade-offs

- **VS-367 may not have landed when apply starts.** → Rebase first; if `main` does not yet contain
  `@theme inline`, re-fetch the #317 branch and base on it, and say so in the PR. The run-detail half
  is independent and can land regardless.
- **A global run query duplicates the per-workspace one.** → Keep it narrow: one read by id, used only
  by the global detail; the list keeps fanning out.
- **The global route iterates workspaces.** → Bounded by the number of loaded workspaces (a handful),
  one indexed primary-key read each, and only on a run-detail load.
- **A title fix sourced from #317 makes this change's theme delta "already fixed".** → The spec still
  records the contract the ticket is responsible for, and the task list verifies it rather than
  assuming it.
- **Reference captures are not committed in the repo** (only `docs/design/v2/shots/a.png`). → Use the
  design set VS-354 recorded on the host; if it is gone, report the gap instead of claiming a
  comparison.

## Migration Plan

Additive only. The global route ships with the UI change; there is no data or config migration. V1 is
not touched.
