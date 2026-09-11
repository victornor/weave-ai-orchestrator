## 1. Shared: the copy table

- [x] 1.1 `packages/shared/src/conductor-review.ts` — rewrite `conductorReviewCopy`'s lines to the conclusive copy: unseen `Conductor hasn't reviewed yet`; clean `Conductor reviewed — no concerns` / `Conductor reviewed after you answered — no concerns`; concerns `Conductor reviewed — has concerns` / `Conductor reviewed after you answered — has concerns`; the clean branches return `note: d.conductorReviewNote ?? null` (shown when present, absent for legacy marks). Verify: `packages/shared/src/conductor-review.test.ts` updated and green — exact-copy assertions for all five renderings, the non-endorsement guard (`no /signed off|approved by|✓/`), the legacy no-note clean mark returning `note: null` with a non-empty line, and tones unchanged.

## 2. Core: the note is required on both marks

- [x] 2.1 `packages/core/src/decisions/service.ts` `review()` — validate the note for `looked` exactly as for `concerns` (trim, non-empty → `validation`, ≤ `CONDUCTOR_REVIEW_NOTE_MAX`), store it in `conductorReviewNote` replacing any previous mark's note. Verify: `packages/core/src/decisions/decisions.test.ts` — clean mark without/whitespace-only note refused with state unchanged; clean mark with note stores the trimmed note; a clean mark after a concern replaces the note; note >500 chars refused on the clean path too.

- [x] 2.2 Keep the existing no-gate and after-the-fact assertions true: the `answers an unseen plan_approval and a concerns merge_approval on the same path` test and the after-the-fact reviewedAt tests pass unmodified in behaviour. Verify: full `decisions.test.ts` green.

## 3. Server: the tool door

- [x] 3.1 `packages/server/src/tools.ts` `ac_decision_review` — `note: z.string().min(1)` required for both statuses; description rewritten: both marks need a note, the clean note is the one or two sentences you would have written in chat, still never at turn start, never in a batch, never an answer, and a clean mark is not an endorsement. Verify: conductor prompt render test (`render.test.ts` `ac_decision_review` presence) still green; a tool-call without `note` fails zod validation.

## 4. Surfaces: cards show the conclusion and the reason

- [x] 4.1 `packages/render/src/decision.test.ts` — update expected body lines to the new copy; add: a clean mark with a note renders the note line under the Review line; a legacy clean mark renders only the line. Verify: `pnpm vitest run packages/render` green.

- [x] 4.2 `packages/ui` — no component change expected (`ConductorReviewLine` already renders `copy.note`); update VS-223 test expectations to the new copy in `components.test.tsx`, `chat.test.tsx`, `needsyou.test.tsx`, `ticketpage.test.tsx` and add in `components.test.tsx`: a clean mark with a note shows the note beside the buttons; a clean mark without one renders the line alone; answering on a reviewed card is unaffected (same keys, immediate). Verify: `pnpm --filter @agent-conductor/ui exec vitest run` green.

## 5. Guidance and docs, kept in sync

- [x] 5.1 Update the conductor-facing instruction in all four places so they cannot drift: `templates/conductor.AGENTS.md.tmpl`, `skills/agent-conductor-conductor/SKILL.md`, `skills/agent-conductor-worker/references/tools.md` (tool signature: note required), and the `ac_decision_review` description in `packages/server/src/tools.ts` (done in 3.1 — re-read all four together before finishing). Verify: grep for `looked` across the four files shows no stale "looked = you read it and have nothing to flag" phrasing.

- [x] 5.2 `docs/PLAN.md` — §6.1 decisions paragraph (clean mark requires the note; card shows the note), §9 `ac_decision_review` line (note required, ≤500), §15 presentation paragraph. `docs/API.md` — decision-fields paragraph and the MCP tool input shape (`note` no longer optional). Verify: grep both files for `note?` / `concerns requires` staleness.

## 6. Whole-repo checks

- [x] 6.1 `pnpm lint && pnpm typecheck` green. Verify: both commands exit 0.
- [x] 6.2 `pnpm test` green — post **both** suite blocks verbatim with their real totals (core/server suite and the UI suite, never one number for both).
