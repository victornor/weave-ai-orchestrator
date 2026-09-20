## Context

Workers publish sandboxed HTML artifacts with `weave_ticket_artifact_put` (`ticket_documents` under an
`artifact:` key, served by `GET /tickets/:id/artifacts/:key/raw`); the weaver has the ticket-less
sibling `weave_artifact_put` (`weaver_artifacts`/`weaver_artifact_revisions`, migration `0030`, served
by `GET /artifacts/:key/raw`). Both share `validateArtifactHtml` (`packages/server/src/tools.ts`),
`ARTIFACT_CSP` (`packages/server/src/artifact-csp.ts`) and `ArtifactViewer`
(`packages/ui/src/components/ArtifactViewer.tsx`). The planner's surface is `PLANNER_TOOLS`
(`packages/shared/src/tools.ts`) — deliberately not `COMMON_TOOLS` minus subtractions — and it has no
artifact tool and no `weave_artifact_kit`.

A plan (`plans`) is a `drafting` session with its own `channel_threads` row (`thread_id`) and an
ordered list of `plan_drafts` (migration `0041`). The Plan tab (`packages/ui/src/v2/PlanTab.tsx`)
renders the plan's thread through the shared `ChatConversation` beside a draft list. The only card
part the render layer trusts today is `decisionCardPartsOf`
(`packages/render/src/parts.ts`), for decisions.

See proposal.md for why. This document covers how.

## Goals / Non-Goals

**Goals:**

- The planner can publish and revise a rich HTML artifact scoped to its own plan, through one tool
  call, with the same validation and sandbox trust rules as ticket and workspace artifacts.
- A published artifact appears in the Plan tab conversation at its publish point, opens in the shared
  sandboxed viewer, and survives a reload, a plan reopening and a planner replacement.
- A draft card is collapsed by default to a title, a short summary and the compact facts, with the
  full description one click away; the planner can set that summary.

**Non-Goals:**

- No repository write, no repo mirroring, no work product, no new ticket, and no artifact publishing
  for any agent kind other than the planner (the audit in proposal.md is the deliverable for the
  others).
- No mapping of a draft's summary onto the created ticket's own `summary` field; the description still
  becomes the ticket description. The draft summary is a display aid.
- No persistence of a card's expanded state across a full page reload — only across a plan refresh
  under an open tab.
- No artifact body read-back: agents that publish still cannot read an artifact's HTML back, and a
  plan artifact follows the same rule.

## Decisions

### 1. A plan-scoped artifact store, keyed `(plan_id, key)`, mirroring `weaver_artifacts`

Add `plan_artifacts` + `plan_artifact_revisions` (migration `0057`), shaped after `0030` but with
`plan_id` in place of `workspace_id` and `UNIQUE (plan_id, key)`. `PlanArtifactsService` mirrors
`WeaverArtifactsService` (`put`, `getRevision`, `list`, `revisions`).

*Alternatives rejected:* widening `weaver_artifacts` with a nullable `plan_id` would make the weaver
store's uniqueness depend on a second column and mix two callers' rows; it also gives the weaver's
list to the planner's data. Storing a plan artifact as a `ticket_documents` row needs a ticket the
planner must never create.

The service returns a `cardMessageId` with each artifact (see Decision 4) and emits
`plan.artifact_published` on the plan entity, so any open Plan tab can invalidate.

### 2. Reuse the existing validator, CSP and viewer — no second copy

`weave_plan_artifact_put` calls the same `validateArtifactHtml` (empty / non-HTML / `ARTIFACT_MAX_CHARS`
/ base64-raster checks), and the raw route returns the stored bytes with `ARTIFACT_CSP`,
`text/html; charset=utf-8` and `x-content-type-options: nosniff`, exactly as `routes/artifacts.ts`.
The web app renders through the same `ArtifactViewer`.

*Alternative rejected:* a plan-specific size cap or validator would drift from the ticket/workspace
routes and weaken the "same trust rules" requirement.

### 3. The tool is `scope: 'planner'` and takes no plan id

`PLANNER_TOOLS` gains `weave_artifact_kit` (already `scope: 'all'`) and `weave_plan_artifact_put`. The
handler resolves the plan with the existing `requireOwnPlanner(ctx)` (`packages/server/src/tools.ts`),
so the plan comes from the calling agent's own session (`agents.plan_id`) and can never be named by the
caller. It returns `{ url, revision }` where `url` is the viewer page
`/w/:ws/plans/:planId/artifacts/:key` — a stable URL, valid after the plan is submitted or discarded,
because it needs only the workspace and plan id.

### 4. One durable card per `(plan, key)`, updated in place on republish

On first publish the handler writes a `type: 'card'` message part into the plan's existing thread via
`threads.outbound(actor, plan.threadId, body, { parts })` and the service stores that message id on the
artifact row (`plan_artifacts.card_message_id`). A republish replaces that message's part through a new
narrow `threads.setMessageParts(messageId, parts)` — one card, carrying the current revision, at the
point it was first published.

*Alternatives rejected:* appending a card per publish duplicates the card and contradicts the spec's
"no second card"; relying on the UI to dedup by key leaves duplicate rows and only reflects a new
revision if the UI re-reads, and it conflicts with the decision-card convention where a card part is
the durable anchor. `setMessageParts` is deliberately narrow (parts must be plan-artifact cards for a
plan thread), so it can never rewrite human text.

The card part is `{ type: 'card', title, body, actions: [{ key: 'open', label: 'Open artifact' }],
ref: { kind: 'plan-artifact', planId, key, revision } }`. `packages/render/src/parts.ts` gains
`planArtifactCardPartsOf` beside `decisionCardPartsOf`, and `ChatConversation` gains an optional
`renderPlanArtifactMessage` the Plan tab supplies; the card's open action navigates to the viewer URL.
The raw body comes only from the serving route, never from the part.

### 5. Serving under a workspace-level `/plans/:planId/artifacts/...` group

New `packages/server/src/routes/plans.ts` registered as `ws.route('/plans', planArtifactRoutes())`:
`GET /api/w/:ws/plans/:planId/artifacts` (list), `.../:key/revisions`, and
`.../:key/raw?revision=` behind `requireOperator` and `ARTIFACT_CSP`. The service resolves the artifact
by `plan_id` within the workspace, so a key stored under another plan or workspace is `not_found`.

*Alternative rejected:* nesting under `/projects/:id/plans/:planId/artifacts` — a link pasted into a
draft description would then need the project id as well, and the plan tab already knows the plan id.
The workspace-level group mirrors the existing workspace-level `/artifacts` group.

### 6. Collapse is component state keyed by draft id; the summary fallback is a pure render function

`PlanTab` holds an `expanded: Set<string>` of draft ids (empty = all collapsed). Because it is keyed by
draft id and never derived from the fetched list, a refetch (planner edit, captain edit, live event)
leaves each card's state alone. The compact facts and the per-card controls (move, edit, dispatch,
delete, tier) stay on the collapsed header; expansion reveals the full description.

`draftSummary(draft)` lives in `packages/render/src/planDrafts.ts`: the stored summary, else the
description's first sentence. It is pure and unit-tested, following the convention that a harness
which cannot measure layout should test the model instead.

*Alternative rejected:* persisting collapse state server-side or in `localStorage` is not asked for and
would add an endpoint or device state for a display preference.

### 7. The summary has a shared cap and is display-only

`PLAN_DRAFT_SUMMARY_MAX` (in `packages/shared`) bounds the summary; `PlanningService.addDraft`/
`updateDraft` enforce it so both the MCP tools and the HTTP `PATCH` are covered, and the message names
the cap. `plan_drafts.summary` is nullable (migration `0058`), so existing drafts fall back to their
description's first sentence with no backfill. The created ticket's `description` is unchanged; the
draft summary is not copied onto the ticket (proposal Non-Goals).

## Risks / Trade-offs

- **A race rewriting a card message.** Two publishes for one key would both try to update the same
  message. Mitigation: `put` runs in the existing `tx`, plan mutation is per-plan and the planner is a
  single sequential session; the second update simply writes the newer part.
- **Renderer weakening the sandbox.** The card could tempt an inline render. Mitigation: only
  `ArtifactViewer` (an iframe over the raw route) is used; the part carries no HTML and the test
  asserts the framed URL.
- **`setMessageParts` growing into a general message editor.** Mitigation: it accepts only a
  plan-artifact card part and refuses anything else.
- **Collapsed cards hiding captain's inline controls.** Mitigation: every existing control stays on the
  header; expansion is additive. Tests assert edit/reorder/delete on a collapsed card.
- **Migration order.** `0057`/`0058` follow `0056`; both are additive and need no backfill. Rollback is
  reverting the release — the new tables and column are inert to the previous code.

## Migration Plan

1. Add `0057_plan_artifacts.sql` and `0058_plan_draft_summary.sql`; existing rows are untouched.
2. Land code, tools, routes, prompts and UI in one change; no feature flag, because the tools/routes are
   additive and nothing existing changes behavior.
3. Deploy through the normal release upgrade. Rollback is the previous release; no data migration to
   undo.

## Open Questions

- Whether a draft's summary should seed the real ticket's own `summary` at creation is deferred: it
  does not change the specs, the approach or the task list, and can be a follow-up if captain wants it.
