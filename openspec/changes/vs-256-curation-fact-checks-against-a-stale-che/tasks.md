## 1. The pre-turn freshness gate

- [x] 1.1 In `packages/core/src/runs/engine.ts`, add a new precondition block in `executeRun`,
  positioned the same way as the existing `model_unconfigured` block (lines 230-244): after `project`
  and `ticket` are loaded (line 195-196), before `ctx.db.update('runs', runId, { status: 'running',
  ... })` (line 246). When `ticket?.originKind === 'curation'` and `project` is non-null: call
  `await deps().projects.fetch(project.id)`, then re-read the project row and check
  `syncState === 'in_sync'`. Wrap the call in try/catch — a thrown fetch failure and a returned
  `syncState !== 'in_sync'` are both "not fresh," with a different message for each (design.md
  Decision 3 — this runs on every turn, first or not, so do not special-case `agent.turnCount === 0`).
  Verify with `pnpm typecheck`.
- [x] 1.2 On the not-fresh path: emit `run.started` + an `error` record exactly as the
  `model_unconfigured` block does (reuse its two `record(...)` calls verbatim in shape), then call
  `deps().tickets.transition({ kind: 'system', id: null }, ticket.id, { to: 'blocked', unblock: {
  owner: 'conductor', action: '<names the project slug and whether it was a fetch failure or a
  diverged clone>' } })` (design.md Decision 4), then `return finalize(ctx, deps, sessions, { run,
  agent, role, project, ticket, wakes, result: null, failure: { code: 'checkout_stale', family:
  'tooling', message: <the reason> }, report: null, durationMs: Date.now() - started, sessionId: null,
  cancelled: null, record })` — never reaching `phase('prepare_home', ...)` or spawning a runtime
  process. Wrap the `tickets.transition` call in its own try/catch (log a warning on failure, still
  finalize the run as failed) so a transition error cannot leave the run hanging.
- [x] 1.3 On the fresh path, fall through to the existing turn flow unchanged.
- [x] 1.4 Extend the `worktree` field of the `TurnInput` built at `engine.ts:340` (currently
  `agent.worktreePath ? { path: agent.worktreePath, branch: agent.branch ?? '' } : null`): when
  `agent.worktreePath` is null but `ticket?.originKind === 'curation'` and `project` is non-null, use
  `{ path: project.clonePath, branch: '' }` instead of `null`. This is what grants `--add-dir` to the
  just-verified clone for the two adapters that read it (`packages/runtimes/claude/src/args.ts:116`,
  `packages/runtimes/gemini/src/args.ts`).

## 2. The brief tells the curator where its checkout is

- [x] 2.1 In `packages/core/src/prompts/index.ts`, `workerData()`'s `worktree.path` (line 128) falls
  back to the literal string `'work/'` when `agent.worktreePath` is null. Change the fallback: when
  `t?.originKind === 'curation'` and `p` is non-null, use `p.clonePath`; otherwise keep the existing
  `'work/'` fallback for every other `noWorktree` ticket kind.
- [x] 2.2 Add a `verifiedFreshAt: string | null` field to the `worktree` object in
  `WorkerTemplateData` (line 96) and populate it in `workerData()`: `t?.originKind === 'curation' ?
  (p?.lastFetchedAt ?? null) : null`.
- [x] 2.3 In `templates/brief.md.tmpl`, the `{{#if brief.noWorktree}}` branch (around line 45) states
  "`work/` is a read-only checkout of the project's landing branch" with no path or timestamp. Replace
  that with the real path (`{{worktree.path}}`) and, when `{{worktree.verifiedFreshAt}}` is set, the
  moment it was last confirmed current against `origin/{{project.landingBranch}}`. Keep the existing
  "never write to it, never commit, never push" instruction and the "load `agent-conductor-knowledge`"
  pointer.
- [x] 2.4 Update `packages/core/src/prompts/render.test.ts`'s curation-shaped fixture (it already
  builds a `worktreePath: null` worker per the file's existing coverage — check for one before adding
  a new one) to assert the rendered brief contains the project's real clone path and, when
  `lastFetchedAt` is set on the fixture project, the verified-fresh statement.

## 3. What the curator does when one fact, not the whole checkout, can't be verified

- [x] 3.1 In `skills/agent-conductor-knowledge/references/curation.md`, step 6 ("Remove what is
  contradicted") gets an explicit converse: a claim the checkout does not positively confirm or refute
  — an ambiguous path, a script that may have moved — is left in place, not removed, and reported by
  name in the ticket comment (the same comment step 11 already asks for). State plainly that this is
  about a single unresolved claim, not about the checkout's overall freshness — the freshness gate
  (task 1) is what makes "the whole checkout might be stale" no longer something the worker needs to
  reason about at all.

## 4. Tests — the VS-255 shape and the block path

- [x] 4.1 Add a case to `packages/core/src/runs/engine.test.ts`: seed a curation ticket
  (`originKind: 'curation'`) and its worker (`worktreePath: null`), give the project's primary clone a
  local commit behind a second commit pushed to its `origin` remote (mirroring VS-255's shape — behind,
  not diverged — a file present only in the newer commit), run `executeRun`, and assert: (a)
  `deps().projects.fetch` was effectively exercised — the clone's local `HEAD` now equals the pushed
  commit; (b) the turn actually ran (a real/fake runtime was invoked, not short-circuited); (c) the
  `TurnInput` the fake runtime received had `worktree.path` equal to `project.clonePath`, and that path
  on disk contains the file only the newer commit has.
- [x] 4.2 Add a case: the primary clone has a local commit `origin/<landing>` does not contain (cannot
  fast-forward). Run `executeRun` and assert: no runtime process/adapter call was made; the run
  finalizes as `failed` with `errorCode: 'checkout_stale'`; the ticket is `blocked` with
  `unblock.owner === 'conductor'` and an `action` mentioning the project.
- [x] 4.3 Add a case for a fetch failure (point the project's `gitUrl`/remote at something that cannot
  be fetched, or stub `deps().projects.fetch` to reject) and assert the same three outcomes as 4.2,
  with the `action` text distinguishing "could not fetch" from "diverged."
- [x] 4.4 Add a case: a curation ticket relaunched for a second turn, with the clone verified fresh on
  turn one but made to diverge before turn two — assert turn two is blocked exactly as 4.2, confirming
  the check is not cached from an earlier turn (design.md Decision 3).
- [x] 4.5 Add a case: an ordinary (non-curation) `noWorktree` ticket, if any exist in the fixtures
  (check `project_describe`-originated tickets, `workers/index.ts` around `originKind:
  'project_describe'`) — or a synthetic one — is never subject to this gate; its turn runs without a
  `projects.fetch` call being made on its behalf.

## 5. Verification

- [x] 5.1 `pnpm typecheck && pnpm lint && pnpm test` green. Post both suite blocks from `pnpm test`
  verbatim with their real totals.
- [x] 5.2 Re-read VS-256's acceptance criteria against the final diff and state in the PR description
  which task covers each of the six, including where the design says instruction is genuinely the only
  lever (task 3, for a single unresolved claim) versus where the guarantee is structural (tasks 1-2,
  for the checkout's overall freshness).
