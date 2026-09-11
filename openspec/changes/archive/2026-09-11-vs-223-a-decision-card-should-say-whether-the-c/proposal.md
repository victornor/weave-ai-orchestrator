## Why

Captain can approve a plan or a merge seconds after the card appears, before the conductor has read it. That chain has caught real mistakes (VS-216's contradictory migration, VS-217's smallest cell losing the ticket number) and is silently skippable: twice on 2026-09-11 (VS-220, VS-221) the merge was granted while a "hold on" was still being written. The card must say whether the conductor has looked, and put a concern next to the buttons when there is one — without becoming a gate, and without a mark so cheap it is always green.

## What Changes

- Plan, merge, and action approval decisions carry a conductor review state with three values: **not looked at yet** (the default), **looked at**, and **looked at, with concerns**. The concern text, when present, lives on the decision so it can sit on the card.
- The state is **asserted**, not derived: the conductor marks a decision after actually reading it, via a dedicated conductor-only tool. Being woken, mentioning the ticket, commenting, or ending a turn never flips it. Timestamps are kept so a mark that lands after the human already answered is visibly after the fact, not indistinguishable from a prior look.
- Every surface that renders a decision as a card shows the state. **Three states, three visible renderings** — understated for a clean look, loud for unseen, loudest for concerns. No state is conveyed by absence (a blank line would collapse "looked, nothing to flag" into "has not looked yet", which is the distinction this ticket exists to make; same shape as VS-217's default-tier tag). Exact copy:
  - unseen: `Conductor hasn't looked yet`
  - looked: `Conductor looked` (always rendered; quiet tone, never omitted, never a green sign-off)
  - concerns: `Conductor looked — has concerns` plus the note next to the buttons
- Standing instruction if the mark degenerates: raise the cost of a clean look — do not start inferring.
- **Never a gate.** Answering stays possible at any moment, with no added latency, no 409, no queue on review state. Existing option keys, YOLO, auto-merge, and who may answer what are unchanged.
- Hire, discard, retry, question, concern, and gate-finding cards do **not** carry it: those are not the "conductor looks over worker output, then you approve" chain, and stamping them would make the mark always-green.

## Capabilities

### New Capabilities

- `human-decisions/conductor-review`: the review state, who may assert it, which decision kinds carry it, that it is never a gate, that a later mark stays after-the-fact, and what keeps it from becoming a rubber stamp.

### Modified Capabilities

- `human-decisions/option-cards`: a plan, merge, or action approval card shows the conductor review state as three visible renderings (none by absence), shows the concern next to the buttons when there is one, and distinguishes a look that arrived after the answer from one that arrived before.

## Impact

- `packages/shared` — review status enum, fields on `Decision`, `ac_decision_review` on `CONDUCTOR_TOOLS`, `decision.updated` event.
- `packages/db` — `ALTER TABLE decisions` adding review columns (leaf table; no CHECK rebuild). Existing rows read as not-looked-at.
- `packages/core` — `decisions.review()`; answer path must not read the new fields. Conductor prompt/skill: mark only after reading; do not batch-stamp.
- `packages/server` — MCP handler (conductor-only); GET already returns the row. SSE `decision.updated` so an open card refreshes live.
- `packages/render` — shared review copy on `CardModel` so TUI and CLI `conductor decision show` do not drift from the web.
- `packages/ui` — `DecisionCard` (chat, Needs you, ticket page) shows the line; `invalidateFor` patches on `decision.updated`.
- `packages/tui` / Telegram — pick up the same copy; Telegram does not grow a second set of Approve buttons when a later review arrives.
- `docs/PLAN.md` §6.1 / §15 — the new columns and that the card informs, it does not withhold.
- **Out of scope:** a new approval step, conductor accountability for correctness, changing who may answer, auto-deriving the mark from activity.
