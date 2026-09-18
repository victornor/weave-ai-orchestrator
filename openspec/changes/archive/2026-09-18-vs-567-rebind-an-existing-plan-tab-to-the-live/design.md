## Decisions

1. **Rebind at the source and self-heal at the reader.** `ensurePlanner` updates
   `channel_threads.agent_id` when it spawns a planner for a plan that already has a thread; that
   fixes future replacements. Existing broken rows (live data) are fixed lazily in `inbound`, which
   looks up the plan by `thread_id`; if the thread's agent is retired and the plan has a live
   planner, the thread is repointed before the wake is enqueued. No migration.
2. **Replay only what is provably safe.** On repair, `wakeups` for the retired agent with
   `source = 'human_message'`, `status = 'skipped'`, `skip_reason = 'agent_retired'` and
   `payload.threadId` equal to this thread are re-enqueued for the live planner, keyed by message id
   so a second repair cannot duplicate them, and only if the message still exists on the thread.
   Wakes whose payload lacks a thread id are ignored.
3. `retirePlanner` still clears the plan's agent; the thread is left alone there, because a plan
   with no live planner is repaired when the next planner is spawned.
