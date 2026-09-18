## 1. Rebind

- [x] 1.1 `ensurePlanner` points the plan's thread at the planner it returns. Verify: a test replaces
  a plan's planner and reads `channel_threads.agent_id` equal to the new agent.
- [x] 1.2 `inbound` repairs a plan thread whose agent is retired and wakes the live planner, and
  re-enqueues the thread's `agent_retired`-skipped human wakes once. Verify: tests for the wake
  landing on the new planner, no `agent_retired` skip, replay once, no duplicate on a second send.
