-- VS-568. `decisions.kind`'s CHECK gains `promotion_approval`, the project-scoped card that promotes a
-- project's landing branch to its default branch. SQLite cannot alter a CHECK, so the table is rebuilt
-- with every column it carries today (0027's set plus 0031, 0037 and 0043's appended ones), copied by
-- name so column order cannot misalign.
CREATE TABLE decisions_new (
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id), ticket_id TEXT REFERENCES tickets(id),
  kind TEXT NOT NULL CHECK (kind IN ('approval','question','concern','gate_finding','plan_approval','hire_approval','merge_approval','discard_approval','retry_approval','action_approval','promotion_approval')),
  owner TEXT NOT NULL CHECK (owner IN ('human','weaver')), asked_by_agent_id TEXT, asked_in_run_id TEXT, title TEXT NOT NULL, context TEXT NOT NULL DEFAULT '',
  options_json TEXT NOT NULL DEFAULT '[]', allow_free_text INTEGER NOT NULL DEFAULT 1, recommendation TEXT,
  status TEXT NOT NULL CHECK (status IN ('open','answered','expired','withdrawn','superseded')) DEFAULT 'open', answer_key TEXT, answer_text TEXT,
  answered_by_kind TEXT, answered_by_id TEXT, answered_at TEXT, expires_at TEXT, target_json TEXT, correlation_key TEXT, created_at TEXT NOT NULL,
  project_id TEXT REFERENCES projects(id), inputs_json TEXT NOT NULL DEFAULT '[]', answer_inputs_json TEXT,
  weaver_review_status TEXT NOT NULL DEFAULT 'unseen', weaver_reviewed_at TEXT, weaver_review_note TEXT, weaver_reviewed_by_agent_id TEXT,
  answer_author_kind TEXT, relayed_from_message_id TEXT, weaver_reviewed_head_sha TEXT, weaver_review_waiting_on TEXT
);
INSERT INTO decisions_new (
  id, workspace_id, ticket_id, kind, owner, asked_by_agent_id, asked_in_run_id, title, context, options_json, allow_free_text, recommendation,
  status, answer_key, answer_text, answered_by_kind, answered_by_id, answered_at, expires_at, target_json, correlation_key, created_at,
  project_id, inputs_json, answer_inputs_json, weaver_review_status, weaver_reviewed_at, weaver_review_note, weaver_reviewed_by_agent_id,
  answer_author_kind, relayed_from_message_id, weaver_reviewed_head_sha, weaver_review_waiting_on
) SELECT
  id, workspace_id, ticket_id, kind, owner, asked_by_agent_id, asked_in_run_id, title, context, options_json, allow_free_text, recommendation,
  status, answer_key, answer_text, answered_by_kind, answered_by_id, answered_at, expires_at, target_json, correlation_key, created_at,
  project_id, inputs_json, answer_inputs_json, weaver_review_status, weaver_reviewed_at, weaver_review_note, weaver_reviewed_by_agent_id,
  answer_author_kind, relayed_from_message_id, weaver_reviewed_head_sha, weaver_review_waiting_on
FROM decisions;
DROP TABLE decisions;
ALTER TABLE decisions_new RENAME TO decisions;
CREATE UNIQUE INDEX IF NOT EXISTS decisions_open_corr ON decisions(ticket_id, correlation_key) WHERE status = 'open' AND correlation_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS decisions_ws_status ON decisions(workspace_id, status);
CREATE INDEX IF NOT EXISTS decisions_ws_project ON decisions(workspace_id, project_id);
