## Context

`weave_ticket_attachment_put` (VS-502) stores a file against a ticket under a generated name, with an
authenticated ticket-scoped route, and the ticket page already renders those attachments in its
`AttachmentsSection`. Nothing on a decision card renders them. The V2 card (`V2DecisionCard`) is the
live card for Needs you and the chat pane; the V1 `DecisionCard` is still mounted on the ticket page
for the retry, plan and merge cards. Both already receive the decision's `ticketId` and the workspace,
and the ticket detail response already carries `attachments` with a ready relative `url`, so no new
API is needed.

Two other facts shape the design. The attach tool's path allowlist is the outbound-chat allowlist:
knowledge, project clones and worker `work/` worktrees. The project's worker rules tell a worker to
keep captures in its home or a temp directory and to leave `work/` clean, so the sanctioned capture
location is exactly the one the tool refuses. And an attachment row carries no revision or commit —
only the ticket id and `created_at` — while the plan/action approvals target a *document* revision and
a merge approval carries no reliable head at render time.

## Goals / Non-Goals

**Goals:**

- Show a ticket's attachments on its plan, merge and action approval cards, on every card surface.
- Keep a card for a ticket with no attachments pixel-identical to today.
- Make attaching rendered evidence the easy, discoverable path for a worker.
- Give a non-image attachment an honest presence (label + download), never a silent drop.
- Record the revision-scoping decision and its reasoning.

**Non-Goals:**

- Revision- or commit-scoping the attachments shown on a card (see Decision 1).
- Widening the outbound *chat* attachment allowlist, or letting agents read arbitrary host paths.
- Changing the serving route, the `ticket_attachments` schema, or artifact data-URI handling.
- Rendering images on non-web surfaces (CLI/TUI/Telegram); they keep the decision as data and there is
  no attachment model on the decision to carry.

## Decisions

### 1. Attachments are ticket-scoped and shown newest first, not revision-scoped

A card shows the ticket's attachments, newest first, each labelled with its capture time. It is not
filtered to the document revision (plan/action) or the commit (merge) under approval. The alternative
— strict scoping — needs two things that do not exist: a revision/commit on each attachment, recorded
when it is attached, and a reliable revision or head on each of the three kinds at render time. Plan
and action approvals point at a document *revision*, which has no attachment set; a merge approval's
`target` carries CI/PR stats or an archive shape, not a head sha at raise time (`weaverReviewedHeadSha`
is the head the weaver reviewed, which is not necessarily the head being approved).

Adding that plumbing would expand the attachment contract and the attach path for every kind to solve
a presentation problem, so this change does not. The reported harm — a capture from three revisions
ago sitting next to Approve — is mitigated by ordering and labelling: the freshest evidence is first,
every item states when it was captured, and a worker asking for approval attaches the current render.
If captain wants strict scoping after seeing this, it is a follow-up that adds a revision/commit to
`ticket_attachments` and to the approval payloads.

### 2. One shared presentation component, each card fetching ticket detail

A presentational `TicketEvidence` component owns the strip: image previews, non-image download rows,
and the full-size viewer. It renders only when it receives a non-empty list, so the empty case costs
no markup and no layout.

Both card builders use it. `V2DecisionCard` enables its existing `useTicketFor(ws, ticketId, …)` query
for the three approval kinds (today it is enabled only while the held-revision row is on screen) and
renders `TicketEvidence` from `detail.data.attachments`. The V1 `DecisionCard` on the ticket page does
the same for its three approval mounts. TanStack dedupes the two queries by ticket key, and the
`ticket.attachment` event already invalidates `qk.ticket(ws, id)`, so a new attachment appears without
extra live-update plumbing.

Image-ness is decided with `mediaType.startsWith('image/')`, matching the serving route's inline
decision and the ticket page's existing section. Today that is equivalent to the strict four-type
`isAttachmentImageType`, because `guessOutboundMediaType` only ever produces `image/*` for those
raster extensions; matching the route keeps the thumbnail and the `Content-Disposition` in agreement.

### 3. Allow the acting worker's own home as an attach source; do not widen the chat allowlist

`putAttachment` resolves its roots for the ticket case as the existing outbound roots plus the acting
agent's own home (`workers/<agentId>`, or `archive/workers/<agentId>` for a retired one). The
shared `resolveOutboundAttachmentRoots` is left alone, so `weave_human_send`'s chat boundary is
unchanged; the acting-agent home is resolved from the actor in the ticket service. Another agent's
home, and the workspace root, remain refused. This makes the file a worker was told to save (a render
in its home, outside `work/`) the file it can actually attach.

The tool description and the worker skill both direct the agent to attach rendered evidence to the
ticket so the approval card shows it.

A worker home is not a safe directory to read from wholesale: it holds the runtime's config, and some
of that config symlinks into the owner's own config (opencode's runtime config links to
`~/.config/opencode`). The home allowance is therefore guarded, not merely prepended to the root
list. The candidate and the home root are both compared **after** `realpath`, so a symlink under the
home that resolves outside it is refused by the existing containment check rather than by a lexical
prefix. On top of that, a path that resolves under the acting home but not under one of the
pre-existing roots (knowledge, a project clone, a worktree) is refused when any path segment relative
to the home starts with `.` — which closes `.config/opencode`, `.claude`, `.codex`, `.cache` and every
other dot-prefixed runtime tree, and a hidden symlink cannot be used to reach one. The guard is
skipped for a worktree path, so VS-502's worktree allowance keeps its existing rules. A test plants a
symlink in a home pointing outside it and asserts the attach is refused.

### 4. A non-image keeps its identity as a labelled download

A `zip`, video (which the outbound mapping reports as `application/octet-stream`), or log renders as a
row with its label, media type and byte size and a download link to the existing authenticated route,
which already sets an attachment `Content-Disposition` for non-images. It is never filtered out of the
evidence list.

### 5. Full size is an overlay, not a navigation

Clicking a preview opens the image in an overlay rendered through a portal (the pattern `Sheet.tsx`
already uses, which escapes the card's own transform/overflow from its entry animation), dismissable
by click or Escape, with a control to open the raw URL in a new tab. The overlay uses the existing
token classes so it is correct in light and dark and at phone width.

## Implementation Areas

- `packages/ui/src/components/`: the new shared `TicketEvidence` strip and its full-size viewer.
- `packages/ui/src/v2/DecisionCard.tsx`: enable the ticket query for the three approval kinds and
  render the evidence; covers Needs you and the chat pane.
- `packages/ui/src/components/DecisionCard.tsx`: render the evidence on its approval mounts; covers
  the ticket page.
- `packages/core/src/tickets/service.ts` and `packages/core/src/threads/outboundAttachments.ts`: an
  acting-agent-home root for the ticket attach path, without touching the shared outbound roots.
- `packages/server/src/tools.ts`: the tool description.
- `skills/weave-ai-worker/SKILL.md`: the attach-evidence instruction.
- Tests: `packages/ui/src/test/*` for the strip and the card surfaces, core ticket tests for the
  allowlist, and the existing agent-prose guard (`packages/shared/src/tools.test.ts`).

## Risks / Trade-offs

- Enabling `useTicketFor` for every approval card adds one ticket-detail read per card (deduped per
  ticket). It is a small payload and the same read Needs you already makes for the ticket row; the
  alternative — putting attachments on the `Decision` payload — widens the decision contract and the
  SSE stream for a display concern.
- Ticket-scoped evidence can include captures from an earlier round. Ordering newest-first and
  labelling each with its age is the chosen mitigation; strict scoping is deferred with the reason
  above.
- The home-directory allowance lets a worker attach any file in its own home to its own ticket. That
  is the intended affordance; other agents' homes and the workspace root stay refused.
