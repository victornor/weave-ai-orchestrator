## 1. Schema

- [x] 1.1 Add a migration creating `agent_handovers` (id, agent_id FK, ticket_id, runtime_id,
  session_ref_json snapshot, worktree_head snapshot, worktree_branch snapshot, started_at,
  started_by, status CHECK IN ('active','returned','abandoned'), returned_at, note,
  reconciliation_json, last_activity_signal, last_activity_at, created_at, updated_at) with an index
  on (agent_id, status); verify `pnpm --filter @agent-conductor/db test` (or the project's migration
  test runner) passes and the new table appears in a fresh-db bootstrap.
- [x] 1.2 Add the new pause-detail code (parallel to `LOGIN_PAUSE_CODE`) and two new supervisor config
  defaults to `packages/shared`: `handoverAbandonTimeoutMinutes` (120) and `handoverQuietMinutes`
  (30, must be validated smaller than the abandon timeout). Verify `pnpm typecheck` passes and
  existing config-default tests still pass with both new keys present.

## 2. Command construction

- [x] 2.1 For each runtime adapter, confirm (via its existing `args.ts`) whether the interactive
  resume argv is already cleanly reachable without headless-only flags (`-p`/`--output-format` or
  equivalent); where it is not, extract the minimal existing distinction into a callable form — no
  new adapter behavior, only exposing what the code already branches on. Verify with a unit test per
  adapter asserting the interactive argv contains the resume flag/verb and stored session ref, and
  omits the headless-only flags.
  Done as: `buildArgs` has no interactive toggle at all in any of the 5 adapters (every one always
  bakes in its headless form) — not a case of "not cleanly reachable", but a fundamentally different
  invocation. Added a new sibling `resumeCommand(input)` per adapter (`args.ts`), wired onto the
  `RuntimeAdapter` interface as an optional method, reusing the same session-ref parsing
  (`asClaudeSession` etc.) and the same config-dir-env-var/worktree-inclusion-flag facts `buildArgs`
  already encodes, so the two cannot drift on those facts even though they build different argv.
  Claude/Cursor/Gemini reuse `--resume <id>` as-is (high confidence: the same flag already used
  headless). Codex's `resume <id>` and OpenCode's `-s <id>` are the interactive form of what is a
  *subcommand*-shaped resume headless, not a flag — these could not be confirmed against the real
  CLI (forbidden from a ticket) and are flagged in code comments as best-effort, unverified.
- [x] 2.2 Implement a runtime-agnostic command builder that, given an agent's `homePath`,
  `worktreePath`, runtime id and stored session ref, calls the confirmed interactive `buildArgs` and
  `launchCommand` to produce `{resumable: true, command, runtime}` or `{resumable: false, reason}`
  (unresumable runtime capability, or no stored session). Verify with unit tests covering: a
  resumable runtime with a session, an unresumable runtime, and a resumable runtime with no session
  yet — using a fake CLI binary and a scratch config directory per the project's credential-safety
  rule, never the real runtime CLI.
- [x] 2.3 Verify the OpenCode case specifically: the built command pins
  `MISE_DATA_DIR`/`MISE_CONFIG_DIR`/`MISE_CACHE_DIR` back to the daemon's own roots (mirroring
  `pinHostMiseRoots`) alongside the `HOME`/`XDG_CONFIG_HOME`/`XDG_DATA_HOME` overlay, and that no
  other runtime's command includes the MISE pin. Verify with a unit test asserting the exact env keys
  present per runtime.
- [x] 2.4 Verify the command is a single line, quotes paths safely (a worktree path containing a
  space round-trips through a shell-quoting test), and sets overlay variables inline on the
  invocation rather than via a preceding `export`.
- [x] 2.5 Have the command builder also return a plain-language landing-directory line (the `cd`
  target vs. the worktree path, per `session-handover/command`'s "offered command states plainly
  where it lands" requirement) alongside `{resumable, command, runtime}`, so every surface that shows
  the command shows this line with it rather than each surface having to compute it separately.
  Verify with a unit test asserting the line names both paths when they differ.

## 3. Taking and holding a session

- [x] 3.1 Implement `WorkersService.startHandover(actor, workerId)`: refuse if a turn is currently
  executing for the agent or an `agent_handovers` row with `status='active'` already exists for it;
  otherwise snapshot worktree state (via `util/git.ts`'s `worktreeState`, not a second inline
  implementation) and the current session ref, insert the `agent_handovers` row, set
  `agents.status='paused'` with the new pause-detail code, and return the command from task 2.2 (or
  the stated reason). Verify with unit tests for: success, refusal while running, refusal while
  already held.
- [x] 3.2 Verify the dispatcher does not select a worker with an open handover for dispatch
  Discovered along the way: `wake.enqueue` itself skips (not queues) a wake sent to any `paused`
  agent, at an earlier gate than the dispatcher's own candidate query — so a held worker's exclusion
  from dispatch is doubly enforced. This also meant `endHandover` had to raise its own fresh wake on
  handback (mirroring `resume()`), since a message sent while held is skipped outright, never queued
  to fire once the hold ends.: add a
  test alongside the existing paused-agent dispatcher tests asserting a worker paused via
  `startHandover` is excluded from the candidate query (`session-handover/lease` — "Dispatch is
  withheld while a session is held").
- [x] 3.3 Add `POST /workers/:id/handover`
  Also added `GET /workers/:id/handover-command` (read-only) so a surface can offer the command
  before committing to a hold, matching AC1/AC6's framing of "offers" as distinct from "takes". (`packages/server`), returning the command or stated
  reason; add the `routetable.ts` entry and the `docs/API.md` entry. Verify with a route test
  covering success, refusal-while-running and refusal-while-held.
- [x] 3.4 Mirror the verb on `conductor worker handover <id>` (`packages/cli`), printing the command
  (or reason) to stdout for direct copy from the terminal. Verify with a CLI test asserting the
  printed output matches the API response.

## 4. Giving a session back

- [x] 4.1 Implement `WorkersService.endHandover(actor, workerId, {note})`: reject an empty/missing
  note without changing any state; otherwise recompute worktree state and the session-activity signal
  (reusing the same stat helper task 5.1 implements, against the snapshot — not a re-parse of session
  content), diff against the `agent_handovers` snapshot, write the diff and note onto the row as
  `status='returned'`, post a ticket comment with the reconciliation and the note, and set
  `agents.status='active'`. Verify with unit tests for: missing-note rejection, new-commits-detected,
  dirty-worktree-detected, nothing-changed, and the ticket comment's presence and content. (This task
  and task 5.1's signal helper are interdependent — implement the helper first, or alongside.)
- [x] 4.2 Add `POST /workers/:id/handback` (`packages/server`) requiring `note`; `routetable.ts` and
  `docs/API.md` entries. Verify with a route test covering the missing-note rejection and a
  successful handback.
- [x] 4.3 Mirror on `conductor worker handback <id> --note "..."` (`packages/cli`). Verify with a CLI
  test.
- [x] 4.4 Modify `WorkersService.resume` (or its call sites) to refuse plain resume for a worker with
  an open handover, per the `run-recovery/paused-worker-visibility` delta. Verify with a unit test:
  calling ordinary resume on a held worker is refused and the hold is unaffected.

## 5. Abandonment recovery

- [x] 5.1 Implement the cheap session-activity signal
  Done as: a shallow recursive scan of the runtime's whole `configHome` (max mtime found), not a
  stat of one named session file — no adapter/runtime exposes a specific session-file path today, and
  guessing one per runtime without verifying against the real CLI (forbidden) was too risky. Broader
  than the exact file, but only in the safe direction: a false "changed" defers closing a hold
  longer, never closes one still genuinely in use.: a stat (mtime and/or size, not a content
  parse) of the runtime's session-ref file, callable per adapter/session-ref shape. Verify with a
  unit test asserting the signal changes when the file is touched and is stable when it is not, using
  a scratch file — no real runtime CLI.
- [x] 5.2 Add a supervisor sweep (modeled on `retireIdleSessions()`, run every tick alongside it) that,
  for every `agent_handovers` row with `status='active'`: re-samples the activity signal; if it
  differs from the row's stored `last_activity_signal`, updates `last_activity_signal` and
  `last_activity_at` and takes no closing action this tick; otherwise, closes the hold only when BOTH
  `now - started_at >= handoverAbandonTimeoutMinutes` AND `now - last_activity_at >=
  handoverQuietMinutes` hold, calling the same reconciliation `endHandover` uses with
  `status='abandoned'` and the appropriate one of the two fixed system notes (never-active vs.
  activity-then-quiet, per the `session-handover/lease` spec). Verify with unit tests: (a) a stale,
  never-touched hold closes with the never-active note once past the abandon timeout; (b) a hold past
  the abandon timeout but with a signal change on the current tick is left open; (c) a hold whose
  signal stopped changing `handoverQuietMinutes` ago, itself past the abandon timeout, closes with the
  activity-then-quiet note naming the last-activity time; (d) a hold with continuous per-tick activity
  is never closed regardless of how long it has been open.
- [x] 5.3 Verify end-to-end that a worker with an abandoned, now-closed hold is dispatchable again
  with no manual data changes — a test that creates a hold, ages it past both thresholds with no
  activity, runs the sweep, and asserts the dispatcher's candidate query now selects that worker.

## 6. Surfacing the command

- [x] 6.1 Add a "take this session" action to the worker page/panel (`packages/ui`) that calls
  `startHandover` and shows the returned command with a copy affordance (reusing the existing
  fenced-code-block copy mechanism already in `Markdown.tsx` where practical), or the stated reason
  when not resumable. Verify by running the app and exercising a resumable and an unresumable worker
  (screenshot both states; note which was actually exercised against a real runtime resume vs. only
  the "no command" path, per the credential-safety rule — never invoke the real CLI from a ticket).
  Verified live: a throwaway Vite + headless-Chromium harness (per the `ui-screenshot-harness`
  knowledge doc, deleted before commit) rendered the real WorkerPage against a stubbed daemon API for
  resumable, unresumable and held scenarios — screenshots left uncommitted in
  `.review-screenshots-vs249/` in the worktree for the human. Only the "no command" (unresumable) and
  the command-display paths were exercised — no real runtime CLI was invoked, per the
  credential-safety rule; the pasted command's own correctness against a real CLI remains unverified
  and is called out in the final report.
- [x] 6.2 Add the same action to the decision card raised for a worker agent (`packages/ui`'s
  `DecisionCard.tsx`), resolving the worker from the decision's own agent reference; hidden entirely
  (no button, no reason text) for decisions not raised for a worker agent. Verify with a component
  test asserting the action appears only for worker-raised decisions and reflects resumable/
  unresumable state correctly.
- [x] 6.3 Add a handback form (worker page) that requires the note before submitting, showing the
  server's rejection if submitted empty, and rendering the reconciliation summary once accepted.
  Verify by exercising it in the running app against a fake held worker.
  Verified live with the same harness: a held worker shows "Give it back" (Resume/Session hidden,
  per the `run-recovery/paused-worker-visibility` delta), clicking it opens the required-note
  Composer form. Submit-button disabling on an empty note is Composer's own existing behavior
  (reused as-is, not reimplemented); covered directly by the component test asserting `endHandover`
  is called with the typed note. The server-side empty-note rejection is covered by
  `packages/core`'s `workers.test.ts` and the route test in `packages/server`, not re-verified in the
  browser.

## 7. Verification

- [x] 7.1 `pnpm lint` clean.
- [x] 7.2 `pnpm typecheck` clean (run the full chained command, not the ui filter alone, per this
  project's known phantom-error trap).
- [x] 7.3 `pnpm test` — both suites green: core/server 161 files (1 skipped) / 2365 tests (1 skipped);
  ui 89 files / 1480 tests. Both pasted verbatim in the ticket report.
- [x] 7.4 Confirmed against the ticket's acceptance criteria — see the ticket report.
