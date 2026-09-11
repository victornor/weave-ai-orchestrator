## 1. Shared model

- [x] 1.1 Add `CONDUCTOR_REVIEW_STATUSES = ['unseen','looked','concerns']` to `packages/shared/src/enums.ts` and four fields on `Decision` (`conductorReviewStatus`, `conductorReviewedAt`, `conductorReviewNote`, `conductorReviewedByAgentId`). Add `reviewIsAfterAnswer(d)` (strict `reviewedAt > answeredAt`). Verify shared tests cover the three statuses, the helper's true/false/equal-timestamp cases, and that a `question` Decision factory still typechecks without the fields being required at construction — default them to `unseen` / nulls in test factories.
- [x] 1.2 Add `ac_decision_review` to `CONDUCTOR_TOOLS` and `decision.updated` to `EVENT_TYPES`. Verify `tools.test.ts` lists the new tool on conductor and not on `COMMON_TOOLS`, and that `EVENT_TYPES` includes `decision.updated`.
- [x] 1.3 Export `conductorReviewCopy(d)` from `packages/shared` (or `packages/render` if it must sit next to `CardModel`) returning `{ line, note, tone } | null` with the exact copy in design.md Decision 5. Verify: each carrying kind × `{unseen, looked, concerns}` × `{open, answered-prior, answered-after}` returns a **non-empty** `line` (never `null`, never `''` — a clean look is understated, not absent); `null` only for `question` / `hire_approval` / `retry_approval`; `looked` copy never contains "signed off", "approved by", or a checkmark character; tones are `unseen` loud, `looked` understated, `concerns` loudest.

## 2. Persistence and service

- [x] 2.1 Add `packages/db/src/migrations/0025_decision_conductor_review.sql` (`ALTER TABLE decisions` four columns; `conductor_review_status NOT NULL DEFAULT 'unseen'`). Verify `migrations.test.ts`: a pre-migration row survives and reads `conductorReviewStatus: 'unseen'` with null timestamp/note/agent; a post-migration insert of each carrying kind round-trips the four fields. No table rebuild, no `-- ac:foreign_keys_off`.
- [x] 2.2 Implement `decisions.review(actor, id, { status, note })` per design.md Decision 3. Verify in `decisions.test.ts`: conductor can mark looked and concerns on plan/merge/action, open or answered; concerns without a note is refused; note > 500 chars is refused; worker actor is `forbidden` and the row is unchanged; excluded kinds are `validation`; superseded/withdrawn/expired are `wrong_status`; looked clears a previous note; each mark sets a fresh `reviewedAt`; emit `decision.updated` with the full Decision; no wake is enqueued.
- [x] 2.3 Assert the answer path is unchanged. In `decisions.test.ts` (and the existing plan/merge apply tests): answering `approve` on an unseen `plan_approval` and on a concerns `merge_approval` both succeed, write the same `answerKey` / ticket transition they do today, and leave the review columns exactly as they were. The `answer()` body MUST NOT branch on review fields. YOLO auto-approve still fires without a mark (`yolo.test.ts` still green, review stays `unseen`).

## 3. MCP, events, channels

- [x] 3.1 Wire `ac_decision_review` in `packages/server/src/tools.ts` to `decisions.review`. Verify a conductor actor succeeds and a worker actor gets the conductor-only 403 with no row change.
- [x] 3.2 `invalidateFor` treats `decision.updated` like `decision.answered` (patch decision caches, `qk.decisions`, `qk.decision`, `qk.briefing`, `qk.workspaces`). Verify in `events.test.tsx`.
- [x] 3.3 Channel manager: on `decision.updated` with `status === 'open'` and `conductorReviewStatus === 'concerns'`, send a text follow-up on the primary thread; never call `pushDecisionCard` for an id already in `cardsSent`. Verify: a second answerable card is not sent; a concerns update produces one outbound text message; a looked update produces none.

## 4. Cards

- [x] 4.1 `decisionToCard` includes `conductorReviewCopy` as body lines (label `Review`, then the note when present). Verify `packages/render/src/decision.test.ts`: plan/merge/action cards show the line; a question card does not; after-the-fact wording appears only when `reviewIsAfterAnswer`; option keys are still exactly `NAMED_CARD_OPTION_KEYS` for each named variant (existing key tests unmodified).
- [x] 4.2 Web `DecisionCard` renders the copy above the button row (concerns note is a text block, not a `Badge`). Verify in `components.test.tsx`: unseen plan shows "Conductor hasn't looked yet" with Approve/Revise/Reject still sending the real keys; looked merge **shows** "Conductor looked" (getByText — not a blank) with understated classing and still Approve merge / Request changes; a looked card and an unseen card are distinguishable by the text present; concerns shows the note next to the buttons and approve still fires; after-the-fact answered card uses the after copy; a question card has no review line; compact chat cards still show the line (not behind an expander). Existing named-variant key tests pass unmodified.
- [x] 4.3 Chat, Needs you, and TicketPage all pass the Decision through unchanged (no extra prop required if the fields are on `Decision`). Verify one test per surface that an unseen plan card is visible there. TUI `DecisionCard` / `printCard` pick up the render body lines with no second copy table.

## 5. Prompt and docs

- [x] 5.1 `templates/conductor.AGENTS.md.tmpl`: when an open plan/merge/action approval is in inbox or digest, read it, then `ac_decision_review`; do not mark at turn start or in batch; a clean look is not an endorsement; never `ac_decision_answer` those kinds (keep the existing never-answer rule). Check `templates/worker.AGENTS.md.tmpl` does **not** mention the tool (workers cannot call it). Verify the conductor template contains `ac_decision_review` and the worker template does not.
- [x] 5.2 `docs/PLAN.md` §6.1 / §15: the four columns on `decisions`, that the card informs and does not withhold, and that the mark is asserted. `docs/API.md`: `Decision` fields and `ac_decision_review`. No ADR unless apply finds a PLAN conflict.

## 6. Verification

- [x] 6.1 `pnpm lint && pnpm typecheck && pnpm test` at the repo root. Paste **both** suite blocks verbatim on the ticket (core/server and UI separately; do not add them, do not retype, do not report UI numbers as "both").
- [x] 6.2 Confirm existing approval behaviour: the pre-existing DecisionCard named-variant key tests, YOLO tests, and merge-approval "no Hold" tests pass unmodified — acceptance 6.
