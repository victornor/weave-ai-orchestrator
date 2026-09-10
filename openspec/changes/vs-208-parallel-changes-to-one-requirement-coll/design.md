# Design

## Why an ADDED capability, not a MODIFIED gap-fill

Archive-after-merge and the hourly reconciliation backfill are real, already-shipped daemon
behavior (`docs/PLAN.md` §12.2 step 7, §11.4's "hourly" reconciliation bullet), but no existing
capability under `openspec/specs/` documents them — `ticket-delivery/landing-verification` covers
only how a landed branch is recognised, `ticket-delivery/post-merge-background-work` covers
scheduled follow-up jobs (archive is not one; it runs synchronously inside `mergeDone`), and
`merge-queue` covers queue admission. Retroactively spec'ing all of archive-after-merge is out of
scope for this ticket; this change only adds the two requirements it actually changes behavior for
(failure surfacing, reconciliation scope), under a new capability that names the thing precisely
so a future change has somewhere to add to it.

## The two bugs, concretely

**`cli.archive()`'s empty error.** `openspec archive <name> --yes --json` on a scenario-dropping
MODIFIED block exits non-zero and writes nothing to stderr; the actual reason is a `status` array
on stdout:

```json
{
  "archive": null,
  "status": [{
    "severity": "error", "code": "archive_spec_update_failed",
    "message": "conductor-chat/turn-work-trace MODIFIED failed for header \"...\" - current spec
      contains scenario(s) not present in the modified block: ... Refresh the change spec before
      archiving to avoid dropping scenarios.",
    "fix": "Fix the change delta specs and rerun. No files were changed."
  }]
}
```
(captured directly against `vs-205-...` in this worktree, read-only — no files changed, confirmed
by the CLI's own "No files were changed" and a clean `git status` afterward.)

`archive()` currently calls `run()` without `allowFailure`, so a non-zero exit throws via
`failed()`, which formats only `stderr.trim().slice(0, 300)`. Fix: call `run` with `allowFailure:
true`, and on `!r.ok` pull the message(s) out of `firstArray(r.json, ['status', 'issues', 'items',
'results'])` the same way `validate()` already does, falling back to stderr/exit code only if that
array is empty. This is the same shape `validate()` already parses; no new parsing concept.

**`reconcileOpenSpecArchives`'s scope.** Its SQL is `... WHERE ... kind = 'change' AND status =
'done' AND openspec_change_name IS NOT NULL`. `openspec_change_name` is already the correct
membership test — a `scout`/`question` ticket never gets one, and a `task` ticket in an
OpenSpec-enabled project does (`skip_specs: true`, per `agent-conductor-openspec`). The `kind =
'change'` clause adds nothing but the exclusion that caused VS-30's residue. Fix: drop it.

## Why VS-30 needs no repair, and VS-205 needs no manual archive

VS-30's change directory (`skip_specs: true`, all tasks done) already validates clean today
(checked with `openspec validate vs-30-... --strict --json` in this worktree: `valid: true`). The
only reason it never archived is the query bug above. Once that lands and the next hourly sweep
runs, it archives on the first attempt — no hand-editing of `openspec/changes/vs-30-.../`.

VS-205, once its delta is repaired (this change does that, as a content-only edit — see
`tasks.md`), also just needs the next sweep: it was already inside `reconcileOpenSpecArchives`'s
`kind = 'change'` scope, so the query fix does not matter for it, only the delta repair and (so the
retry's failure would have been legible if it had failed again) the `cli.archive()` fix.

Neither is archived by this ticket. Per the standing rule, only the daemon runs `openspec archive`;
this change makes the daemon's existing, already-scheduled attempt succeed.

## Position: catching the collision before it lands, not just after

The earliest point this collision is actually visible is `openspec validate <change> --strict` run
against the *landing branch's current specs* — confirmed directly: running that command in this
worktree (based on current `main`, which already has VS-204 archived) reproduces the exact same
"omits scenario(s)" error `archive` produces, read-only, before touching anything. That is not a
new signal; it is the same check the `proposed` gate already runs, just run again later, against a
spec state that may have moved since the ticket was proposed.

The question is where to run it again. Two candidates:

1. **A daemon-side gate inside `mergeDone`.** Rejected as the *general* fix: for `pr` delivery mode
   (this project's mode), the worker already ran `gh pr merge` and the content is already on the
   landing branch by the time `mergeDone` runs — a daemon gate here can only refuse to archive
   after the fact, which is the failure mode this ticket is fixing, not a new one. It would only be
   effective for `local-branch` delivery, where the daemon performs the actual merge in
   `land.ts`'s `landDelivery`. Gating one delivery mode and not the other is inconsistent and not
   worth the asymmetry for a proportionate fix.
2. **A worker-side pre-merge check**, alongside the rebase-and-resolve-conflicts step
   `docs/PLAN.md` already documents ("resolves conflicts itself — re-running tests and lint..."
   before merging). After rebasing onto the landing branch and before running `gh pr merge` (or the
   local-branch equivalent), a worker for a `change` or OpenSpec-tracked `task` ticket runs
   `openspec validate <change> --strict` the same way it already does for the `proposed` gate. A
   failure here is the same shape as a rebase conflict: the worker fixes its delta against what
   actually landed since it was proposed, re-validates, then merges. This is enforced the same way
   tests and lint already are — worker discipline, not a hard daemon gate — which is consistent
   with how conflict resolution already works and adds no new trust boundary.

(2) is what this change makes: one added step in
`skills/agent-conductor-worker/references/delivery.md`'s merge procedure, immediately after the
rebase step, for `change` tickets and `task` tickets carrying an OpenSpec change. No code change,
no new daemon mechanism — proportionate to a failure mode that, so far, has happened twice.
