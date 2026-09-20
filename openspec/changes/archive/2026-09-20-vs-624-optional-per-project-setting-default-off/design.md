## Context

See `proposal.md` for the audit. The relevant current state, verified in the worktree at
`f07b65e6` (2026-09-20):

- `ProjectPoliciesSchema` (`packages/shared/src/config.ts:76`) is `.partial()`, persisted as
  `projects.policies_json` and the project's `workspace.yaml` block; `PATCH /projects/:id` accepts a
  whole `policies` object (`packages/server/src/routes/projects.ts:95`) and `weave project set-policy`
  writes it. `yoloEnabled` is the precedent for a boolean policy whose resolver returns false for an
  absent or malformed value.
- The `proposed` gate (`packages/core/src/tickets/service.ts:744`) branches on the ticket's own
  binding: a bound change validates OpenSpec, an unbound change requires the `approach` document
  (VS-578). Nothing else is read from the project's live mode there.
- `bindOpenspec` (`service.ts:260`) runs at assign time (`create` with `assigneeRoleId` at
  `service.ts:1010`; `assign` at `service.ts:1078`) and is the one place a per-ticket property is
  fixed from the project.
- Artifacts are stored as the ticket document `artifact:<key>` by `weave_ticket_artifact_put`
  (`packages/server/src/tools.ts:818`), served sandboxed, and are not readable back by any agent.
  The `plan` document key is daemon-owned (`human-decisions/approval-integrity`).
- There are two plan-approval card builders. `packages/ui/src/v2/DecisionCard.tsx` (Needs you, V2
  Chat) already renders a ticket artifact; `packages/ui/src/components/DecisionCard.tsx` (V1, and the
  builder V2's **Plan tab** uses at `packages/ui/src/v2/ticket/Ticket.tsx:18,580`) renders none.

## Goals / Non-Goals

**Goals**

- An opt-in, default-off project policy that makes every `change` plan carry a visual artifact.
- The rule is enforced by the daemon at `proposed`, on both the OpenSpec and fast paths, with a
  message that tells the worker exactly what to do.
- Flipping the policy never traps a ticket that is already planning.
- The artifact is shown on the plan approval card and the Plan view, through the existing sandboxed
  viewer, with no change to approval behaviour.
- Leaving the policy off changes nothing.

**Non-Goals**

- Changing plan approval, the weaver review, YOLO, or the plan document.
- A dedicated CLI verb or a new route: the generic project-policy path already carries it.
- Any new artifact trust rule; the existing viewer, validation and size caps are reused unchanged.
- Requiring an artifact from `task`, `scout`, `question` or `operational` tickets.

## Decisions

### D1 — The setting is a boolean project policy, `visualPlanArtifact`, default off

Add `visualPlanArtifact: z.boolean()` to `ProjectPoliciesSchema` (`.partial()`, so unset means
inherited/off) plus a `visualPlanArtifactEnabled(policies)` resolver that returns false unless the
value is exactly `true`.

**Why:** policies are the existing per-project opt-in mechanism and already reach Settings,
`PATCH /projects/:id`, `weave project set-policy` and `workspace.yaml` with no migration and no new
route. `yoloEnabled` is the exact precedent for "absent or malformed is off", which matters for a
setting whose on-state costs tokens. It is also how the ticket describes the setting ("the same
project config and `PATCH` path … as the other project policies").

**Alternatives considered:** a dedicated `projects.visual_plan_artifact` column like
`openspec_enabled` — rejected: OpenSpec needs a column because it drives bootstrap and ticket
binding and carries a version; this is a pure render/gate flag with no side effects, so a migration
and a new route field would be ceremony for nothing. A workspace-level default — rejected: the
ticket asks for a per-project option, and there is deliberately "no hidden default".

### D2 — The rule is stamped on the ticket once, at plan start, never re-read live

A new nullable column `tickets.plan_artifact_required` is stamped 0 or 1 for a `change` ticket by a
sibling of `bindOpenspec`, at assign time, from the project's policy at that moment. The `proposed`
gate reads the ticket's stamp, never the project's live policy.

**Why:** it is the only rule that satisfies "flipping the setting never traps a ticket that is
already planning" in both directions, and it mirrors exactly how VS-578 fixes a ticket's OpenSpec
path at binding time (`openspec-mode` requirement 2). A ticket created before this ships has no stamp
and reads off — the default — so nothing is retro-demanded. Stamping at assign (not at creation) is
right because a `backlog` ticket has not begun planning, and `bindOpenspec` already runs there.

**Alternatives considered:** reading `visualPlanArtifactEnabled(project.policies)` in the gate —
rejected: turning the policy on would strand every ticket already mid-plan, and turning it off would
silently drop a requirement a human asked for. Storing the rule in `openspec_state_json` — rejected:
that column is the OpenSpec mirror, and the rule must apply on the OpenSpec-off fast path too, where
there is no OpenSpec state.

### D3 — The plan artifact is the reserved document key `artifact:plan`

The worker publishes with `weave_ticket_artifact_put` under key `plan`. The gate requires a stored
ticket document `artifact:plan` with a current revision. The card resolves the `plan` artifact
specifically.

**Why:** a reserved key makes the gate a presence check and the card selection deterministic, and it
mirrors the two reserved plan-related keys already in the system — the fast path's `approach`
document (worker-written, daemon-published as `plan`) and the daemon-owned `plan` document
(`human-decisions/approval-integrity`). `artifact:plan` collides with neither: artifacts live under
the `artifact:` document-key prefix, which the general document tool refuses to write. The ticket's
"no artifact published since the plan started" is satisfied structurally: only a worker acting on
this ticket can create `artifact:plan`, and only a ticket whose stamp is on is gated, so the artifact
is necessarily from this plan.

**Alternatives considered:** accept *any* artifact published after a timestamp — rejected: the gate
would need a fragile time comparison (the worker may publish before the ticket enters `proposing`),
and the card could not pick deterministically among several artifacts. Requiring the worker to write
the plan artifact into the repo — rejected: artifacts are daemon-stored and sandboxed, and the
existing pipeline is the one the ticket says to reuse.

### D4 — Both card builders show it; the V2 already shows artifacts and only needs to prefer `plan`

`packages/ui/src/components/DecisionCard.tsx` (V1) gains an optional `planArtifact` prop rendered as
a labelled button/link with its title, opening the artifact's existing sandboxed viewer route; the
Plan view passes the ticket's `plan` artifact. `packages/ui/src/v2/DecisionCard.tsx` keeps its
existing artifact rendering but prefers the artifact whose `externalId` is `plan` on a
`plan_approval` card.

**Why:** the project KB (`decision-cards-and-surfaces`) records that there are two independent card
builders and that a new behaviour must be applied to both; the audit shows the Plan view uses the V1
builder while Needs you and V2 Chat use the V2 one. The artifact link is the existing mechanism
("a card or button with the title"), and it opens the sandboxed viewer the ticket asks to reuse — no
second viewer, no inline iframe on the card.

**Alternatives considered:** rely on the existing V2 artifact rendering alone — rejected: the Plan
view would still show nothing. Render the artifact inline in an iframe on the card — rejected: the
viewer already exists and the ticket explicitly says to reuse it.

### D5 — The control is inline, experimental, and states its cost

Settings shows the control in the project row's always-visible header — beside the name, workers,
landing branch and YOLO chip — not inside the collapsed "Delivery & setup" panel, labelled "Visual
plan artifact", marked **experimental**, with a compact cost note (the full "costs the worker tokens
on every plan" sentence is the control's tooltip; at phone width the label wraps and stays in the
row). The first cut put it in the collapsed panel beside OpenSpec; the review asked for the header,
which is where a setting a human is expected to find belongs.

**Why:** the ticket asks for it to be visible without an expander if the layout allows, which it
does; and honesty about cost is an explicit requirement. `weave project set-policy
visualPlanArtifact=true` and the `policies` config key are the CLI/config surfaces, documented in
PLAN §20 and the README.

### D6 — No behaviour change when the policy is off

Every branch is additive: `visualPlanArtifactEnabled` returns false by default, an unstamped ticket
reads off, and the card renders unchanged when there is no `artifact:plan`.

**Why:** the ticket makes "default off changes nothing" a test, and most projects will leave it off.

## Risks / Trade-offs

- **Token cost on every plan.** The point of the feature, and an explicit reason it defaults off and
  says so in Settings. A `task` ticket is deliberately not covered, so trivial OpenSpec tracker work
  does not pay it.
- **A worker could publish `artifact:plan` and skip the written plan.** The gate still requires the
  path's own plan (`approach` or a validating OpenSpec change), so the artifact can never substitute
  for the plan; the guidance says so too.
- **The stamp must be written where `bindOpenspec` is.** If a future code path assigns a ticket
  without going through `bindOpenspec`, the stamp is missed and the ticket reads off. Mitigated by
  stamping in the same function that fixes the OpenSpec binding, so the two cannot diverge, and by a
  test on both the create-with-role and assign paths.
- **`PATCH /projects/:id` replaces `policies` wholesale** (`config-and-schemas`). The UI already
  spreads siblings for every policy control; the new control uses the same helper, so it cannot drop
  another policy.
- **Two card builders can drift again.** The requirement is written once in
  `human-decisions/option-cards` and tested against both the Plan view and the V2 card.

## Migration Plan

Migration `0060` adds `tickets.plan_artifact_required INTEGER` (nullable). No data migration: every
existing row is null and reads off, which is the default and preserves current behaviour. No project
config migration: an absent `visualPlanArtifact` is off. Rollback is a revert; a project that turned
the policy on simply stops requiring artifacts.

## Open Questions

None material. The generic `weave project set-policy visualPlanArtifact=on|off` is the CLI surface;
a dedicated verb was considered and rejected as unnecessary for a single boolean policy with no
special semantics.
