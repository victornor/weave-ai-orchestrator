## Why

2026-09-11, on the first real `action_approval` card (a deployment), captain got: "Review the action document. Approve to run it; revise to send feedback; reject to cancel." — with no document named, linked, or shown. The buttons run commands against a host. VS-216 built this gate so the human sees what is about to run *before* it runs; today the gate asks for a judgement and withholds everything needed to make it.

The pointer is already there: `raiseActionApproval` writes `target: { documentId, revision }` on the decision, but the card's `Target` type has no `documentId`, so nothing can read it. Nothing needs storing — the card needs to grow the capability.

## What Changes

- A decision card learns to render a **document target**: when a decision's target carries a document id (and the revision being decided), the card shows that document's content on the card, shows which revision it names, and keeps the complete document reachable from the card. The rendering is driven by the target, not by the decision's kind — and never renders a document that the card already renders through a purpose-built slot: plan approvals also carry a document target (the plan digest, service.ts:502), and their plan slot already shows it. Corrected in review after the plan premise ("today only `action_approval` carries one") proved false; the resolution is recorded in design.md Decision 6.
- The `action_approval` card is the first user: the action document (a short list of commands and a host — closer to the plan case than the PR case) renders inline, open by default, with its revision badge; the card also offers the document expanded/collapsed in place, so the full text is one control away without leaving the card.
- A **superseded document is never shown as current**: when the document has moved past the revision the decision names, the card says so and labels the shown content as the superseded revision; when the named revision no longer exists, the card says that instead of passing off other content.
- One new **read route**, `GET /tickets/:id/documents/by-id/:documentId?revision=`, so the card can follow the id on decisions that are already in the database — including the open approval that prompted this ticket, which predates the change and carries no document key. The daemon writes nothing new.
- **Copy falls out**: the re-raised action card's "(Re-raised: the previous approval was lost.)" gains a next step ("this card is the one to answer"). Only the action card's wording changes; plan/merge repair cards carry the same suffix and are left for their own ticket.

## Capabilities

### Modified Capabilities

- `human-decisions/option-cards`: a decision that targets a document shows that document on its card — content, revision, the superseded case, and that rendering is driven by the target rather than the kind, with an unchanged rendering for decisions that carry no document target.

## Impact

- `packages/shared` — `documentTarget()` parser (target is an untyped record; parse, don't cast).
- `packages/core` — `tickets.getDocumentById(ticketId, documentId, revision?)` returning key, revision, currentRevision and body.
- `packages/server` — the by-id route (registered before `/:id/documents/:key` so `by-id` is never read as a key), `routetable.ts`, `docs/API.md`.
- `packages/ui` — `useTicketDocumentById` hook, `DocumentPreview` component, `DecisionCard` rendering it whenever the target parses. No call-site changes (chat, Needs you, ticket page all get it).
- **Out of scope:** the TUI (`decisionToCard` already shows the document id and revision rows; it cannot fetch) and Telegram push cards; any change to plan-approval rendering; a standalone document-viewer page; how action documents are written or approved.
