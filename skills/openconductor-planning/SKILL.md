---
name: openconductor-planning
description: How to turn a request into the smallest ticket graph that works — one end-to-end ticket by default, split only for a qualifying reason, with checkable acceptance criteria. Load before creating more than one ticket, or when decomposing work.
---

# Planning work

## Minimize the ticket graph

**Prefer one end-to-end ticket with one owner.** That is the default and it is usually right. Every extra ticket costs a worker, a worktree, a session, a handoff and a merge — and every handoff loses fidelity.

Split **only** when one of these qualifying boundaries applies:

1. **Different owner or project.** The work genuinely belongs to another role or another repo.
2. **A parallelizable, self-contained deliverable.** It can be built, tested and delivered without the other half, by someone who never reads the other ticket.
3. **A hard dependency that needs its own blocker lifecycle.** Something must land, be approved, or be answered before the rest can start, and that wait should be visible.
4. **An independent review gate.** The work needs a verdict from someone who did not build it.
5. **Substantial follow-up.** Real work that is genuinely optional or genuinely later — not "and then polish it".

Not qualifying: "it's two files", "it's frontend and backend in the same repo", "it'll be a big PR", "the worker can do them in either order", "it's tidier".

**Every child ticket names its qualifying reason in its description.** If you cannot name one, it is not a child ticket; it is a paragraph in the parent's description.

**Then do a merge-back pass.** Read the graph you just drew and merge every pair that no longer needs to be separate. Two tickets with the same owner, no dependency between them and no separate review gate are one ticket.

## Dependencies

Use first-class blockers: `oc_ticket_create({..., blockedBy: ["ACME-51"]})`. Never encode a dependency as prose in a description, and never as ordering you keep in your head — nothing wakes on it.

`parentId` is structure, not sequencing. A parent groups; a blocker orders. Do not use one for the other.

Serialize only on a true dependency: one ticket needs the other's *output*. Two tickets touching the same file is a merge-time problem the merging worker resolves, not a reason to make them wait for each other.

## Acceptance criteria

Each one is a statement someone who was not in the conversation can check. Write them from the outside, in behavior, not in implementation.

**Bad:** "Dark mode works." · "Refactor the theme provider." · "Good test coverage."
**Good:**
- The dashboard renders with the dark palette when the OS reports dark.
- A manual choice in settings overrides the OS setting and survives a reload.
- Every existing visual test passes in both palettes.

Three to six criteria is normal. More than eight usually means the ticket should have been split — or, more often, that the criteria are describing implementation steps rather than outcomes. Steps belong in the plan the worker writes, not in the ticket.

Also write **Out of scope**. It is the cheapest way to stop a worker absorbing adjacent work, and the thing whose absence causes most scope creep.

## Scout first?

Raise a `scout` before the `change` when unresolved uncertainty would change *what* to build:

- Nobody knows the cause ("the dashboard is slow").
- Two designs are plausible and the choice turns on facts nobody has.
- The request assumes something about the codebase that may not hold.
- The work looks large and any estimate is a guess.

Do not scout when the path is obvious. A scout costs a full turn and produces a report someone has to read and act on.

## Scope creep during the work

A worker that finds work beyond the spec calls `oc_ask` and pauses that task. It never absorbs it silently and never drops it silently. When that reaches you:

- **Inside the accepted design and unambiguous** → decide it, and say what you chose.
- **Expands the contract** → escalate to the human with the five-part escalation form.
- **Real but separate** → a follow-up ticket, and the current one continues as agreed.

## Enough is enough

Re-planning a plan is procrastination. When the ticket is clear enough for a competent worker to start and its acceptance criteria are checkable, create it and assign it. The plan a worker writes during propose is where the detail belongs — that is what the propose phase is *for*. Ship something.
