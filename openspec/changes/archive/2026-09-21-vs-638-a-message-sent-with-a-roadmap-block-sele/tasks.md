## 1. Wake-text rendering

- [x] 1.1 Add an exported pure `humanSelectionNotice(payload)` to `packages/core/src/prompts/index.ts` (and `@weave-ai/core`'s index) returning the plain-words selected-block instruction only when `blockTitle` is a non-empty string, verified by a unit assertion that it returns `null` without a block
- [x] 1.2 Render the notice in the "What was said" section of `buildTurnPrompt` for a `human_message` carrying a block, and verify with a test in `packages/core/src/prompts/render.test.ts` that a block-selected wake's turn text contains the block title and the `weave_roadmap_item_add` instruction, and a project-without-block wake renders as before
- [x] 1.3 Attach the notice to the `human_message` entry in `weave_inbox` (`packages/server/src/tools.ts`), verified by a test that the message entry carries the selected block's title and instruction

## 2. Ticket-creation guard

- [x] 2.1 Add `blockOverride: z.string().min(1).optional()` to the `weave_ticket_create` input and a guard that refuses with an `OcError('validation', …)` naming the block and both roadmap tools when the turn's own bundled wakes carry a `human_message` with a `blockId`, verified by a test that the call is refused and no ticket is created
- [x] 2.2 Exempt human callers (`ctx.actor.kind === 'human'`) and scope the guard to the turn's bundled wakes, verified by tests that a later block-less message, a worker turn and a routine turn are unaffected
- [x] 2.3 Let a non-empty `blockOverride` proceed and record `ticket.create_block_override` with the block and reason against the created ticket using `recordActivity`, verified by a test asserting the created ticket and the activity row
- [x] 2.4 Verify `weave_roadmap_item_add` still succeeds in the block-selected turn (test)

## 3. Weaver instructions

- [x] 3.1 Rewrite the selected-block note in `skills/weave-ai-weaver/SKILL.md` to the two-line rule (a selected block means the ask is a roadmap item; add it with `weave_roadmap_item_add`) and remove the duplicated sentence, verified by a `render.test.ts` assertion added with a VS-638 comment naming the rule

## 4. Verification

- [x] 4.1 Run `pnpm lint` and `pnpm typecheck` and confirm both pass
- [x] 4.2 Run the changed test files while iterating, then the full core/server suite once with `--maxWorkers=4` and record both suite blocks verbatim
