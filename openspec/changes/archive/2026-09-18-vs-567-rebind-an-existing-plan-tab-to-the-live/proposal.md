## Why

A plan's conversation is a `channel_thread` whose `agent_id` names the planner. When a planner is
replaced (the 2026-09-18 upgrade retired a Claude planner and spawned an OpenCode one for the same
plan), the plan row is re-pointed at the new agent but the thread is not. Captain's next message on
the existing Plan tab enqueues a wake for the retired agent, which is skipped with `agent_retired`,
so the live planner never wakes and the tab is dead.

## What Changes

- `ensurePlanner` rebinds the plan's thread to the planner it returns, so a replacement planner
  always owns the conversation.
- `inbound` on a thread that belongs to a plan resolves the addressee through the plan's live
  planner. A thread still pointing at a retired planner is repaired in place (self-heal for
  already-affected plans, no manual data fix), and the human messages that were skipped as
  `agent_retired` for that thread are re-enqueued for the live planner.
- Regression tests: planner replaced → existing thread dispatches to the new planner; stale thread
  is repaired on the next send; the skipped message is replayed once.

Non-goals: plan drafts, roles, ticket filing, any UI change.

## Impact

`packages/core/src/workers/index.ts`, `packages/core/src/threads/service.ts`, tests.
