-- VS-491. A human message may name one of its project's roadmap blocks, so an ask sent from the
-- weaver composer lands in the block it was meant for instead of relying on prose the weaver has to
-- match by name. The reference belongs to the message's own project and travels with it into the
-- `human_message` wake payload, exactly as the project reference does (ADR 0005).
--
-- Nullable and additive: a message sent with no block, and every message that predates this
-- migration, reads back null. No `ON DELETE` clause: a block is set `dropped`, never deleted, so the
-- reference cannot dangle — the same posture as `thread_messages.project_id`.
ALTER TABLE thread_messages ADD COLUMN block_id TEXT REFERENCES roadmap_blocks(id);
