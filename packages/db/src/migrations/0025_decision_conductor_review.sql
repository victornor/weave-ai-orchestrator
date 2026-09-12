-- VS-223. Four columns on `decisions`:
--
-- `conductor_review_status` — unseen | looked | concerns, asserted by the conductor via
-- `weave_decision_review`. Default `unseen` so existing open cards render "hasn't looked yet"
-- immediately. Application-validated, no CHECK rebuild.
--
-- `conductor_reviewed_at` / `conductor_review_note` / `conductor_reviewed_by_agent_id` — when the
-- mark was made, the concern text (cleared on a clean look), and which weave agent wrote it.
-- After-the-fact is derived (`reviewedAt > answeredAt`), never stored.
--
-- ALTER TABLE, not a rebuild: 0010 already replaced this table for its `kind` CHECK, and 0013
-- appended columns the same way. Nothing here touches a CHECK, so the rebuild recipe and its
-- foreign-key caveat do not apply.
ALTER TABLE decisions ADD COLUMN conductor_review_status TEXT NOT NULL DEFAULT 'unseen';
ALTER TABLE decisions ADD COLUMN conductor_reviewed_at TEXT;
ALTER TABLE decisions ADD COLUMN conductor_review_note TEXT;
ALTER TABLE decisions ADD COLUMN conductor_reviewed_by_agent_id TEXT;
