---
name: weave-ai-hire
description: Hiring a role in Weave AI — check for overlap first, draft the spec and charter, submit with weave_role_hire, and refine charters when workers repeat a mistake. Load when no existing role fits a ticket, when the human asks for a new role, or when a charter keeps producing the same error.
---

# Hiring a role

A **role** is a kind of work, not a person. One "Backend Engineer" role serves any number of concurrent tickets — concurrency comes from the project's Settings max-workers cap, never from hiring a second copy of the same charter. Hire only when no existing role covers the work.

## A hire request from the web app

The V2 Hire a role modal formats its request as an ordinary chat message whose first line is
`/hire-role project=<project slug>`, followed by a blank line and a description of what the role
should own. When a human message begins with that line, it is a hire request for that project — not
an unclassifiable message: identify the project by its slug and follow this skill (overlap check,
draft, submit). There is no command parser; the format exists only so you can recognise the request.
Hire approval still applies: submit with `weave_role_hire` and, with `hireApproval = human`, the role
waits for the human to approve the charter before any worker runs.

## 1. Overlap check — before you draft anything

`weave_role_list()`, then `weave_role_get(id)` on anything close. Compare each role's `scope` and charter summary against what the ticket needs.

- **A charter matches or highly overlaps** → reuse it. Assign the ticket and stop. This is the common case and the right answer.
- **The overlap is partial** → hire, and clarify the distinction in **both** charters. Update the existing one with `weave_role_update_charter` in the same breath as the hire, so the next ticket routes without a coin flip.
- **No existing role fits** → hire.
- **The work is one ticket and unlike anything else this project does** → still hire, but write the scope narrowly. A role that exists is cheap; a role with a vague scope poisons routing forever.

Never hire a second role because the first is busy. Never hire per-ticket. Never hire into a project the human has not added.

## 2. Draft the spec

Fields and constraints: `references/spec-schema.md`. Worked examples for backend, frontend, reviewer, docs and devops roles: `references/role-examples.md`.

- **name** — what a human would call the job: "Backend Engineer", "Frontend Engineer", "Reviewer". Not a codename, not a person's name.
- **charterSummary** — one sentence: what this role owns. "Owns the api service: HTTP handlers, persistence, migrations, tests."
- **scope** — natural language, and **this is what routing matches on**. State what is in and what is explicitly out: "Backend and API work in the api repo, including the data model and migrations; not the frontend, not infrastructure."
- **responsibilities** — 5 to 9 bullets, each a real deliverable.
- **capabilities** — the stack and tooling the work needs.
- **exclusions** — the adjacent things a worker would otherwise absorb.
- **rules** — project-specific rules, pulled from that project's `PROJECT.md` (Conventions and Landmines), not invented.
- **sessionPolicy** — `per_ticket` for anything that builds; `fresh` for reviewers, so each review starts unbiased.

Run the checklist in `references/checklist.md` before submitting.

## 3. Submit

`weave_role_hire(spec)`. The daemon validates, writes `roles/<id>/` transactionally (spec, charter, empty notes), and creates the role.

- With `hireApproval = human` (the default), the role is `pending_activation` and a `hire_approval` decision goes to the human. Tell them: what you hired, why the existing roles did not fit, and that they can switch its CLI before its first worker runs. Then end the turn — the answer arrives as a wake.
- With `hireApproval = none`, the role is active immediately. Still tell the human what you hired, in one line.

Do not assign the ticket to a `pending_activation` role and hope. Wait for activation, then `weave_ticket_assign`.

## 4. Refine, don't re-hire

When workers of a role repeat the same mistake — they keep skipping the integration tests, keep touching a generated file, keep asking a question the project KB answers — that is a charter defect, not a worker defect.

Two tools, two jobs:

- `weave_role_update(id, {patch, reason, applyToRunning?})` — the **spec fields**: `charterSummary`, `scope`, `responsibilities`, `capabilities`, `exclusions`, `rules`, `sessionPolicy`, `permission`, `notes`, `name`, `title`, `icon`. Fix a stale one-line description, or a scope that keeps routing the wrong work, here. `id` and `project` are immutable; `secrets` and `maxWorkers` have their own tools. `applyToRunning: true` re-briefs the role's live workers from the new spec now.
- `weave_role_update_charter(id, {charter, reason, applyToRunning?})` — the **charter prose** itself. Add one concrete rule, stated as a rule, under the weaver's notes. "Never edit `src/generated/**`; it is regenerated by `pnpm codegen`."

Give a `reason` that names the evidence: which tickets, what happened. `applyToRunning: true` only when live workers would otherwise repeat it today. The daemon records a revision; the human can roll it back. Do not rewrite a charter wholesale to fix one recurring mistake.

A spec change refreshes `CHARTER.md` automatically only if the daemon rendered it from the spec; if the charter was written by hand the tool says so and you update it with `weave_role_update_charter`. A change to `permission` is security-sensitive and follows the hire policy: it is raised for approval and applies only once approved, so tell the human when you make one.

If the same role keeps taking work it should not, the defect is in `scope`, not in the rules. Narrow the scope with `weave_role_update` and say so in the reason.

## 5. Retiring

`weave_role_retire(id, reason)` when a project is archived or a kind of work has genuinely ended. Retiring a role with live workers requires a human decision — do not try to route around it by cancelling the workers first. `weave_role_pause` is the reversible option, and the right one when you are unsure.

## References

- `references/spec-schema.md` — every field, its type, and what a good value looks like.
- `references/role-examples.md` — five complete specs.
- `references/checklist.md` — the pre-submit checklist.
