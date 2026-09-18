## Why

Twelve Weave AI incidents are still open (captain, 2026-09-18). Each is either a real control-plane or UI defect, already fixed by an earlier change without the incident being resolved, or obsolete. This change triages all twelve, fixes the real ones with a regression test, and resolves every incident with this ticket id (or a named follow-up), so none stays open without a reason.

## What Changes

- Triage each numbered incident: reproduce it from the incident evidence in a test, or show that current `main` already handles it. An incident that is already fixed or obsolete is not changed in code; the report cites the evidence.
- Fix the defects that still reproduce, each with a test that asserts the produced value rather than that a call happened:
  1. `weave_artifact_put` foreign-key failure.
  2. Codex MCP "approval policy is never" (verify VS-485 against the real args builder output; finish if a launch path still omits `on-request`).
  3. `weave_decision_answer` on a worker card with required inputs.
  4. Run recorded as interrupted / `no_report` after its deliverable landed.
  5. Running sha changes without a `daemon.upgraded` / `daemon.restarted` wake.
  6. `openspec` binary not found during daemon validation (PATH resolution).
  7. Claude worker self-wake (`ScheduleWakeup`) never producing a turn.
  8. Upgrade outcome `completed` while the old sha is still running.
  9. Worker options cannot be edited.
  10. Live view starving other browser tabs.
  11. `action_approval` re-raise loop.
  12. Worktree git committer identity unknown on rebase.
- Anything that cannot be reproduced or fixed inside the repo is reported unfixable with evidence, and its incident is resolved with this ticket id.

## Capabilities

### New Capabilities
- (none)

### Modified Capabilities
- `incidents`: an incident closed by a fix ticket carries that ticket id, and a fix ticket accounts for every incident it was given.

## Impact

`packages/server/src/tools.ts`, `packages/core` (artifacts, decisions, runs, upgrade, workers), `packages/runtimes/codex`, `packages/ui` (live view, worker options), and tests beside each. No live Claude/Codex CLI is run; runtime fixes are verified against fake binaries. Facts that need the real CLI or the real host are marked unverified in the PR.
