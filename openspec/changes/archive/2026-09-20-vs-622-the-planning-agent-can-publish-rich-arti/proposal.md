## Why

The planning agent (planner) can only describe a plan in prose and draft rows: it never got
`weave_artifact_kit` or any artifact-publishing tool, while both workers (`weave_ticket_artifact_put`)
and the weaver (`weave_artifact_put`) can publish a rich, sandboxed HTML artifact. A plan is exactly
where a ticket-graph diagram, an options comparison table, a dependency/sequence view or a mock of the
intended change communicates more than text — and captain already sees those from workers. The planner
should be able to show off a plan the same way, without gaining any write access to the project.

Captain added a second, independent problem on the same surface (Plan tab), 2026-09-20 04:09Z: the
draft cards are verbose. Each draft shows its full description inline, so a plan of six or more drafts
is hard to scan. The list needs an at-a-glance overview — a title and a short summary per draft —
that expands to the full description on demand, with the full descriptions still written by the
planner.

## What Changes

### Rich artifacts in a plan

- Add a **plan-scoped artifact store** — `plan_artifacts` + `plan_artifact_revisions`, mirroring the
  existing `weaver_artifacts` tables — reusing the existing artifact pipeline end to end: the same
  `validateArtifactHtml` size/`<html>`/base64-image checks, the same `ARTIFACT_CSP` sandbox, and the
  same `ArtifactViewer` component.
- Add `weave_plan_artifact_put` (scope `planner`): publishes an HTML artifact under a caller-chosen
  `key` to **the planner's own plan only**, guarded by the existing `requireOwnPlanner`, and returns
  a stable viewer URL plus the revision.
- Add `weave_artifact_kit` to the planner's tool surface so it can build a compliant artifact, and add
  the `weave-ai-artifacts` skill to the planner's installed skills.
- Post a **card part** onto the plan's conversation thread at publish time (the same `type: 'card'`
  message-part mechanism the inline decision card already uses, with a new `ref.kind: 'plan-artifact'`)
  so the artifact appears in the Plan tab conversation where it was published and survives a reload.
  One card per `(plan, key)`: a republish updates the existing card's part in place rather than adding
  a second card.
- Add plan-scoped artifact **serving routes** (`/api/w/:ws/plans/:planId/artifacts/:key/raw`, plus list
  and revisions) behind the human-session gate and the shared sandboxing CSP, and a viewer page at
  `/w/:ws/plans/:planId/artifacts/:key`.
- Extend the `weave-ai-artifacts` skill and the planner prompt to say when an artifact helps, that the
  planner must still answer through `weave_plan_reply` (the artifact supports the reply, it does not
  replace it), and that a plan artifact lives on the plan, not the repository.

### Collapsed draft cards

- Give each draft an optional short **`summary`** (a sentence or two, ~200 characters) the planner
  sets through its draft tools; persist it as a nullable `plan_drafts.summary` column.
- Collapse each draft card in the Plan tab list **by default** to a title and a short summary, plus the
  compact facts already shown (kind, priority, role, dependencies, effective tier, status); clicking a
  card expands it to the full description. The full descriptions are unchanged — the summary is extra.
- Fall back to the description's **first sentence** when a draft has no summary, so no card is ever
  summary-less.
- Add **expand all / collapse all**, keep edit, reorder and delete working on a collapsed card, keep a
  card's open/closed state when the plan refreshes under it, and show the **count of drafts**.
- **Non-goals:** no repository write, no repo mirroring, no work product, no new ticket, no workspace-
  or ticket-scope artifact change, and no artifact publishing for any agent kind other than the
  planner (audit only; see Impact).

## Capabilities

### New Capabilities
- `plan-artifacts/storage`: a plan-scoped HTML artifact store and the planner-only publishing tool —
  keyed per plan, revisioned, size- and shape-validated by the existing validator, never a repo write.
- `plan-artifacts/serving`: serving a stored plan artifact's bytes verbatim behind the shared
  sandboxing CSP, to a human web session only, with revisions and cross-plan isolation.
- `plan-artifacts/planner-surface`: the planner-published artifact appears as a card in the Plan tab
  conversation at its publish point, opens in the same sandboxed viewer worker artifacts use, and stays
  attached to the plan across reloads and reopening.

### Modified Capabilities
- `planning-sessions/planner-tools`: the planner's allowed tool surface gains `weave_artifact_kit` and
  `weave_plan_artifact_put`; the "reads the project, never writes to it" guarantee is restated to
  distinguish a plan artifact (workspace storage, not a repository write) and remains enforced by the
  runtime as before.
- `planning-sessions/storage`: a draft ticket may carry an optional short summary alongside its
  (unchanged) full description, for the collapsed draft card.
- `planning-sessions/v2-modal`: the draft list shows each draft collapsed to a title and short summary
  by default, expands one card or all of them, preserves each card's expanded state as the plan
  refreshes, and shows the draft count.
- `artifact-kit/skill`: the skill's "how an artifact reaches the human" guidance gains the planner's
  plan-scoped publishing path.

## Impact

**Core / DB**
- `packages/db/src/migrations/0057_plan_artifacts.sql` (new): `plan_artifacts`,
  `plan_artifact_revisions`, indexes — shaped after `0030_weaver_artifacts.sql`, keyed by `(plan_id, key)`;
  `plan_artifacts.card_message_id` remembers the conversation card to update on republish.
- `packages/db/src/migrations/0058_plan_draft_summary.sql` (new): `ALTER TABLE plan_drafts ADD COLUMN
  summary TEXT`.
- `packages/core/src/artifacts/plan.ts` (new): a `PlanArtifactsService` beside the existing
  `WeaverArtifactsService`, wired in `packages/core/src/create.ts` and `packages/core/src/api.ts`
  (`CoreServices`).
- `packages/core/src/planning/index.ts`: `summary` on add/update draft, with a length cap.
- `packages/core/src/threads/service.ts`: a small `setMessageParts(messageId, parts)` so a republish
  updates the existing card in place instead of appending a second message.

**Server**
- `packages/server/src/tools.ts`: `weave_plan_artifact_put` (new, `scope: 'planner'`), reusing
  `validateArtifactHtml`; `weave_artifact_kit`'s scope is already `all` and needs only to be listed for
  the planner; the draft add/update tools gain a `summary` input.
- `packages/server/src/routes/plans.ts` (new): plan artifact list/revisions/raw routes reusing
  `ARTIFACT_CSP` and the `requireOperator` human-session gate; registered in `app.ts`, routetable and
  `docs/API.md` updated.

**Shared**
- `packages/shared/src/tools.ts`: `PLANNER_TOOLS` gains `weave_artifact_kit` and
  `weave_plan_artifact_put`; `ToolName` union updated. `packages/shared/src/tools.test.ts` updated.
- `packages/shared/src/types.ts`: `PlanDraft.summary`; a `PLAN_DRAFT_SUMMARY_MAX` constant.

**Prompts / skills**
- `templates/planner.AGENTS.md.tmpl` and its `PLANNER_TMPL` fallback in
  `packages/core/src/prompts/defaults.ts`: name the artifact trigger, the reply requirement, and ask
  for a one-or-two-sentence summary on every draft.
- `packages/core/src/workers/home.ts`: `PLANNER_SKILLS` gains `weave-ai-artifacts`.
- `skills/weave-ai-artifacts/SKILL.md`: add the planner publishing path.

**Render**
- `packages/render/src/parts.ts`: a `plan-artifact` card part reader beside `decisionCardPartsOf`.
- `packages/render/src/planDrafts.ts` (new): a pure `draftSummary(draft)` (stored summary, else the
  description's first sentence) — unit-tested, since the collapsed card is its only renderer.

**UI**
- `packages/ui/src/v2/PlanTab.tsx`: collapsed-by-default draft cards with a per-card toggle, expand
  all / collapse all, the draft count, and the compact facts on the collapsed header; the artifact card
  rendered in the conversation via the shared `ArtifactViewer`.
- `packages/render`/`packages/ui/src/v2/ChatConversation.tsx`: render a plan-artifact card part as a
  card with an open action, at its position in the conversation.
- A plan artifact reader page and route (`/w/:ws/plans/:planId/artifacts/:key`) reusing the existing
  workspace-artifact reader shape.

**Audit (no change required)**
- **Worker:** `weave_ticket_artifact_put` + `weave_artifact_kit` (both `COMMON_TOOLS`); can publish to
  its own ticket. ✓
- **Weaver:** `weave_artifact_put` (workspace-scoped) + `weave_artifact_kit`. ✓
- **Persistent session:** `COMMON_TOOLS` + `WORKER_ONLY_TOOLS` + `SESSION_ONLY_TOOLS`, so it has
  `weave_ticket_artifact_put` once it holds a ticket (which it must to attach one); with no ticket it
  has nothing to attach an artifact to. ✓ by design.
- **First interactive turn:** only `FIRST_TURN_TOOLS`, so no artifact publishing on the opening turn —
  deliberate (it says what it understands and stops). The planner was the only real gap.
