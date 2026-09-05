# ADR 0005 — A human message carries its project as a column on `thread_messages`

Date: 2026-09-05 · Status: accepted

## Context
PLAN §13 enumerates the `thread_messages` columns and PLAN §14.2 fixes the inbound path as `thread_messages` row → `enqueueWakeup(agent, {source: human_message, payload: {threadId, messageId}})`. Neither leaves a place for the project a message is about, so in a multi-project workspace the conductor had to infer the referent of "do this" from prose every turn.

## Decision
`thread_messages` gains a nullable `project_id TEXT REFERENCES projects(id)` (migration `0004`), and the `human_message` wake payload gains `projectId` and `projectSlug`. `POST /threads/:id/messages` accepts an optional `projectId` — an id or a slug — resolved through `ProjectsService.get` before the write, so a reference to a project this workspace does not have stores nothing and wakes nobody. The web conductor chat picks the value beside its input and defaults it to the project on the thread's most recent inbound message.

## Consequences
- The reference is a scalar relationship in a column, so it is queryable and legible, rather than a private key inside `parts_json` (which holds the CanonicalMessage content, not routing metadata).
- Optional at every layer: Telegram, the CLI channel and the TUI chat send no project and are unchanged, as is every message that predates the migration.
- No `ON DELETE` clause is needed because project removal is a soft archive (`packages/core/src/projects/index.ts`), so the reference can never dangle — the same posture as `tickets.project_id`.
- The hint is advisory. Nothing in the daemon grants access on the strength of it; worker project isolation is unchanged.
