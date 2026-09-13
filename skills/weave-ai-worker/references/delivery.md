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
5. **For a `change` ticket, or a `task` ticket carrying an OpenSpec change:** `openspec validate <change> --strict`. Rebasing pulls in every spec change archived since you were proposed — including one that touched the same requirement yours does — and this is the same check the daemon's post-merge archive will otherwise fail on, silently, after you have already merged (VS-208). Treat a failure the same as a rebase conflict: bring your MODIFIED block up to date with what is now on the base rather than merging past it, re-validate, then continue. Do not run `openspec archive` yourself either way.
6. `git push --force-with-lease` (only ever your own ticket branch).
7. Wait for CI when the project requires it. If CI goes red after the rebase, fix it here — that is still your job.
8. `GH_TOKEN="$(gh auth token)" gh pr merge <n> --<mergeMethod>` (your brief names the method; default `squash`).
9. `weave_ticket_merge_done(id, {mergeCommit: "<sha>", method: "<mergeMethod>"})`. The daemon verifies that the default branch carries your branch's content — a merge commit, identical trees, a squash of however many commits, or every commit picked individually all count — before accepting.
10. Stop there. The daemon fast-forwards the primary clone, archives the OpenSpec change, removes your worktree, retires you, moves the ticket to `done` — and admits the next ticket in the project's merge queue.

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
- `git reset --hard`, `git clean -fd`, or `git stash` to get out of trouble — you may be deleting the only copy of the work. If the worktree is in a state you cannot reason about, report `blocked`.
- Delete your branch or your worktree. The daemon removes it only after it has proven the work landed.
- Merge someone else's PR, or touch a branch that is not yours.
