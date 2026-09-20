## Why

Captain, 2026-09-20 04:35Z: "an option to always generate a visual artifact along with a plan, for
visual learners and more visual people … It should be default disabled, but some people might like to
have a visual representation of every plan."

Workers can already publish a sandboxed HTML artifact to their ticket with
`weave_ticket_artifact_put` after `weave_artifact_kit` (skill `weave-ai-artifacts`); today they do it
when they judge it helpful. This change adds a per-project policy that makes it happen for every
`change` plan, default **off**, enforced by the `proposed` gate and shown on the plan approval card
and the Plan view.

## Audit: what already exists (verified in the worktree at `f07b65e6`, 2026-09-20)

- **A project policy mechanism already carries booleans.** `ProjectPoliciesSchema`
  (`packages/shared/src/config.ts:76`) is `.partial()`, stored as `projects.policies_json`, resolved
  through helpers like `yoloEnabled`/`mergeConcurrencyOf` that treat an absent or malformed value as
  the safe default. `PATCH /projects/:id` accepts a whole `policies` object
  (`packages/server/src/routes/projects.ts:95`), the CLI's generic `weave project set-policy key=value` writes it, and
  `projects.update` persists it into both the DB row and the project's `workspace.yaml` block. So a
  new boolean policy needs **no migration for the setting itself** and reaches every surface the
  other project policies already reach.
- **Artifacts are stored under a reserved document key and served sandboxed.**
  `weave_ticket_artifact_put` writes the ticket document `artifact:<key>` (revisioned) and records an
  `artifact` work product; the raw route
  `/api/w/:ws/tickets/:id/artifacts/:key/raw` serves the stored bytes behind the sandbox CSP, and
  `weave_ticket_document_get` refuses to read an `artifact:` body back (`ticket-artifacts` specs,
  `packages/server/src/tools.ts:818`). Nothing here is weakened.
- **The plan approval card already surfaces an artifact — on one of its two builders.** The V2 card
  (`packages/ui/src/v2/DecisionCard.tsx:418-425,503-512`, used by Needs you and V2 Chat) already
  finds the ticket's first `type='artifact'` work product and renders an `Artifact` tag plus a link
  with its title, targeting the ticket page's artifact route. The V1 card
  (`packages/ui/src/components/DecisionCard.tsx`) — which is what V2's own **Plan tab** renders
  (`packages/ui/src/v2/ticket/Ticket.tsx:18,580`) — renders **no** artifact at all. The project KB
  already records this "two independent card builders" trap (`decision-cards-and-surfaces`).
- **The plan gate already branches on the ticket, never the project's live mode.** VS-578's
  `proposed` gate (`packages/core/src/tickets/service.ts:744-757`) validates OpenSpec for a bound
  change and otherwise requires the worker's `approach` plan document. VS-578 solves the
  mid-flight-flip problem by fixing a ticket's path at binding time, and the project KB
  (`config-and-schemas`) records that `PATCH /projects/:id` replaces `policies` wholesale.
- **Tickets carry no per-ticket setting yet for this.** `bindOpenspec`
  (`packages/core/src/tickets/service.ts:260`) is called at assign time (creation with a role, and
  `assign`) and writes `openspec_change_name`; there is no analogous stamp for a policy.

## What Changes

- **A new per-project boolean policy, `visualPlanArtifact`, default off.** Named "Visual plan
  artifact" in Settings (Projects row, always visible rather than behind an expander, next to the
  OpenSpec control), marked **experimental**, with the one-line cost warning that it spends worker
  tokens on every plan. It rides the existing project-config/`PATCH`/CLI/config-file path like every
  other policy; no new store, no new route.
- **The rule is fixed on the ticket when it starts, not read live.** `bindOpenspec`'s assign-time
  hook gains a sibling that stamps `tickets.plan_artifact_required` (0/1) for a `change` ticket from
  the project's policy at that moment. A ticket that began planning while the policy was off keeps
  off, and one that began while it was on keeps on, so flipping the policy never traps a ticket that
  is already planning (the same guarantee VS-578 gives for OpenSpec). Existing tickets have no stamp
  and read as off — the default, and no retro-demand.
- **The `proposed` gate enforces it on both paths for `change` tickets.** When the ticket's stamp is
  on, the transition is refused with a `validation` error naming `weave_ticket_artifact_put` and the
  key `plan` unless the ticket carries a published plan artifact: a stored ticket document
  `artifact:plan` with a current revision. This sits alongside the existing OpenSpec validation and
  the fast-path `approach` requirement, so it applies to OpenSpec-on and OpenSpec-off tickets alike,
  and to nothing else — `task`, `scout`, `question` and `operational` tickets are untouched.
- **The plan artifact is the ticket's `artifact:plan`.** The key is reserved for this purpose (it
  mirrors the fast path's reserved `approach` document key and the daemon-owned `plan` document key,
  and collides with neither). The worker publishes it with the existing artifact tool and the AC
  Artifact Kit; the skill and prompt say so.
- **Both plan-approval card builders show it, and a new revision updates it.** The V1 card gains the
  artifact (a labelled button with its title that opens the existing sandboxed viewer route), so the
  Plan view shows it; the V2 card prefers the `plan` artifact over any other artifact it might find.
  Neither changes approval behaviour — the card, the weaver review and YOLO are exactly as today.
- **Guidance and docs.** `weave-ai-worker`, `weave-ai-openspec` and `weave-ai-artifacts` state the
  rule and that the artifact supports the plan, never replaces the written plan; the rendered worker
  brief and `AGENTS.md` gain a mode line from the ticket's stamp; `docs/OPERATIONS.md`, PLAN §20 and
  the README name the setting and the CLI/config path.

## Capabilities

### New Capabilities

- `plan-artifacts`: the optional per-project policy that a `change` plan carries a visual artifact —
  default off, fixed per ticket at plan start, enforced at `proposed` on both the OpenSpec and fast
  paths, published under the reserved `artifact:plan` key, and shown on the plan approval card and
  Plan view without changing approval behaviour.

### Modified Capabilities

- `web-settings/project-policies`: the Projects row gains the `visualPlanArtifact` control (always
  visible, experimental, with its cost warning) and the add-project form the same choice.
- `human-decisions/option-cards`: a `plan_approval` card shows the ticket's plan artifact, through
  the existing sandboxed artifact viewer, on both card builders.
- `agent-prompts/conditional-repo-files`: the rendered worker brief and worker `AGENTS.md` tell a
  worker whose ticket carries the rule to publish a plan artifact before `proposed`, and that it
  supports rather than replaces the written plan.

## Impact

- **Shared:** `packages/shared/src/config.ts` (`ProjectPoliciesSchema.visualPlanArtifact`, a
  `visualPlanArtifactEnabled` resolver), `packages/shared/src/types.ts` (`Ticket.planArtifactRequired`).
- **DB:** migration `0060` adding `tickets.plan_artifact_required INTEGER`; `ticketRow` boolean
  conversion in `packages/db/src/repos.ts`.
- **Core:** `packages/core/src/tickets/service.ts` (assign-time stamp beside `bindOpenspec`, the
  `proposed` gate), `packages/core/src/prompts/index.ts` (`planArtifact` render flag).
- **UI:** `packages/ui/src/components/DecisionCard.tsx` (V1, the Plan view) and
  `packages/ui/src/v2/DecisionCard.tsx` (V2) render the plan artifact;
  `packages/ui/src/settings/sections.tsx` and the add-project form add the control.
- **Skills/templates/docs:** `skills/weave-ai-worker`, `skills/weave-ai-openspec`,
  `skills/weave-ai-artifacts`, `templates/worker.AGENTS.md.tmpl`, `templates/brief.md.tmpl`,
  `docs/OPERATIONS.md`, `docs/PLAN.md` §20, `README.md`.
- **No behaviour change for a project that leaves the policy off (the default).** The gate branch,
  the stamp and the card rendering are additive; every existing artifact and approval path is
  unchanged. A ticket created before this ships has no stamp and reads as off.
