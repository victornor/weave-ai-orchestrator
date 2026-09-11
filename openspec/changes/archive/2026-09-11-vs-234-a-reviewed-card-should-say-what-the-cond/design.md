## Context

VS-223 shipped the conductor review state: three values (`unseen` / `looked` / `concerns`) on plan, merge and action approvals, asserted only by the conductor through `ac_decision_review`, rendered by one copy table — `conductorReviewCopy()` in `packages/shared/src/conductor-review.ts` — that web (`DecisionCard`), TUI and CLI (`decisionToCard`) all cite. `concerns` has always required a non-empty note; `looked` takes none and its copy is the activity "Conductor looked". `conductorReviewNote` is a single nullable column (≤500 chars) shared by the marks. No HTTP write path exists for the mark; the MCP tool schema (packages/server/src/tools.ts) and the core service (`decisions/review()`) are its only doors. See proposal.md for why the clean mark must now carry the conclusion and its reason.

## Goals / Non-Goals

**Goals:**

- The clean mark costs the conductor a written reason, enforced at both doors (tool schema, service).
- The card shows the conclusion and, for marks made after this change, the reason beside the buttons — from the same one copy table, so no surface drifts.
- Marks made before this change keep rendering sensibly with zero migration.

**Non-Goals:**

- No fourth state, no new carrying kinds, no gate/queue/latency on answering (existing no-gate tests keep passing untouched).
- No derivation of the mark from activity — the standing instruction carries forward.
- The "ticket filed by the conductor shows as reviewed" idea: not built, pending captain's reaffirmation (pushed back on the ticket).

## Decisions

**Copy: `Conductor reviewed — no concerns`, not "approved".** The conductor's mark asserts "I examined this and found nothing to object to"; the human is the approver. "Approved" would claim an act the conductor does not perform and would reopen the exact confidence-manufacturing VS-223 exists to prevent — while "reviewed — no concerns" is a conclusion (an outcome, not a log entry), pairs with "has concerns", and stays inside what was asserted. Captain's ask is still met: the decision-relevant content (what was concluded and why) now sits beside the button, so nothing needs hunting in chat. After-the-fact variants keep the same shape as today: `Conductor reviewed after you answered — no concerns` / `— has concerns`. Unseen becomes `Conductor hasn't reviewed yet` so the three lines share one verb.

**The note is required, not encouraged.** `review()` in `packages/core/src/decisions/service.ts` validates the note for `looked` exactly as it does for `concerns` (trim → non-empty → ≤ `CONDUCTOR_REVIEW_NOTE_MAX`, stored in the same `conductorReviewNote` field, replacing whatever a previous mark left). The MCP schema makes `note: z.string().min(1)` required so the conductor gets an immediate tool-argument error rather than a service round-trip. This is the ticket's central reconciliation: the conclusive wording stays honest because a sentence of reasoning is not cheap the way a reflexive tick is. Rejected alternative: keep the note optional and only change the copy — that is the degenerate mark with louder words, which the ticket explicitly rules out.

**No migration for legacy marks.** Old `looked` rows carry `conductorReviewNote: null`; `conductorReviewCopy` already returns `note: d.conductorReviewNote ?? null` and both renderers already skip an absent note. The conclusive line renders without a note — honest about when the mark was made. No `ALTER TABLE`, no backfill (backfilling invented notes would fabricate reasoning nobody wrote).

**Renderers stay generic.** `ConductorReviewLine` (packages/ui) and `decisionToCard` (packages/render) already render whatever note the copy table returns; no component code changes. Tone classes and the loud-unseen/loudest-concerns hierarchy stay as VS-223 shipped them — this change alters words and requirements, not styling.

**Conductor guidance updated in all three places at once.** The same instruction lives independently in `templates/conductor.AGENTS.md.tmpl`, `skills/agent-conductor-conductor/SKILL.md` and `skills/agent-conductor-worker/references/tools.md` (the VS-211 drift pattern), plus the tool description in packages/server/src/tools.ts. All four say: both marks need a note; the clean note is what you would have written in chat; still never at turn start, never in a batch, never an answer.

**Docs updated where the old contract is stated:** `docs/PLAN.md` (§6.1 decisions fields/note column, §9 `ac_decision_review` line, §15 presentation paragraph) and `docs/API.md` (decision fields paragraph, MCP tool input shape).

## Risks / Trade-offs

- [Every clean mark now costs the conductor a sentence] → That cost is the mechanism, not a risk to mitigate away; the guidance says what a good note is (the chat sentence, reused). If notes degenerate into filler ("looks fine"), the standing instruction's next escalation applies — raise the cost again, never infer.
- [Old and new clean marks read slightly differently (note vs no note)] → Accepted; the spec pins the sensible no-note rendering, and the difference is truthful about when the mark was made.
- [Exact copy strings are pinned by tests in four packages] → The strings live in exactly one function; the shared copy-table test is the single source of truth and the other suites assert surface behaviour through it.

## Migration Plan

None. No schema change; deploy is the routine `conductor daemon upgrade` after merge, and rollback is the same path in reverse.

## Open Questions

None. The captain-filed-ticket provenance idea is parked by the ticket itself, not by this design.
