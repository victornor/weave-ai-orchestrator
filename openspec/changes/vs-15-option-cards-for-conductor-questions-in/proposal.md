## Why

When the conductor needs a call from the workspace owner — "file this as a ticket?", "A or B?" — the owner has to read the question out of the conversation and type an answer in prose. Nothing on screen says the conductor is waiting, and nothing records what was chosen.

The machinery for the structured version already exists and is unused. `decisions` rows carry `options_json`, `allow_free_text`, `recommendation`, `answer_key` and `answer_text`; `ac_ask` takes an `options` array and is in the conductor's tool set (`scope: 'all'`, `packages/server/src/tools.ts:216`); `decisions.answer` validates the key against those options, records the answer and wakes the agent that asked (`packages/core/src/decisions/service.ts:197-243`); and `DecisionCard` already renders options and a free-text alternative. Four things stop that path from being reachable:

- **The conductor is never told to use it.** `templates/conductor.AGENTS.md.tmpl` lists `ac_ask` among its tools and translates it as "I need a call from you on …", but every instruction about reaching the human points at `ac_human_send` (`:45`), so a question with a closed set of answers goes out as prose.
- **The chat puts the card in the wrong place.** Open human-owned decisions are rendered in one block below the whole conversation and above the composer (`packages/ui/src/routes/Chat.tsx:253-262`). The card is not where the question was asked, and it slides further from it with every new message.
- **The chat forgets the answer.** The query is `status: 'open'` (`Chat.tsx:70`), so the moment a decision is answered its card disappears and the conversation carries no record that the question was asked or how it was settled.
- **The card's own behavior is unfinished for questions.** A question's options answer on a single click with no confirmation, a question with exactly two options renders its options twice — once as the option list (`DecisionCard.tsx:128`) and again as thumb-band buttons (`:249`) — and every question is headed "Worker question" (`:41`) even when the conductor asked it.

`Needs you` already lists open human-owned decisions as cards through the same component (`packages/ui/src/routes/NeedsYou.tsx:19,80-88`), so the second half of what the ticket asks for is a small correction and a guarantee to hold, not a new surface.

## What Changes

- **The conductor asks structurally when it can.** One rule added to the conductor's always-loaded instructions: when the answer it needs is one of a small, known set, ask with `ac_ask` and real options rather than in prose. What it asks and how it words the question are unchanged.
- **A decision card is an item of the conversation.** A decision the conductor raised during a turn is rendered in the message list, directly after the conductor message that turn produced — the same run-to-message anchoring that dispatch labels already use. Later messages push it up; it is never moved back to the bottom.
- **An answered card stays in place and shows the answer.** The chat loads answered decisions as well as open ones. Once answered, the card renders inert: the question, the option that was chosen (or the words that were written), and when. The conversation becomes a readable record of what was decided.
- **Answering takes a choice and a send.** On a decision that carries options, picking an option selects it; a single primary action sends it. "Write your own" reveals the composer and sends free text the same way. Options are no longer rendered twice, and no answer is committed by a single stray tap.
- **The card says who is asking.** A question raised by the conductor is headed as such; a question raised by a worker keeps today's heading.
- **`Needs you` shows the same open question with the same options, and the two stay in step.** Both surfaces render the same decision through the same component and answer it through the same endpoint, so answering in either place resolves it in both. This is close to today's behavior; the change is to specify it and cover it with tests.
- **Prose questions are untouched.** A conductor message with no decision behind it renders exactly as it does now, and a decision the chat cannot anchor to a message in the open thread keeps today's block below the conversation.

## Capabilities

### New Capabilities

- `human-decisions/option-cards`: how a decision with a defined set of options is put to the human and answered — where its card appears in the conductor chat, how it reads once answered, how it appears in `Needs you`, and the guarantee that answering it in either place resolves it in both.

### Modified Capabilities

(None. `openspec/specs/` holds no capabilities yet.)

## Impact

- `templates/conductor.AGENTS.md.tmpl` — one rule about asking with options; no change to the conductor's remit or tone.
- `skills/agent-conductor-conductor/SKILL.md` — the same rule where the skill covers reaching the human.
- `packages/ui/src/routes/Chat.tsx` — decisions fetched open **and** answered; cards rendered inside the message list at their anchor; the existing block below the conversation kept for decisions with no anchor.
- `packages/ui/src/lib/dispatch.ts` — the chat's entry selector gains the decisions anchored to each message, reusing the run-to-last-message map it already builds (`:45`).
- `packages/ui/src/api/hooks.ts` — `useDecisions` accepts several statuses (the route already takes a comma-separated `status`, `packages/server/src/routes/decisions.ts:8`) and a `limit`.
- `packages/ui/src/components/DecisionCard.tsx` — select-then-send for decisions with options, the inert answered rendering, the asker in the header, and the duplicated two-option rendering removed.
- `packages/ui/src/routes/NeedsYou.tsx` — unchanged behavior; covered by tests it does not have today.
- `packages/ui/src/test/` — component tests for the card's states and route tests for the chat's placement.
- No migration, no new table or column, no new HTTP route, no new event type, no change to the run engine, the wake queue or `decisions.answer`. The daemon side of this feature already exists and is used as it stands.

## Out of scope

- Changing which questions the conductor asks, or how it phrases them. The one instruction added says only *which tool* to use when the answer is a closed set.
- Anchoring decision cards on ticket pages. A worker's question on a ticket keeps appearing in `Needs you` as it does today, and inherits the shared card's improvements, but nothing is added to the ticket page.
- The terminal chat (`packages/tui/`) and the Telegram channel. Both have their own decision rendering; the ticket names the web chat and `Needs you`.
- Decisions that expired, were withdrawn or were superseded. Only open and answered decisions are placed in the conversation; the rest are left as they are today.
- Offline queueing of an answer from the chat. `Needs you` queues answers while offline (`NeedsYou.tsx:40-46`); the chat does not, and this change does not add it.
