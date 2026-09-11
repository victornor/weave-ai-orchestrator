## Context

See `proposal.md` for why. Constraints that shape the approach:

- `Decision` (`packages/shared/src/types.ts`) is the object every surface already fetches. Review state belongs on it, next to `status` / `answeredAt`, not on the ticket: the human is looking at a card for one decision, and a superseded plan must not inherit the previous revision's mark.
- `decisions` is a leaf table. `ALTER TABLE … ADD COLUMN` is the 0013 recipe; a CHECK rebuild (0010/0018/0023) is unnecessary.
- Answering is `decisions.answer()` (`packages/core/src/decisions/service.ts`). That function must not read the new columns. Tests prove an unseen and a concerns decision both answer on the same path, with no wait.
- Human-owned `plan_approval` / `merge_approval` already reach the conductor via the digest (`supervisor`: `decision.created` with `askedInRunId == null`). That wake is the *start* of looking, not the finish — deriving the mark from it would paint every new card "looked at" the moment the conductor is notified, which is exactly when they have not looked.
- Web `DecisionCard.tsx` is hand-rolled; TUI/CLI go through `packages/render`'s `decisionToCard` → `CardModel`. VS-114 is the drift landmine: one helper for the review copy, both renderers call it.
- Telegram `ChannelManager.pushDecisionCard` sends once (`cardsSent`) on `decision.created` and never edits. A later review must not mint a second answerable card.
- `NAMED_CARD_OPTION_KEYS` and named-variant buttons are untouched. YOLO still covers only plan and merge.

## Goals / Non-Goals

**Goals:**

- Three-state review on `plan_approval`, `merge_approval`, `action_approval`, asserted by the conductor, timestamped, visible on every card surface.
- After-the-fact honesty from `reviewedAt > answeredAt`, never a stored "was prior" flag that could be backfilled.
- Answer path behaviour identical to today, asserted by test.

**Non-Goals:**

- A fourth "in progress" state.
- Deriving the mark from activity.
- Telegram message-edit, or a new human notification when a concern lands (the live web card and an optional text follow-up are enough).
- Conductor-owned plan policy (`proposalApproval: conductor`) growing a card the human does not see; the columns still exist on the row, the card requirement applies to cards shown to the human.
- Changing option keys, owners, YOLO, auto-merge, or `ac_ask`.

## Decisions

### 1. Asserted, not derived — and not a hybrid that auto-fills

The mark is an explicit conductor write (`decisions.review()` / MCP `ac_decision_review`). Timestamps are recorded so after-the-fact is visible. Nothing infers the state.

Why not derived from "conductor mentioned the ticket": a digest, a comment, or a hold-on in chat is exactly the proxy that fired during VS-220/VS-221 without being a review, and the inverse (a silent read) would stay unseen forever.

Why not derived from "conductor turn ran after `decision.created`": the digest already wakes the conductor on those creates. The wake would stamp every card green at notification time.

Why not a hybrid that auto-marks *and* keeps timestamps: the auto half is the rubber stamp. Timestamps only help once a mark means someone chose to make it.

The failure mode the ticket names is a card that always reads "reviewed". Absence is therefore the default, and the only way out of it is a dedicated tool call that shows up in the transcript. The conductor prompt will say: mark only after reading the plan or the PR; do not batch-stamp at turn start or turn end; a clean look is not an endorsement.

### 2. Which kinds: plan, merge, *and* action — nothing else

Plan and merge are the acceptance criteria (the skippable chain). `action_approval` is the same shape: the human grants worker-produced work from a card, and the conductor can look it over first. Including it is answering "what else?" with the one other named approval of worker output.

Excluded, and why:

| Kind | Why not |
|---|---|
| `question` / `concern` / `gate_finding` | These *are* the conductor speaking. A review line would always be green. |
| `hire_approval` / `discard_approval` / `retry_approval` | Human operational calls, not "look over this worker output then grant it". |
| generic `approval` | Unused named-card path; do not invent a chain. |

A mark against an excluded kind is `validation`.

### 3. Schema: four columns on `decisions`, after-the-fact derived

```
conductor_review_status TEXT NOT NULL DEFAULT 'unseen'
  -- application enum: unseen | looked | concerns
conductor_reviewed_at   TEXT
conductor_review_note   TEXT
conductor_reviewed_by_agent_id TEXT
```

`Decision` exposes them as `conductorReviewStatus`, `conductorReviewedAt`, `conductorReviewNote`, `conductorReviewedByAgentId`. After-the-fact is **not stored**: a helper `reviewIsAfterAnswer(d)` is `d.conductorReviewedAt != null && d.answeredAt != null && d.conductorReviewedAt > d.answeredAt`. Strict `>` so a same-millisecond mark reads as prior, which is honest.

No CHECK rebuild: the enum is Zod/service-validated, same as several other string columns. Migration `0025_decision_conductor_review.sql`, 0013-style `ALTER TABLE`. Existing rows get `'unseen'` via DEFAULT.

`review()`:

- Actor must be the workspace conductor (`forbidden` otherwise).
- Kind must be `plan_approval` | `merge_approval` | `action_approval` (`validation` otherwise).
- Status must be `open` or `answered` (`wrong_status` on superseded/withdrawn/expired).
- Input `status: 'looked' | 'concerns'` — cannot write `unseen`.
- `concerns` requires a non-empty trimmed note (cap 500 characters so it fits a phone card; longer argument is an `ac_ask`). `looked` clears the note.
- Sets `reviewedAt = nowIso()`, `reviewedByAgentId = actor.id`.
- Emits `decision.updated` with the full `Decision` payload (new `EVENT_TYPES` entry). Does not wake anyone.

`answer()` is untouched aside from the SELECT * already returning the new columns through `decisionRow`.

### 4. No in-progress state

While the conductor is reading, the card still says **not looked at yet**. "In progress" would have to be derived from a running conductor turn, which is the rubber-stamp vector again (any digest turn would flicker every open approval). The race the ticket asks about:

- Card during the race: **not looked at yet**, buttons live.
- Record after a mid-read approve: `status=answered`, review still `unseen`, until/unless the conductor marks afterwards.
- Record after a post-answer mark: `answeredAt` kept, `reviewedAt` later, card uses after-the-fact copy.

### 5. Shared copy helper, both card stacks call it

`packages/shared` (or `packages/render` if it needs `CardModel`) exports one function:

```
conductorReviewCopy(d) → { line: string; note: string | null; tone: 'unseen' | 'looked' | 'concerns' | 'after' } | null
```

Returns `null` for kinds that do not carry the state.

Copy and visual weight are a decision, not a styling accident. **Three states, three visible renderings.** No state is conveyed by omitting the line — a blank would make "looked, nothing to flag" indistinguishable from "has not looked yet", which is the one distinction this ticket exists to make (same shape as VS-217: label the quiet case explicitly rather than leave a hole).

| State | Line (unanswered) | Line (after the fact) | Tone | Presence |
|---|---|---|---|---|
| `unseen` | `Conductor hasn't looked yet` | n/a | **loud** — `text-blocked` / needs-you meta, not the failed hue (information, not an error) | always shown |
| `looked` | `Conductor looked` | `Conductor looked after you answered` | **understated** — `text-text-3`, never green, never a seal or checkmark | **always shown** — quiet means smaller/dimmer type, not missing type |
| `concerns` | `Conductor looked — has concerns` | `Conductor looked after you answered — has concerns` | **loudest** — warning/blocked treatment; the note sits immediately above the button row as a text block | always shown, note included |

`conductorReviewCopy` returns `null` only for kinds that do not carry the state. For `plan_approval` / `merge_approval` / `action_approval` it SHALL return a non-empty `line` in every status. Apply must not "helpfully" hide `looked` because it is quiet.

Web `DecisionCard` renders `line` above the actions. `decisionToCard` puts `line` in `body` (label `Review`) and the note as a following line, so TUI and `conductor decision show` pick it up with no second table of strings.

Do **not** use `Badge` for the note (VS-141: Badge uppercases and wraps sentences into a column).

### 6. Live update: `decision.updated`, not a reused answered event

`EVENT_TYPES` gains `decision.updated`. `invalidateFor` patches decision caches the same way `decision.answered` does. Web cards already read from the decisions query, so the open card flips when the mark lands.

Telegram / channels: on `decision.updated` with `conductorReviewStatus === 'concerns'` and `status === 'open'`, send a **text** follow-up on the primary thread naming the ticket and the concern. Never call `pushDecisionCard` again (`cardsSent` stays). Unseen→looked is not worth a Telegram ping.

### 7. MCP only for the write; GET is enough for the read

`ac_decision_review` on `CONDUCTOR_TOOLS`: `{ decisionId, status: 'looked' | 'concerns', note?: string }`. Workers hitting it take the existing conductor-only 403.

No new human HTTP write. `GET /decisions` / `GET /decisions/:id` already serialise `Decision`. Tests call `decisions.review()` on the service, plus one MCP-handler forbidden test for a worker actor.

CLI does not need `conductor decision review` this change; the conductor is the only writer and it has MCP.

### 8. Prompt, not a daemon nag

`templates/conductor.AGENTS.md.tmpl` (and any conductor skill row that lists tools): when a digest or inbox names an open plan/merge/action approval, read the plan document or the PR, then `ac_decision_review`. Do not mark at the start of the turn. Do not mark every open approval in a batch. A clean look is "I read it"; concerns require the note. Never `ac_decision_answer` on those kinds (already forbidden in the template).

No daemon job that nags an unmarked approval. A nag would pressure the rubber stamp.

## Risks / Trade-offs

- **[Rubber stamp]** The conductor still *can* mark `looked` without reading. → Mitigation: the mark is a visible tool call, never a side effect; copy is not an endorsement; prompt forbids batch-stamping; `unseen` stays the loud default. **If it degenerates, raise the cost of a clean look — do not start inferring.**
- **[Captain never waits]** The feature does not slow anyone down, so VS-220/VS-221 can still happen; they just happen with "hasn't looked yet" on the card. → That is the product: inform, don't withhold. The concerns state is what would have helped those two, and it can only help if captain glances at the card.
- **[Telegram stale card]** The first push is almost always `unseen`. A later clean look never updates it. → Acceptable: unseen is the conservative reading. A later concern gets a text follow-up. Full card edit is a later change if the adapter grows edit.
- **[500-char note]** A real objection might be longer. → The card needs a glanceable summary. The conductor can also `ac_ask` (`concern`) for a full extra card; this feature's job is the line next to Approve.

## Migration Plan

1. Ship the migration, types, service, event, MCP, copy helper, both card stacks, prompt, tests.
2. Existing open approvals render `Conductor hasn't looked yet` immediately — that is the desired before-state, not a break.
3. Rollback is drop the four columns and the event/tool; cards ignore missing fields only if we keep the helper null-safe during rollout. Prefer a forward-only migration; reverting the PR also reverts the migration on a restore-from-backup, which is how this repo rolls back schema.

## Open Questions

None. Visual weight was pinned 2026-09-11 (conductor, before approval): three visible renderings, unseen loud, looked understated-but-present, concerns loudest; no state by absence. Apply follows Decision 5; it does not restyle a clean look into a blank.
