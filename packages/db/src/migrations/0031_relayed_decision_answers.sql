-- VS-310. Two nullable columns on `decisions` recording that the human's words were recorded by the
-- weaver from a message rather than given by the human directly:
--
-- `answer_author_kind` — the *author* of the recorded words. `answered_by_kind`/`answered_by_id`
-- stay the *writer* (the weaver agent), so a relay is never mistaken for a tap; this is `'human'` on
-- a relay and NULL on a direct answer, whose author is its writer.
--
-- `relayed_from_message_id` — the inbound human thread message the answer was transcribed from.
-- Non-NULL exactly when the answer was relayed, and the definitive relay flag. Application-validated
-- against `thread_messages` at write time; no FK, because the message is not a parent this row needs
-- a cascade from and the same id is checked in the service that writes it.
--
-- ALTER TABLE, not a rebuild: 0010 replaced this table for its `kind` CHECK and 0013/0025 appended
-- columns the same way. Nothing here touches a CHECK, so the rebuild recipe and its foreign-key
-- caveat do not apply. Existing rows read as direct answers.
ALTER TABLE decisions ADD COLUMN answer_author_kind TEXT;
ALTER TABLE decisions ADD COLUMN relayed_from_message_id TEXT;
