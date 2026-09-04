---
name: openconductor-scout
description: How to run an investigation ticket in OpenConductor — the deliverable is a written report with evidence, never code and never a PR. Load on any `scout` ticket (and for the answer on a `question` ticket).
---

# Scouting

A `scout` ticket asks a question. **The report is the deliverable.** Your worktree is a laboratory: experiment freely in it, commit scratch work to a throwaway branch if it helps you think, and expect none of it to survive. The report is the only thing that does.

Flow: `todo → in_progress → done`. There is no propose phase, no approval, no PR, no merge.

## Rules

- **Never push, never open a PR, never merge.** Nothing leaves the worktree.
- **Never change the project's code as the deliverable.** If the fix is one line and obvious, say so in the recommendation — writing it is a different ticket, and the conductor decides.
- Read widely: the repo, the specs (`oc_spec_search`, `oc_spec_get`), the project KB, the git history, the tests, the failing output. Run things. Reproduce.
- Cite everything. A claim without evidence is a guess, and a guess in a report gets acted on as if it were a finding.
- Time-box yourself against the ticket's acceptance criteria. When you have enough to answer the question, write the report; do not keep digging for completeness.
- Same obstacle twice, or the investigation needs access you do not have → `blocked` with `{owner: "conductor", action: "…"}`.
- A question you cannot resolve without a product decision → `oc_ask`, then end the turn.

## The report

Write it with `oc_ticket_document_put(id, "report", body)` — markdown, from a file or heredoc, never flattened into one line. Then `oc_ticket_transition(id, "done")` and `oc_report({state: "done", note: "<the one-line verdict>"})`.

It must stand alone. The reader has your ticket and nothing else — not your session, not your reasoning, not the commands you remember running.

```markdown
## Question
<the question as you understood it, in one or two sentences>

## What I did
<the investigation, in order: what you read, what you ran, what you reproduced>

## What I found
<the answer, stated plainly first, then the detail>

### Evidence
- `pnpm test packages/api` → 3 failures, all in `retryOnConflict` (`packages/api/src/db/retry.ts:88`)
- `git log -S "retryOnConflict"` → introduced 2026-07-14 in a1b2c3d, no test at the time
- <one line per piece of evidence: the command or the file:line, then what it showed>

## Recommendation
<what you would do, and why. Smallest thing that solves the problem first.>

## Open questions
<what you could not settle, and what it would take to settle it. "None." is a valid answer.>
```

## Evidence is not authorization

Your recommendation is a recommendation. It does not create a ticket, it does not authorize a change, and it does not become a plan. The conductor reads the report and decides. Write it so that decision is easy: state the cost and the risk of doing nothing as clearly as the cost of your recommendation.

A verdict is always `done`. Do not end a completed investigation as `blocked` because the answer was "this cannot be fixed here" — that is a finding, and findings are the deliverable.

## `question` tickets

Same discipline, smaller shape: the answer goes in a ticket comment with its evidence, then `done`. No document, no worktree ceremony. If answering properly needs an investigation, say so and let the conductor raise a `scout`.
