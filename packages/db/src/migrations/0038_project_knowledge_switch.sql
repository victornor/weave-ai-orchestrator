-- VS-359: a pending knowledge-repo switch (turn the opt-in on/off for a project that already exists)
-- is carried by one pull request. Null when no switch is pending. `{ direction, branch, prUrl, startedAt }`.
ALTER TABLE projects ADD COLUMN knowledge_switch_json TEXT;
