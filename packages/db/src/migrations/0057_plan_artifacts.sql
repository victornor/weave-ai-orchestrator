-- VS-622. A plan artifact is scoped to a plan, not a ticket and not the workspace: the planner may
-- publish a self-contained HTML artifact (a diagram, comparison table, dependency view or mock) to
-- the plan it is drafting, without gaining any repository or ticket write. Shape mirrors
-- `0030_weaver_artifacts.sql` exactly — a current-revision pointer row, an append-only revisions
-- table, no stored `url` (the serving route computes it from the plan id and key) — but keyed by
-- `(plan_id, key)` so one plan's artifacts can never collide with another's, or with the weaver's
-- workspace-scoped store.
--
-- `card_message_id` is the conversation card posted for this artifact when it was first published
-- (a `type: 'card'` part in the plan's own thread). It is remembered so a republish updates that one
-- card in place rather than appending a second, and is nullable for an artifact whose card has not
-- been written yet.
CREATE TABLE IF NOT EXISTS plan_artifacts (
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  current_revision INTEGER NOT NULL DEFAULT 0,
  title TEXT,
  kind TEXT,
  card_message_id TEXT REFERENCES thread_messages(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (plan_id, key)
);

CREATE TABLE IF NOT EXISTS plan_artifact_revisions (
  id TEXT PRIMARY KEY,
  artifact_id TEXT NOT NULL REFERENCES plan_artifacts(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL,
  body TEXT NOT NULL,
  author_kind TEXT NOT NULL,
  author_id TEXT,
  run_id TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (artifact_id, revision)
);

CREATE INDEX IF NOT EXISTS plan_artifacts_plan_updated_idx ON plan_artifacts (plan_id, updated_at DESC);
