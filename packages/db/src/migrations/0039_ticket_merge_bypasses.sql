-- The merge queue's starvation counter (VS-390): how many times a waiting ticket has been passed
-- over. At each admission every waiting ticket that joined earlier is credited one bypass; a ticket
-- that has reached MERGE_BYPASS_LIMIT is admitted before every ticket that has not. 0 is "never
-- bypassed", and it is every ticket that is not waiting in the queue.
ALTER TABLE tickets ADD COLUMN merge_bypasses INTEGER NOT NULL DEFAULT 0;
