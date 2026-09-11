## Context

`raiseActionApproval` (packages/core/src/tickets/service.ts:262) writes `target: { documentId, revision }`. The web card (`packages/ui/src/components/DecisionCard.tsx:45`) casts `decision.target` into a `Target` interface with no `documentId`, so the one thing the human is told to review is unreachable. The action document lives in `ticket_documents` under key `action`; the existing read path is `GET /tickets/:id/documents/:key?revision=`, keyed by key, not by document id. The TUI's `decisionToCard` already shows `Document <id>` and `Revision <n>` rows — the id at least is named there, but the web card shows nothing at all.

`PlanPreview` is the in-card precedent: plan approvals render their document through a fetch + collapsible block, collapsed by default, HEAD revision. This change follows that pattern where it fits and departs from it where the ticket says to.

## Decision 1 — the card fetches by document id, and a read route is added for that

`GET /tickets/:id/documents/by-id/:documentId?revision=` → `{ key, documentId, revision, currentRevision, body, createdAt }` (`not_found` when nothing matches). Registered **before** `GET /tickets/:id/documents/:key` (Hono matches in registration order) so `by-id` is never consumed as a key.

Why not reuse the key route: the target carries no key, and inventing one would either special-case `action` in the UI (forbidden — the rendering must be target-driven) or require the daemon to start writing `key` into targets — which would fix nothing already stored. The approval that prompted this ticket is open in the database right now, carrying only `{ documentId, revision }`; after upgrade it must render. Reading by id fixes every decision already raised and needs zero changes to what the daemon writes ("nothing needs storing" — the ticket's own finding). The response returns the document's `key` and `currentRevision` so the card's staleness check costs one request.

Scoping: the document id is looked up joined against the ticket id, so a card can never read another ticket's document by guessing an id.

## Decision 2 — "link to the full document" is an in-card control, because no document page exists

Nothing in the web app renders a ticket document besides the cards themselves (the ticket page shows only knowledge-usage documents), so there is nothing to deep-link to. Building a document-viewer page is a new surface beyond this ticket's scope ("the decision card's ability to render a document target"). The implementation of "render the action inline, and link to the full document as well" is therefore: the body renders **on the card** in a scrollable region (open by default — one tap less than the plan's collapsed preview, because the human should not have to tap to know what they are agreeing to), and an expand/collapse control on the card is the permanent way to reach the complete text without leaving it. **This is the one interpretation the reviewer should confirm** — if a real deep link somewhere is wanted, that is a small follow-up, and this design's data path (fetch by id) already serves it.

## Decision 3 — the rendering is driven by a parsed target, never by kind

`documentTarget(d)` (new, `packages/shared`) validates the untyped `target` record: `documentId` a non-empty string, `revision` a number when present; anything else → `null`. `DecisionCard` renders `<DocumentPreview decision={d} />` exactly when the parser returns a target — no `kind` check anywhere, and no call-site changes: chat (pinned and history), Needs you, Global needs and the ticket page all get it because they all render `DecisionCard`.

`DocumentPreview` reads `decision.status` itself: an **open** decision's document starts expanded (it is what the human is there to judge); an answered/superseded/withdrawn card's document starts collapsed (it is a record). The `plan` slot and `PlanPreview` are untouched.

## Decision 4 — staleness: compare against `currentRevision`, from one request

The card fetches HEAD (no revision param). Four cases:

| case | rendering |
|---|---|
| `currentRevision == target.revision` | body + `r{n}` badge (the normal case; one request) |
| `currentRevision > target.revision` | banner "revised since this was asked — now r{current}", then the target revision's body (second fetch, only here), labelled `r{target} (superseded by r{current})` |
| target revision missing (`404` on the revision fetch, or target > current) | notice naming both revisions, no body |
| document unreadable / decision has no ticket | notice line, never a blank box |

An *open* `action_approval` should never hit the stale case — a new `action` revision supersedes the open decision and re-raises at the new revision — so staleness is a boundary case (history, a lost repair, a future document-carrying kind), rendered honestly rather than optimised away.

## Decision 5 — the re-raise sentence gets a next step, action card only

`raiseActionApproval`'s repaired context becomes: "Review the action document below — approve to run it; revise to send feedback; reject to cancel. (Re-raised: the previous approval was lost — this card is the one to answer.)" The unrepaired copy changes only "Review the action document." → "Review the action document below —" since the document is now on the card. The same suffix lives on the plan/merge repair cards (service.ts, two more sites); those are left alone — same sentence, different ticket, per the brief's "do not expand this ticket to chase it".

## Decision 6 — plan approvals carry a document target too: no double render, suppressed by slot, not kind

Found in review after approval: the premise "today only `action_approval` carries a document target" is false. `plan_approval` targets the plan digest with the same `{ documentId, revision }` shape (service.ts:502, repair path :1063) — the very decision that asked the human to approve this ticket carries one. As originally specified, `documentTarget()` parses for plan approvals and the card would render the plan twice: once through `PlanPreview` (the plan slot) and once through `DocumentPreview`. Acceptance 4's "no document target renders as today" test does not guard this, because plan cards have a target.

Resolution: **a document never renders twice on one card.** The general preview renders when `documentTarget()` parses *and the card is not already rendering the document through a purpose-built slot*. Mechanically, DecisionCard's existing plan-slot gate (`decision.kind === 'plan_approval' && !inert ? plan : null`) is extracted into a value used for both the slot and the suppression — the new code adds no kind check of its own; it consults what the card already renders. A future purpose-built slot suppresses the general preview the same way without this code path changing.

Why not replace `PlanPreview` with the general preview (the other defensible option): plan documents are long OpenSpec digests, so they cannot default-open the way short action documents do — the per-kind presentation rule would return inside the general component, decided by kind through the back door, and the plan slot's copy and behaviour would be rewritten as a wider change than this ticket's scope allows. If a single general renderer is ever wanted, this design's data path (fetch by id, revision-aware) already serves it.

Named consequence, deliberate: an *answered* plan approval's slot does not render (the slot is `!inert`-gated), so the general preview renders there instead — collapsed, revision-labelled, the record of what was approved. That is the same record principle the approved design gives answered action cards, applied consistently.

## Out of scope, unchanged

- `packages/render` / TUI: already names the document id and revision; cannot fetch; untouched.
- Telegram and other pushed cards: no document content there; untouched.
- `PlanPreview` itself, YOLO/answer paths, option keys: untouched. Plan approvals change only in that the plan slot's gate is extracted for reuse and answered plan cards gain the collapsed record preview (Decision 6).

## Risks

- The `by-id` route is workspace-session read of a ticket document — same trust level as the existing key route; scoped by ticket id.
- Old decisions whose `revision` names a pruned revision (none are ever pruned today) fall into the "revision missing" case and say so — honest, not blank.
