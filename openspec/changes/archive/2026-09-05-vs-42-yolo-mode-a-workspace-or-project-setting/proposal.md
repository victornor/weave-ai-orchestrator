## Why

Every `change` ticket stops twice for a human click: a `plan_approval` when the plan validates
(`packages/core/src/tickets/service.ts:284`) and a `merge_approval` when the worker delivers
(`packages/core/src/tickets/service.ts:301`). On 2026-09-05 four PRs sat waiting for approval at
once, and approval — not worker capacity — was the throughput limit of the workspace.

The two escapes that exist today are both wrong for this. `proposalApproval: 'none'` skips the plan
decision entirely: the ticket jumps `proposed` → `approved` with a note and **no decision record at
all** (`tickets/service.ts:285`), so nothing in the history says the plan was ever approved. The
per-ticket `autoMerge` flag likewise suppresses the merge decision and lets `autoMergeSweep` push
the ticket straight to `merging` (`tickets/service.ts:725`) — again with no decision record, and it
has to be set on each ticket at creation. Neither is a mode the owner can turn on for a whole
workspace and see, and neither leaves an audit trail of who approved what.

## What Changes

- **A new setting, YOLO mode.** `defaults.yolo` in `workspace.yaml` (boolean, default `false`), with
  a per-project override `policies.yolo` that can turn it on for a project in an otherwise manual
  workspace or off for a project in an otherwise automatic one. Absent means "inherit".
- **Plan approvals are answered, not skipped.** When a `change` ticket reaches `proposed` under YOLO,
  the `plan_approval` decision is created exactly as it is today and then immediately answered
  `approve` by the daemon as the `system` actor, with answer text naming YOLO mode. The existing
  side effect (`applyPlanApproval` → transition to `approved` → wake the worker) does the rest, so
  the ticket takes the same path it takes when a human clicks Approve.
- **Merge approvals are answered when the work is actually ready.** The `merge_approval` decision is
  created as it is today and left open. `autoMergeSweep` — which already waits for a PR with green
  checks before advancing an `autoMerge` ticket — is widened to cover YOLO tickets, and when the PR
  is open and CI is green it **answers the open decision** as the `system` actor rather than
  transitioning the ticket itself. The merge queue, `mergeApproved` and the landing verification are
  untouched: the ticket enters `merging` through the same door a human approval opens.
- **The policy is read at the moment of auto-approval, not at decision creation.** Turning the mode
  off stops any auto-approval that has not happened yet; decisions already answered stand.
- **Nothing else is auto-approved.** `hire_approval`, `discard_approval`, `retry_approval`,
  `gate_finding` and conductor `question`s keep their owners and still wait for the human.
- **The mode is visible.** The web app carries a persistent YOLO badge in its shell while the mode is
  on for the workspace; `Needs you` renders a merge approval that is waiting on CI as "auto-approving
  when CI is green" with no approve action; the board marks such a ticket as auto-approving rather
  than as waiting on the human. Both surfaces read the same setting the daemon reads.
- **The agents are told.** The conductor instructions and the worker brief state the policy in force
  so neither asks the human for an approval that will be granted without them.
- **CLI.** `conductor workspace set-default yolo=true` and `conductor project set-policy <p> yolo=false`
  already carry arbitrary keys; the new keys are documented in both commands' help.

Not breaking: a workspace that never sets `yolo` behaves exactly as it does today, `autoMerge` and
`proposalApproval: 'none'` keep their current meanings and precedence, and no ticket, decision or
transition changes shape.

## Capabilities

### New Capabilities
- `human-decisions/auto-approval`: what YOLO mode is, where it is configured and how a project
  overrides the workspace, which decision kinds it covers and which it must never cover, when each
  covered decision is auto-approved, how the auto-approval is recorded, what turning the mode off
  does, and how every surface that would otherwise offer an approve action presents it instead.

### Modified Capabilities
<!-- None. `openspec/specs/` holds `conductor-chat/*`, `daemon-upgrade/*`, `human-decisions/option-cards`,
     `knowledge/*`, `ticket-delivery/*` and `usage-plan-limits/*`. `human-decisions/option-cards`
     governs how a decision with options is asked and answered by the human; this change adds no
     requirement to it and removes none — an auto-approved decision is answered before it is ever put
     to the human, and the surfaces that stop offering an approve action are covered by the new
     capability's own requirement. `ticket-delivery/merge-queue` is unchanged: an auto-approved merge
     joins the queue through the same transition a human-approved one does. -->

## Impact

- `packages/shared` — `WorkspaceDefaultsSchema.yolo`, `ProjectPoliciesSchema.yolo`, and a
  `yoloEnabled(policies, workspaceDefault)` resolver beside `mergeConcurrencyOf` in `config.ts`
  (project policies reach core as an untyped record, so the fallback has to live with the schema).
- `packages/core` — `tickets/service.ts` (auto-answer the plan decision after `proposed`; create the
  merge decision for YOLO tickets and let the sweep answer it; widen `autoMergeSweep`'s candidate
  set), `prompts/index.ts` + `prompts/defaults.ts` (the policy line in the worker brief and the
  conductor instructions).
- `packages/cli` — help text on `workspace set-default` and `project set-policy`. No new command.
- `packages/ui` — a shell badge, an `autoApproving` state on `DecisionCard`, `NeedsYou` passing it,
  and an auto-approving chip on `TicketCard`.
- `templates/` — `conductor.AGENTS.md.tmpl` and `brief.md.tmpl` state the approval policy.
- Docs — `docs/PLAN.md` §15 (whose ownership policy currently says `merge_approval: human` is "not
  overridable; only a ticket's `auto_merge` flag bypasses it"), and an ADR recording that deviation.
- No database migration: the setting lives in `workspace.yaml` and the project's `policies_json`,
  and every auto-approval is an ordinary `decisions` row.
