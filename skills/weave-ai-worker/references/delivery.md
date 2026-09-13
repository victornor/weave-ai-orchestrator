# Delivery and merge

Your project has one `deliveryMode`. Your brief names it. Do not switch modes on your own.

## Nothing to land? (task tickets)

If your ticket is a `task` and you produced no commits, there is nothing to deliver: state the ending and why in the transition note and finish at `done` — no push, no PR, no merge approval.

```
weave_ticket_transition(id, "done", {note: "ending: done — <what you did and why nothing needs landing>"})
```

A rejection here is information, not an obstacle: `worktree_not_landed` means your branch carries commits the landing branch does not contain — you produced a diff, so deliver through the mode below. `validation` means the note is missing. `change`, `scout` and `question` tickets never take this route.

## Mode `pr` (default)

1. Work on your ticket branch inside `work/`. Commit as you go, one commit per task or logical group.
2. Run the project's tests and lint (see `work/AGENTS.md`). Green before you deliver.
3. Push the branch: `git push -u origin <your branch>`.
4. Open the PR: `GH_TOKEN="$(gh auth token)" gh pr create --base <default branch> --head <your branch> --title "<ticket id>: <title>" --body-file <file>`.
   The body states what changed, how it was verified, and links the ticket: `[ACME-42](weave://tickets/ACME-42)`.
5. Record it: `weave_ticket_work_product(id, {type: "pull_request", url: "<PR url>", title: "<title>", state: "open"})`.
6. `weave_ticket_transition(id, "in_review")` and `weave_report({state: "working", note: "PR open, awaiting review"})`.
7. Stop. A `merge_approval` decision now belongs to the human. You will be woken when the ticket moves to `merging`.

## Mode `local-branch`

Same, without a remote: no push, no PR. Record `{type: "branch", title: "<branch>", state: "ready"}` and transition to `in_review`. On approval you merge into the local default branch through the daemon.

## The merge procedure — only when the ticket is in `merging`

`merging` is reachable only through the human's approval or the ticket's auto-merge flag. `weave_ticket_merge_done` is rejected from any other status. Never merge because CI is green, because the PR looks approved on the forge, or because the weaver asked you to.

**The wake means you hold the project's merge slot.** Approved merges land one at a time per project: your ticket sat in the merge queue and has now reached the front, so the turn that starts with a `merge_approved` wake is the turn you merge in. Two consequences:

- **Your base moved while you waited.** Whatever `main` looked like when the human approved, it is not that now. Always fetch and re-sync before anything else; never assume an earlier rebase still holds.
- **Everyone else is waiting on you.** Do the merge, do not start unrelated work in the slot, and if it cannot complete, transition to `blocked` promptly — that releases the slot and the next ticket starts.

While a ticket is waiting rather than merging, its turn prompt says so and gives its position; there is nothing to do then but end the turn.

1. `weave_worktree_status()` — confirm the branch and how far behind you are.
2. `git fetch origin`.
3. Sync: `git rebase origin/<default>` (or merge it in, if that is the project's convention — check `work/AGENTS.md`).
4. **Resolve conflicts yourself.** Then re-run the full test and lint suite. If a resolution changes behavior the spec described, `weave_ask` before continuing, and end the turn.
5. **For a `change` ticket, or a `task` ticket carrying an OpenSpec change:** `openspec validate <change> --strict` as your own early check. Rebasing pulls in every spec change archived since you were proposed — including one that touched the same requirement yours does — and a collision here is the same thing archiving itself will refuse later, just caught sooner. Treat a failure the same as a rebase conflict: bring your MODIFIED block up to date with what is now on the base rather than merging past it, re-validate, then continue. **Do not run `openspec archive` yourself** — the daemon archives your change onto your branch as part of landing it (next step), not you, and not after a merge that already happened.
6. `git push --force-with-lease` (only ever your own ticket branch).
7. Wait for CI when the project requires it. If CI goes red after the rebase, fix it here — that is still your job.
8. `weave_ticket_merge_done(id, {})` — this **requests landing**, it does not report one you already performed. You do not run `gh pr merge` yourself for a `pr`-delivery project: the daemon archives your ticket's OpenSpec change onto your branch first (if it has one), then merges with the project's configured method. `mergeCommit`/`method` are only worth passing if you have independent reason to believe the PR was already merged out of band; otherwise omit them.
9. Stop there. On success the daemon has already archived, merged, verified, fast-forwarded the primary clone, removed your worktree, retired you, moved the ticket to `done`, and admitted the next ticket in the project's merge queue — there is nothing further to do.

A rejection from step 8 means re-sync and request again, the same as any other rebase conflict, with one addition: the daemon may have already rebased and pushed your branch remotely while attempting to land it (to bring it up to date, or with your archived change added). **Re-fetch and reset your local branch to the remote tip before touching anything** — `git fetch origin && git reset --hard origin/<your branch>` — rather than trying to resolve against your own stale local copy, which `--force-with-lease` would refuse to overwrite anyway. Then:
- A real conflict — resync against the current default branch (step 3) and resolve it, same as before.
- An archive failure — read the detail, fix your own change (same as a `proposed`-gate rejection), and request landing again.
- Required checks failing on the archived branch — fix whatever they flagged and request landing again.
- Mere staleness (someone else landed while you waited) never reaches you as a rejection at all: the daemon re-syncs and archives against the current base itself and proceeds, with no action from you.

For `local-branch`: steps 1–5, then `weave_ticket_merge_done` — the daemon fast-forwards `projects/<id>`. If it is not fast-forwardable, rebase again first.

**If the merge cannot complete** — unresolvable conflict, CI red after real attempts, forge error — do not force it and do not abandon it silently:

```
weave_report({state: "blocked", note: "<what failed, with the evidence>"})
weave_ticket_transition(id, "blocked", {unblock: {owner: "weaver", action: "<exactly what is needed>"}})
```

Then end the turn.

## Never

- Push to the default branch by any path other than merging an approved PR.
- Force-push anything but your own ticket branch, or force-push without `--force-with-lease`.
- `git reset --hard`, `git clean -fd`, or `git stash` to get out of trouble — you may be deleting the only copy of the work. If the worktree is in a state you cannot reason about, report `blocked`. The one exception is the specific `git reset --hard origin/<your branch>` a landing rejection may call for above: you are resetting to a remote tip the daemon itself just pushed, not discarding anything that only exists locally.
- Delete your branch or your worktree. The daemon removes it only after it has proven the work landed.
- Merge someone else's PR, or touch a branch that is not yours.
