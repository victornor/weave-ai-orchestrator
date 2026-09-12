# Final report examples

One fenced ```json block, as the last thing in your message. Nothing after it.

Schema: `state` (required), `summary` (required, ≤ 4000 chars), `tickets[]` (`{id, status?, note?}`), `nextAction` (`{owner: self|conductor|human|none, what}`), `knowledge` (required — `{recorded:true, where}` or `{recorded:false, reason}`), `uncommittedWork`.

`knowledge` answers one question every turn: did this ticket produce durable knowledge, and where — or why not. "Nothing durable" is always a complete, legitimate answer; a report missing `knowledge`, or giving `recorded:true` with no `where`, or `recorded:false` with no `reason`, fails to parse and is treated as no report at all, the same as one missing `state`.

**working** — you made progress and will continue on your next wake.
```json
{"state":"working","summary":"Implemented tasks 1-3 of acme-42-dark-mode: theme tokens, the CSS variable layer, and the settings toggle. Tests green. Remaining: sweep the 14 components that still hardcode colors.","tickets":[{"id":"ACME-42","status":"in_progress","note":"3/7 tasks ticked"}],"nextAction":{"owner":"self","what":"Finish the component sweep, then open the PR"},"knowledge":{"recorded":false,"reason":"mid-task; nothing durable to record yet"},"uncommittedWork":false}
```

**needs_decision** — you called `weave_ask` and stopped.
```json
{"state":"needs_decision","summary":"The spec does not say whether dark mode follows the OS setting or is user-set only. Both are one day of work and they are not compatible. Asked with two options; recommended following the OS with a manual override.","tickets":[{"id":"ACME-42","status":"in_progress","note":"paused on decision D-7"}],"nextAction":{"owner":"human","what":"Answer D-7: OS-follow with override, or manual only"},"knowledge":{"recorded":false,"reason":"waiting on the decision; nothing durable yet"},"uncommittedWork":false}
```

**blocked** — you are stuck and someone else must move.
```json
{"state":"blocked","summary":"The design tokens live in the shared-ui repo, which I cannot see. Nothing further is possible here until they are published or vendored.","tickets":[{"id":"ACME-42","status":"blocked","note":"needs a courier ticket in shared-ui"}],"nextAction":{"owner":"conductor","what":"Create a ticket in shared-ui to publish the dark palette tokens"},"knowledge":{"recorded":false,"reason":"blocked before any durable finding"},"uncommittedWork":true}
```

**paused** — a known external wait that clears itself.
```json
{"state":"paused","summary":"PR #212 is open and CI is running. Nothing to do until it finishes.","tickets":[{"id":"ACME-42","status":"in_review","note":"PR #212, CI running"}],"nextAction":{"owner":"none","what":"Wait for CI, then the human's merge approval"},"knowledge":{"recorded":false,"reason":"waiting on CI; nothing new to record"},"uncommittedWork":false}
```

**done** — the phase or the ticket is finished.
```json
{"state":"done","summary":"Merged PR #212 with squash (a1b2c3d) after rebasing onto main and re-running the suite. Dark mode is on main.","tickets":[{"id":"ACME-42","status":"merging","note":"merged, reported to the daemon"}],"nextAction":{"owner":"none","what":"The daemon archives the change and retires me"},"knowledge":{"recorded":true,"where":"project KB · Conventions: the dark-mode token convention"},"uncommittedWork":false}
```

**failed** — the work could not be completed and is not going to be by retrying.
```json
{"state":"failed","summary":"The integration suite cannot run in this worktree: it needs a Postgres instance the setup command does not provision, and three attempts to stand one up failed on missing permissions. The unit tests pass.","tickets":[{"id":"ACME-42","status":"blocked","note":"integration tests unrunnable here"}],"nextAction":{"owner":"conductor","what":"Decide whether to ship on unit coverage or fix the worktree setup command"},"knowledge":{"recorded":false,"reason":"the failure is on the ticket; nothing durable beyond it"},"uncommittedWork":false}
```

**idle** — the inbox held nothing actionable. Cheap and correct; do not invent work to avoid it.
```json
{"state":"idle","summary":"Woken by a comment that needed no action; ACME-42 is still waiting on the merge approval.","tickets":[{"id":"ACME-42","status":"in_review"}],"nextAction":{"owner":"human","what":"Approve or reject the merge"},"knowledge":{"recorded":false,"reason":"no work happened this turn"},"uncommittedWork":false}
```
