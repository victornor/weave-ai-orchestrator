-- VS-952. The last unanswered-decision reminder sent to the human, as "<clockStartIso>#<stage>".
-- NULL until the first reminder. Keyed by the clock's start so a re-review restarts the stages.
ALTER TABLE decisions ADD COLUMN human_reminder_key TEXT;
