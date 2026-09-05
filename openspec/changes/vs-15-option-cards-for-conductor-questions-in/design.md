## Context

See `proposal.md` — Why. Everything below was checked in the tree.

**The daemon side is already built.**

- `decisions` rows carry the whole shape a card needs: `options_json`, `allow_free_text`, `recommendation`, `answer_key`, `answer_text`, `answered_at`, `status` and `asked_in_run_id` (`Decision`, `packages/shared/src/types.ts:9`).
- `ac_ask` accepts `options: [{ key, label, description?, recommended? }]`, `allowFreeText` and `recommendation`, and is registered with `scope: 'all'` — the conductor may call it (`packages/server/src/tools.ts:115-125, 216-225`).
- `decisions.answer` rejects an unknown option key, rejects free text when the decision forbids it, records `answerKey` / `answerText` / `answeredAt`, emits `decision.answered`, and wakes `askedByAgentId` with `source: 'decision_answered'` (`packages/core/src/decisions/service.ts:197-243`). A second answer to the same decision fails with `wrong_status` (`:199`).
- `GET /decisions` already takes a comma-separated `status` and an `owner` (`packages/server/src/routes/decisions.ts:7-10`), so open **and** answered is a query-string change with no route work.
- `decision.created` and `decision.answered` already invalidate the decisions queries in the web app (`packages/ui/src/api/events.ts:220-225`), so a card corrects itself when the same decision is answered elsewhere.

**The web side is where the gaps are.**

- The chat renders open human-owned decisions in one block after the message list, the live transcript and the unattributed worker row, immediately above the composer (`packages/ui/src/routes/Chat.tsx:253-262`), from `useDecisions({ status: 'open', owner: 'human' })` (`:70`).
- `chatEntries` already turns messages plus tickets plus workers into an ordered list of entries, using a run-id-to-last-outbound-message map (`anchors`, `packages/ui/src/lib/dispatch.ts:45-49`, `:74`). That is exactly the anchor a decision needs, and `Decision.askedInRunId` is exactly the key.
- `DecisionCard` renders an option list for `question` and `gate_finding` decisions (`packages/ui/src/components/DecisionCard.tsx:128-170`) whose buttons call `onAnswer({ key })` directly, and separately renders up to two options as thumb-band buttons (`:249-255`) — so a two-option question shows its options twice and either copy commits on one click. `HEAD.question` is the fixed label `Worker question` (`:41`).
- `NeedsYou` renders open human-owned decisions with the same component and owns the offline queue and the toasts (`packages/ui/src/routes/NeedsYou.tsx:19, 40-47, 82-89`). Its behavior is already what the ticket asks for; it has no test.

## Goals / Non-Goals

**Goals**

- Satisfy `specs/human-decisions/option-cards/` with web-app changes and one instruction to the conductor. No schema change, no route, no change to `decisions.answer`.
- Anchor decision cards with the mechanism the chat already uses for dispatch labels, so the two cannot drift and reload correctness is structural rather than handled.
- Keep one card component for both surfaces, so "the same options in both places" is true by construction rather than by duplication.
- Leave every path that works today working: prose questions, worker questions, decisions with no anchor.

**Non-Goals**

- No terminal-chat or Telegram rendering. Both have their own decision paths and the ticket names neither.
- No change to which decisions exist, who owns them, or what answering one does.
- No new offline behavior in the chat.

## Decisions

### 1. Anchor a decision on `askedInRunId`, through the map the chat already builds

A card has to attach to the conductor message that raised it. The durable link already exists: `decisions.asked_in_run_id` is written from the acting run at creation (`packages/core/src/decisions/service.ts:82`), and `thread_messages.run_id` records the run behind every outbound message. `chatEntries` already builds `run id -> last outbound message of that run` and uses it to place dispatch labels; a decision is placed by the same lookup on the same map.

Consequences:

- Placement is a pure function of persisted rows, so the reload requirement is satisfied by the design rather than by a case. This is the same argument that made dispatch labels reload-correct.
- A conductor turn that raised a question without messaging the human has no anchor; its card falls to the existing block below the conversation. That is today's behavior for every decision, so nothing regresses.
- A worker's question carries the worker's run id, which never appears on a thread message, so worker questions fall to the same block. That is exactly the scope line the ticket draws: worker questions on tickets are a follow-up.

*Alternative considered: anchor by timestamp — the card goes after the last message older than `createdAt`.* Rejected for the reason the same alternative was rejected for dispatch labels: it asserts a causal link that may never have existed, and it is wrong precisely in the awkward cases (a decision raised in a turn that sent no message, a decision raised minutes after the reply).

*Alternative considered: a `thread_messages` row of a new kind that carries the decision, written when the decision is created.* Rejected: it puts a message in the conversation that the conductor never sent, needs a migration and a new message kind, and makes the chat's own history the source of truth for something the `decisions` table already knows.

### 2. Order within an anchor: dispatch labels first, then decisions

One turn can both file work and raise a question. The entry therefore holds two lists; they render as the dispatch labels for that message followed by its decision cards, decisions among themselves in creation order. Interleaving both lists by `createdAt` would be more literally faithful, but the two kinds of item are not comparable at a glance and a turn that does both is rare; a fixed order is one line and always reads the same. This is a deliberate simplification, recorded here so a later change knows it was a choice.

### 3. The chat loads open and answered decisions; nothing else

The answered card must stay in the conversation, so the chat's query becomes `status=open,answered` with an explicit `limit` (200) — the list is ordered by `created_at DESC` and capped (`packages/core/src/decisions/service.ts` `list`), and mixing answered rows in would otherwise be able to push an old open decision out of a 100-row default.

Expired, withdrawn and superseded decisions are not loaded. A superseded decision is one the asker replaced, and showing both would put a stale question in the history next to the real one; an expired or withdrawn one was never answered and has no answer to show. They are absent from the chat today and stay absent.

Only anchored decisions render in the conversation. An answered decision with no anchor renders nowhere — the block below the conversation stays open-only, as it is today, because it is a "waiting on you" region and not a history.

*Alternative considered: load every status and render a withdrawn or expired card as its own inert state.* Rejected as scope the ticket does not ask for; the acceptance criteria name the answered state only.

### 4. Select, then send — one component, both surfaces

The card gains a selection state for decisions that carry options: clicking an option selects it, and a single primary action in the thumb band sends it. This is what the request describes ("picking one and pressing send answers it"), and it fixes two existing faults at the same time: the two-option question that renders its options twice (`DecisionCard.tsx:128` and `:249`), and the single stray tap that commits an answer with no way back.

It applies wherever the card is used, so `Needs you` and the chat behave identically — which is what makes "the same options in both places, answered in either" true by construction rather than by two implementations agreeing.

Scope of the change to the component is deliberately narrow: the option-list path (`question`, `gate_finding`, and any decision whose options do not map onto a named variant) moves to select-then-send. The named approval variants — plan, merge, hire, discard — keep their existing purpose-built buttons and their confirmation behavior, because their actions are already explicit and their tests and muscle memory depend on them. `discard_approval` in particular already has a stronger confirmation (typing the ticket identifier) and must not be weakened into a two-tap flow.

*Alternative considered: keep one-click answering and treat "pressing send" as satisfied by the click.* Rejected: it is not what was asked, and the accidental-commit problem is real on a phone, which is the primary surface for `Needs you`.

### 5. The answered card is inert and self-describing

An answered decision renders the question, the context, and one line saying what was answered — the *label* of the chosen option (falling back to its key when the option is no longer in the list) or the words that were written, with the time. No option is selectable, no send action is offered, and the header shows the answered state. The card reads as a record, so the conversation can be scrolled and understood without opening anything.

The card derives all of this from the `Decision` it is given (`answerKey`, `answerText`, `answeredAt`, `status`), so an answer that arrived from `Needs you`, from another device, or from the CLI produces the same inert card here as soon as `decision.answered` invalidates the query.

### 6. An answer that cannot be taken is reported, not swallowed

`decisions.answer` fails with `wrong_status` when the decision is no longer open — the race where the same question is answered in `Needs you` and in the chat. `useAnswerDecision` already invalidates the decisions queries `onSettled`, so the card re-renders in its true state either way; what is missing is telling the human. Both surfaces get an error toast on a failed answer, and the chat gains the toast hook it does not use today. `Needs you` already toasts on success and keeps doing so.

This is the whole of the "answer that is refused" scenario in the spec: the daemon is already correct, the client already re-reads, and the only gap is silence.

### 7. Tell the conductor to ask with options — one rule, no change to what it asks

Without this the feature is unreachable: the conductor has `ac_ask` in its tool list but every instruction about reaching the human points at `ac_human_send` (`templates/conductor.AGENTS.md.tmpl:45`), so a closed-set question goes out as prose and no card is ever created. One rule is added to the always-loaded template and to the conductor skill where it covers reaching the human: when the answer needed is one of a small, known set, ask with `ac_ask` carrying those options and a recommendation; otherwise ask in prose.

The ticket puts "changing which questions the conductor asks or how it phrases them" out of scope, and this stays inside that line: it changes neither the set of questions nor their wording, only the tool a closed-set question travels through. It is called out here because it is the one change in this proposal that touches an agent's instructions, and it is the one a reviewer should look at first.

## Risks / Trade-offs

- **The conductor may over-use `ac_ask`.** A rule that says "ask with options" can turn conversational questions into cards. The rule is therefore written with the negative case as well ("otherwise ask in prose"), and the card only exists for a closed set the conductor would act on. If it still over-fires, the correction is a wording change in one template, not a code change.
- **Select-then-send is one more tap.** Accepted: it is what was asked for, it removes the accidental commit, and it removes the duplicated two-option rendering. The named approval variants keep their one-tap actions, so the flows the human uses most often are unchanged.
- **The chat's decision query grows.** Open plus answered, capped at 200, workspace-scoped, cached by TanStack Query and invalidated only on decision events. If a workspace ever outgrows that, the answer is a thread-scoped decisions endpoint, not a narrower status filter that would reintroduce the vanishing card.
- **A decision raised in a turn with no message has no card in the conversation.** It falls to the block below the conversation, which is today's behavior for every decision. The alternative — inventing a chat entry for a turn the human never saw — would put words in the conductor's mouth.
- **Worker questions stay unanchored.** Deliberate: the ticket makes them a follow-up. They still reach the human through `Needs you` and through the block below the conversation, and they inherit the card's select-then-send and answered states.
- **Touching a shared component touches three surfaces.** `DecisionCard` is used by the chat and by `Needs you`, and the ticket page has its own inline plan-approval controls. The narrow scope in Decision 4 — option-list decisions only — is what keeps the approval variants and their existing tests untouched.

## Migration Plan

None. No schema change, no new column, no data migration, no new route and no new event type. The change is the web app, one prompt template and one skill file; rolling it back is reverting the release, after which the chat renders decisions exactly as it does now and any decision raised with options is still answerable from `Needs you`.

## Open Questions

None. The three judgement calls that could have become questions are settled above with their reasons: select-then-send rather than one-click (Decision 4), the fixed order of labels and cards under one message (Decision 2), and the one instruction added to the conductor's template (Decision 7). Each is a reviewable line in the proposal, which is what plan approval is for.
