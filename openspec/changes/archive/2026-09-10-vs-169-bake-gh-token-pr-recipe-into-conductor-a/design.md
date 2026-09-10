## Context

See proposal.md for motivation.

Today the recipe lives only in this workspace's platform-engineer charter
(and SHARED.md / the tickets-and-openspec knowledge doc). Those do not travel
to other workspaces. The daemon-rendered always-loaded files are:

- `templates/conductor.AGENTS.md.tmpl` → `conductor/AGENTS.md`
- `templates/worker.AGENTS.md.tmpl` → `workers/<id>/AGENTS.md`

Workers copy forge commands from
`skills/agent-conductor-worker/references/delivery.md`, which currently says
bare `gh pr create` and `gh pr merge`. `packages/core/src/prompts/render.test.ts`
already reads the shipped templates and asserts phrases in the rendered
conductor prompt.

## Goals / Non-Goals

**Goals:**

- Both shipped AGENTS templates, and the worker delivery procedure, name the
  exact `GH_TOKEN="$(gh auth token)"` recipe and forbid `gh auth login` /
  asking the human to authorize GitHub for a logged-out `gh auth status`.
- A render test fails if either template drops the recipe.

**Non-Goals:**

- No new secret, no change to `gh` itself, no daemon wrapper around `gh`.
- Not writing this into SHARED.md or a role charter (does not travel).
- Not editing operator docs that tell a human to `gh auth login` on the host
  (`docs/OPERATIONS.md`, README, Docker).
- Not launching a real coding CLI or `gh auth login` to verify.

## Decisions

### Place the worker rule in the existing Git section

`templates/worker.AGENTS.md.tmpl` already has a Git section that points at
`delivery.md`. One bullet there is the always-loaded copy every worker sees
on every turn, including workers that never load the delivery skill until
the last phase.

Alternative: only change `delivery.md`. Rejected — a conductor or a worker
mid-ticket that treats `gh auth status` as a blocker never opens that file.

### Place the conductor rule as a short GitHub CLI note after Hard rules

The conductor does not run `gh`, but it *does* escalate what looks like a
credential gap. Hard rules 1–5 are structural never-dos in priority order;
a sixth about `gh` would over-rank it. A 3-line "GitHub CLI" note after
Hard rules (before "How work flows") is visible without changing priority.
Also carve it out of "Reach {{human.name}} immediately for … a needed
credential" so a logged-out `gh auth status` is not treated as one.

Alternative: only the worker template. Rejected — the 2026-09-10 incident
was the conductor asking, not the worker.

Alternative: a new hard rule. Rejected — wrong priority band.

### Copy the same prefix into delivery.md

Workers following the procedure will otherwise still run bare `gh pr create`.
Prefix both `gh pr create` and `gh pr merge`. Do not add a "if status looks
logged-out" branch; always set `GH_TOKEN="$(gh auth token)"` so the command
works whether status is logged-in or not.

Alternative: a small shell helper in the repo. Rejected — more than the
ticket asked, and agents would still have to be told to use it.

### Assert the exact recipe string in render.test.ts

Extend the existing `it.runIf(existsSync(SHIPPED_TEMPLATES))` shipped-template
cases (or add one next to them) so both rendered instruction files contain
`GH_TOKEN="$(gh auth token)"` and forbid `gh auth login`. Source-read the
templates the same way VS-161 already does for comment slots.

Do not snapshot the whole files.

## Risks / Trade-offs

- [The recipe is host-specific and wrong on a machine where `gh auth token`
  also fails] → Then it is a real auth gap and `ac_ask` for a credential is
  correct. The prompt forbids only treating *status looking logged-out* as
  the gap.
- [Always setting `GH_TOKEN` overrides a logged-in `gh` session] → Accept.
  `gh auth token` is the same credential `gh` would use; the prefix is
  idempotent when status is already logged-in.
- [Operator docs still say `gh auth login`] → Those are for a human setting
  up the host, out of scope. Agents must not run that command.

## Migration Plan

Prompt-only. Next conductor/worker spawn after deploy renders the new text.
No data migration. Rollback is revert.

## Open Questions

None.
