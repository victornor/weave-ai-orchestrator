## Why

A project such as Fernwood lands work on a testing branch (`edge`) and promotes it to production
(`main`) as a separate, deliberate step. Weave today models only the first half. Tickets whose work is
correctly on `edge` can fail to close (VS-565), the merge card says a generic "merge", and promotion
happens outside Weave on GitHub, so workers retarget PRs to `main` to satisfy verification and the human
runs `gh pr merge` by hand. Land-then-promote should be a first-class workflow: tickets are done when
they are on the landing branch, and promotion is one human-gated daemon action the human takes inside
Weave.

## What Changes

- **Land.** For a project whose landing branch differs from its default branch, every ticket's worktree,
  PR, merge card and `merge_done` target the effective landing branch. The merge card reads
  "Land on {landing}" and a finished ticket carries an "on {landing}" delivery badge using the real branch
  name. Workers never open or retarget a PR at the default branch to satisfy verification.
- **Promote.** New project-scoped `promotion_approval` decision kind, not a ticket and never a worker.
  It lists the tickets in the landing-vs-default range, the commit range, and the project's stated
  consequences of going live. The weaver marks it reviewed; the human approves; the daemon then merges
  landing into default. YOLO and auto-merge never answer it. When landing cannot fast-forward onto default,
  the card is held with the reason named and offers no Promote.
- **After promote.** Tickets included in the promoted range gain an "in production" delivery state. None
  reopen and no ticket status changes.
- **Hotfix.** A ticket's `landingBranch` is set only at creation, and only when the human said to land on
  production. After a hotfix, the next promotion card states that landing is behind default.
- **BREAKING (spec):** the requirement that promotion stays entirely outside the daemon is revised. The
  daemon promotes only through an approved `promotion_approval`.
- Weaver prompts and skills stop telling the human to merge a landing-to-default PR by hand.

Out of scope: auto-promote, GitHub Environments, a second merge queue for tickets, changing any project's
compose, Cloudflare or ContentGen wiring, and resolving VS-565.

## Capabilities

### New Capabilities
- `ticket-delivery/promotion`: the land-then-promote workflow's second half: the project-scoped promotion
  card, its gating, the daemon merge of landing into default, non-fast-forward handling, the in-production
  state, and hotfix handling.

### Modified Capabilities
- `ticket-delivery/landing-verification`: promotion is no longer wholly outside the daemon; delivery on the
  landing branch is presented as "on {landing}"; merge card copy names the landing branch.

## Impact

- `packages/shared`: `DECISION_KINDS` gains `promotion_approval` (kept out of `ASKABLE_DECISION_KINDS`);
  delivery-state types.
- `packages/db`: migration allowing a decision with a project and no ticket for this kind (decisions carry
  a `ticket_id` today), plus promotion record storage (promoted range, head shas, timestamp).
- `packages/core`: decisions service (kind wiring, YOLO and auto-merge exclusion, review hold), a new
  promotion service (range computation, fast-forward check, guarded push), ticket delivery state, merge
  card copy in `tickets/service.ts`.
- `packages/server` / `packages/cli`: project promotion status and a "request promotion" endpoint/tool for
  the weaver and UI; tool registry updates.
- `packages/ui`: project Promote control and card, "on edge" / "in production" badges, "Land on {landing}"
  merge card.
- `skills/`, `packages/core/src/prompts`: weaver and worker copy.
