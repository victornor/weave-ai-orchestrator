## 1. Shared: document-target parser

- [x] 1.1 Add `packages/shared/src/decision-target.ts`: `documentTarget(d: Pick<Decision, 'target'>): { documentId: string; revision?: number } | null` — `documentId` must be a non-empty string, `revision` a number when present, anything else (null target, empty object, wrong-typed values, empty-string id) returns `null`; export from the package index. Verify tests cover: full `{ documentId, revision }` target; revision-less target; `null` target; `{}`; non-string `documentId`; non-number `revision`.

## 2. Core: read a ticket document by id

- [x] 2.1 Add `tickets.getDocumentById(ticketId, documentId, revision?)` to `packages/core/src/tickets/service.ts` returning `{ key, documentId, revision, currentRevision, body, createdAt } | null`: document row joined against the ticket id, `revision ?? currentRevision`, `null` when the document or the named revision does not exist. Verify in `tickets.test.ts`: HEAD read returns key and currentRevision; an earlier revision's body is returned at that revision; `null` for another ticket's document id; `null` for an unknown id; `null` for a revision that never existed.

## 3. Server: route, routetable, API doc

- [x] 3.1 Add `GET /tickets/:id/documents/by-id/:documentId?revision=` in `packages/server/src/routes/tickets.ts`, registered **before** `GET /tickets/:id/documents/:key` so `by-id` is never read as a key; `not_found` when the service returns null. Add the row to `routetable.ts` and the entry to `docs/API.md` (tickets section). Verify a route test: reads a document by id; `?revision=` returns that revision; unknown id is `not_found`; the existing key route still answers.

## 4. UI: hook and preview component

- [x] 4.1 Add `TicketDocumentById` to `packages/ui/src/api/types.ts` (`key, documentId, revision, currentRevision, body, createdAt`), a `useTicketDocumentById(ticketId, documentId)` hook, and a second query for a named revision enabled only when the target revision is behind HEAD; add the `qk.ticketDocumentById` key. Verify the hook module typechecks and the key is added alongside `ticketDocument`.
- [x] 4.2 Add `packages/ui/src/components/DocumentPreview.tsx`: returns null when `documentTarget(decision)` is null; loading → skeleton rows; unreadable document → dashed notice line; current == target → full body (Markdown) in a scroll-capped region, `r{n}` badge, expand/collapse control (default expanded for an open decision, collapsed when inert); current > target → "revised since" banner + target revision's body labelled `r{target} (superseded by r{current})`; target revision missing → notice naming both revisions, no body. Verify component tests for each case with the hooks module mocked.

## 5. Card integration (acceptance 1–5)

- [x] 5.1 In `DecisionCard.tsx`: extend the local `Target` interface with `documentId?: string; revision?: number` (typing only), extract the existing plan-slot gate into `planSlot` (`decision.kind === 'plan_approval' && !inert ? plan : null`) rendering it where the slot renders today, and render `<DocumentPreview decision={decision} />` when `documentTarget(decision)` parses **and** `planSlot` is not rendering — no new kind check; a document never renders twice on one card (design Decision 6). Update the file's `vi.mock('../api/hooks')` to supply `useTicketDocumentById`. Verify in `components.test.tsx`: an `action_approval` with `{ documentId, revision: 2 }` shows the body text and the `r2` badge and offers the document control (acceptance 1–2); a `question` decision with the same target shape shows the same preview (acceptance 3); decisions without a document target (merge with CI, retry with context) render exactly as today with no document region and the by-id hook never called (acceptance 4); the superseded case shows the banner and the labelled old revision, never as current (acceptance 5).
- [x] 5.2 Verify a plan approval renders its plan exactly once: an open `plan_approval` with `target: { documentId, revision: 1 }` and `plan={<PlanPreview/>}` shows the plan through the slot and the general preview renders nothing for it (no second body, by-id hook never called); and an answered `plan_approval` with the same target shows the collapsed record preview through the general path. This is the assertion that would have caught the double render.

## 6. Copy

- [x] 6.1 In `raiseActionApproval`: repaired context → "Review the action document below — approve to run it; revise to send feedback; reject to cancel. (Re-raised: the previous approval was lost — this card is the one to answer.)"; unrepaired → "Review the action document below — approve to run it; revise to send feedback; reject to cancel." Leave the plan/merge repair copy untouched. Verify core ticket tests are green (none pin the old strings).

## 7. Verification

- [x] 7.1 `pnpm lint && pnpm typecheck && pnpm test` at the repo root. Paste **both** suite blocks verbatim on the ticket (core/server and UI separately; do not add them, do not retype, never report one block as "both").
