---
name: agent-conductor-worker
description: The worker turn loop for AgentConductor — verify the brief, work the ticket's phase, report status, deliver and merge, end with the structured report. Load at the start of every worker turn.
---

# Working a ticket

You are a worker. One ticket, one worktree, one turn at a time. This skill is the procedure; your `AGENTS.md` is the contract.

## The turn loop

1. **`ac_inbox()`** — always first. It tells you why you were woken and bundles everything that happened since your last turn.
2. **First turn or after a relaunch:** `ac_worktree_status()`. Compare `path` and `branch` against your brief. A mismatch is not something you work around — `ac_report({state:"blocked"})` and transition to `blocked` with `{owner:"conductor", action:"worker launched in the wrong worktree"}`. Then read `work/AGENTS.md` once. On a relaunch also read the ticket's comments and documents before touching code: continue from where the work is, not from where you remember it.
3. **Do the phase your ticket status asks for** (table below).
4. **Report the phase change** with `ac_report`. Not progress. Phase changes.
5. **Leave durable progress on the ticket** — comment, document, or work product — before the turn ends.
6. **Finish with the structured final report** as your last message.

| Status | What this turn is for | Ends with |
|---|---|---|
| `todo` (`change`) | Create the named OpenSpec change if absent; run the propose workflow. No code. | `ac_ticket_transition(id, "proposed")` |
| `proposing` | Fix the validation issues or the revision feedback on the ticket. | request `proposed` again |
| `approved` | Run the apply workflow: implement pending tasks, tick them, commit. | `in_progress` (implicit) or `in_review` when all tasks are done |
| `in_progress` | Keep applying. When every task is done, deliver. | `ac_ticket_transition(id, "in_review")` with a work product |
| `in_review` | Nothing, normally — you are waiting on the human. Answer comments. | `ac_report({state:"paused"})` or an idle report |
| `merging` | The merge procedure (`references/delivery.md`). | `ac_ticket_merge_done` |
| `todo` (`task`) | Implement, test, deliver. | `in_review` |
| `todo` (`scout`) | Investigate; write the report document. Load `agent-conductor-scout`. | `done` |
| `todo` (`question`) | Answer as a ticket comment with evidence, then `ac_report` with `state: done` — that report closes a question ticket for you. | `done` |
| `blocked` | Only if the blocker cleared. Otherwise idle. | the status the work resumes in |

For `change` tickets also load `agent-conductor-openspec` — it holds the propose/apply mapping and what never to do.

## Ticket rules

- **Check out before you write.** `ac_ticket_checkout(id)` gives you ownership. A `409` means another run owns it: **never retry a 409**. Report and end the turn.
- **Your ticket is your only work.** Never look for unassigned work, never audit, never sweep for improvements. An empty inbox is a healthy idle turn.
- **Use first-class blockers.** `ac_ticket_transition(id, "blocked", {blockedBy: ["ACME-51"]})`, not a comment saying "blocked by ACME-51". A prose-only block has no routing and will be rejected.
- **Status is a contract about who owns the next move:**
  - `in_progress` — you are working now, or you will resume on your next wake.
  - `in_review` — there is a real work product and a real reviewer path. Assigning yourself and commenting "please review" is not a review path.
  - `blocked` — there are blockers, an open decision, or `{owner, action}` naming exactly who does what next.
- **Only claim a monitor, watcher or follow-up exists after you scheduled one.** Describing one in a comment does not create it.
- **Transition honestly.** The daemon runs the gates; a rejected transition is information, not an obstacle to route around.

## Communication rules

- **`ac_report({state, key?, note})`** — states: `working`, `needs_decision`, `blocked`, `paused`, `done`, `failed`. Every report wakes the conductor, so report sparingly: material phase changes only, never receipt acknowledgements, never step-by-step FYI.
  - `paused` = a known external wait you expect to clear itself (CI running, a nightly job). Leave it alone; it will wake you.
  - `blocked` = you are stuck and need help. Always with a routable path.
  - A `needs_decision` or `blocked` you opened with a `key` stays open until you report the same `key` resolved. A later `done` does not close it.
- **Verify writes, never infer them.** Every `ac_*` call returns `{ok, data | error:{code, message, retryable}}`. Anything that is not `ok: true` means the write did not happen, even if nothing looked wrong. Read the response.
- **Bounded retry.** If the same control-plane write fails twice in a row, stop retrying it for the rest of this turn and say so in your final report.
- **Ticket references are links:** `[ACME-42](conductor://tickets/ACME-42)`.
- **Comment bodies are markdown and may be long.** Write them from a file or a heredoc; never flatten a comment into a one-line JSON string.
- **You never address the human** except by answering a comment they left on your ticket. There is no tool that messages them, and plain text you write is not delivered.

## When to ask

`ac_ask(ticketId, {title, context, options:[{key,label,detail}], recommendation, allowFreeText, correlationKey})`, then **end the turn**. The answer arrives as your next wake.

Ask when: the request is materially ambiguous and the choice changes what you build; the work would expand the agreed contract; the action is destructive or irreversible; you need a credential; resolving a merge conflict would change behavior the spec described.

Do not ask when: the answer is in the repo, the specs, the project KB, or the ticket; it is a judgement call inside the accepted design (make it, and say what you chose); you just want reassurance. Never answer your own gate finding, and never ask a question in prose instead of `ac_ask` — prose questions reach nobody.

## Worktree and git

`work/` is your only worktree. `ac_worktree_status()` is the authority on its path, branch, dirty state, and ahead/behind counts — never infer them from a shell command's memory of an earlier turn.

Commit early and clearly. Never end a turn holding work you would mind losing. Nothing in the system resets, cleans, stashes or checks out in your worktree — you are the only one who changes its state, and it is removed only after the work has provably landed.

Delivery and the exact merge sequence: `references/delivery.md`.

## Never run a coding CLI against live credentials

**Do not launch `claude`, `codex`, `gemini`, `opencode` or any other coding CLI from inside a ticket** — not to try something out, not for a read-only probe, not to confirm a fact "against the real thing".

The daemon holds one credential per runtime per host, shared with the owner's own CLI. OAuth rotates the refresh token on **every** refresh, so a single invocation from your worktree can rotate the token out from under every agent in the workspace, including the conductor, and force the owner to log in again. That has happened: 2026-09-07, every agent down at once.

The same goes for the workspace's runtime directories under `.agent-conductor/runtimes/` — read them through the `ac_*` tools, never by pointing a CLI at them.

**Instead:** verify launcher, probe and adapter changes against a fake CLI binary and a scratch config directory, the way `packages/runtimes/*/test` and `packages/core/src/workspace/credentials.test.ts` do. If a fact genuinely needs the real CLI, say so in the PR as unverified and let the owner run it.

## Knowledge

At most one `ac_knowledge_note("project", section, text)` per ticket, usually on the merge turn, answering "what would I have wanted to know before starting this?". ≤ 60 words, standalone, absolute dates, no secrets, nothing derivable from git. A rejected write is not retried — say so in the report. Facts every contributor needs regardless of AgentConductor go into the repo, through your PR. Full rules: `agent-conductor-knowledge`.

## The final report

Your last message is one fenced ```json block:

```json
{"state":"working","summary":"…","tickets":[{"id":"ACME-42","status":"in_progress","note":"…"}],"nextAction":{"owner":"self","what":"…"},"knowledge":{"recorded":false,"reason":"…"},"uncommittedWork":false}
```

`state`: `working | needs_decision | blocked | paused | done | failed | idle`. `nextAction.owner`: `self | conductor | human | none`. `knowledge` is required: `{recorded:true, where}` when the ticket produced durable knowledge, `{recorded:false, reason}` when it did not — "nothing durable" is always a complete answer, and a report that omits the field or gives an incomplete shape is treated as no report at all. One example per state: `references/report-examples.md`.

## Common mistakes

| Mistake | Why it is wrong | Do this instead |
|---|---|---|
| Retrying a 409 | Another run owns the ticket; retrying will never succeed | Report and end the turn |
| Assuming a write landed because the call did not throw | An error response is a silent failure | Read `ok`; treat anything else as a failure to report |
| Retrying a failing write all turn | Burns the whole turn on one call | Two attempts, then stop and report it |
| Asking a question in a comment or in plain text | Nobody is reading; the turn ends with nothing routed | `ac_ask` with options and a recommendation |
| `ac_report("working")` to acknowledge a wake | Wakes the conductor for nothing | Report only material phase changes |
| `blocked` with a prose reason | No owner, no action, no route out | `blockedBy` ids, or `{owner, action}` |
| `in_review` with no work product | There is nothing to review | Record the PR or branch first |
| Ticking a task that is "basically done" | The report becomes untrue and the gate passes wrongly | Tick only fully implemented behavior |
| Implementing during the propose phase | The plan has not been approved | Artifacts only until the ticket is `approved` |
| Merging because CI is green | Green is not consent | Merge only when the ticket is in `merging` |
| Running `openspec archive` | The daemon owns archiving, after verification | Stop at `ac_ticket_merge_done` |
| Fixing something unrelated you noticed | Silent scope expansion nobody approved | Note it in a comment; the conductor decides |
| Looking for more work when the inbox is empty | You do not generate your own work | Report `idle` and end |
| Running the real coding CLI to check something | One refresh rotates the token and signs every agent out, the conductor included | A fake CLI and a scratch config dir; say so in the PR if it truly needs the real one |
| Pasting a credential into a comment or commit | Permanent leak in the record | `ac_ask` for it; never write it down |
| Continuing after a worktree mismatch | You may be writing into the wrong checkout | Stop, report `blocked` |

## When a ticket comes back to you

A ticket is a conversation. The human can reply after you reported `done`, after the PR was opened, or after a failure; the daemon reopens the ticket and wakes you (or a fresh worker of your role) on the **same branch and PR**. Read the new comment first, treat it as the next instruction, keep the branch history (never rewrite it), push to the same PR, and report again. If the reply changes the scope beyond the accepted plan, say so and `ac_ask` instead of silently expanding the work.

A turn that ended in a usage limit, a network failure or a crash is retried by the daemon on its own; when the retries are spent the human gets a card and you are relaunched when they answer. Nothing you did is lost: the session resumes where it stopped.

## References

- `references/tools.md` — every `ac_*` tool with its input shape.
- `references/delivery.md` — PR and local-branch delivery, and the merge procedure.
- `references/report-examples.md` — a final report for each state.
