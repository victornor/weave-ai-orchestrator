PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE, name TEXT NOT NULL, ticket_prefix TEXT NOT NULL, ticket_counter INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK (status IN ('active','paused','archived')) DEFAULT 'active', root_path TEXT NOT NULL,
  settings_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id), slug TEXT NOT NULL, name TEXT NOT NULL, git_url TEXT NOT NULL,
  default_branch TEXT NOT NULL DEFAULT 'main', clone_path TEXT NOT NULL, max_workers INTEGER NOT NULL DEFAULT 4, setup_command TEXT,
  warm_paths_json TEXT NOT NULL DEFAULT '[]', worktree_provider TEXT NOT NULL CHECK (worktree_provider IN ('worktrunk','git')) DEFAULT 'worktrunk',
  runtime_id TEXT NOT NULL, model TEXT, openspec_enabled INTEGER NOT NULL DEFAULT 1, openspec_version TEXT, policies_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL CHECK (status IN ('cloning','ready','error','archived')) DEFAULT 'cloning', last_fetched_at TEXT, error_text TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE (workspace_id, slug)
);

CREATE TABLE IF NOT EXISTS roles (
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id), project_id TEXT NOT NULL REFERENCES projects(id), slug TEXT NOT NULL,
  name TEXT NOT NULL, title TEXT, icon TEXT, charter_summary TEXT NOT NULL, scope_text TEXT NOT NULL, responsibilities_json TEXT NOT NULL DEFAULT '[]',
  capabilities_json TEXT NOT NULL DEFAULT '[]', rules_json TEXT NOT NULL DEFAULT '[]', runtime_id TEXT NOT NULL, model TEXT, effort TEXT,
  permission_json TEXT NOT NULL DEFAULT '{}', session_policy TEXT NOT NULL CHECK (session_policy IN ('per_ticket','fresh','persistent')) DEFAULT 'per_ticket',
  max_workers INTEGER NOT NULL DEFAULT 2, secrets_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL CHECK (status IN ('pending_activation','active','paused','retired')) DEFAULT 'pending_activation', pause_reason TEXT,
  spec_revision INTEGER NOT NULL DEFAULT 1, created_by TEXT NOT NULL DEFAULT 'conductor', created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  UNIQUE (workspace_id, slug)
);
CREATE TABLE IF NOT EXISTS role_revisions (
  id TEXT PRIMARY KEY, role_id TEXT NOT NULL REFERENCES roles(id), revision INTEGER NOT NULL, changed_keys_json TEXT NOT NULL DEFAULT '[]',
  before_json TEXT NOT NULL, after_json TEXT NOT NULL, author TEXT NOT NULL, reason TEXT, created_at TEXT NOT NULL, UNIQUE (role_id, revision)
);

CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id), kind TEXT NOT NULL CHECK (kind IN ('conductor','worker')),
  project_id TEXT REFERENCES projects(id), role_id TEXT REFERENCES roles(id), role_revision INTEGER, ticket_id TEXT, name TEXT NOT NULL,
  runtime_id TEXT NOT NULL, model TEXT, effort TEXT,
  status TEXT NOT NULL CHECK (status IN ('provisioning','active','running','paused','error','done','retired')) DEFAULT 'provisioning',
  pause_reason TEXT, error_text TEXT, home_path TEXT NOT NULL, worktree_path TEXT, branch TEXT, turn_epoch INTEGER NOT NULL DEFAULT 0,
  turn_count INTEGER NOT NULL DEFAULT 0, spawned_by TEXT NOT NULL DEFAULT 'system', spawn_reason TEXT, brief_revision INTEGER NOT NULL DEFAULT 1,
  last_run_at TEXT, retired_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS agents_one_conductor ON agents(workspace_id) WHERE kind = 'conductor';
CREATE UNIQUE INDEX IF NOT EXISTS agents_one_worker_per_ticket ON agents(ticket_id) WHERE kind = 'worker' AND status NOT IN ('retired');
CREATE INDEX IF NOT EXISTS agents_ws_status ON agents(workspace_id, status);

CREATE TABLE IF NOT EXISTS agent_sessions (
  id TEXT PRIMARY KEY, agent_id TEXT NOT NULL REFERENCES agents(id), runtime_id TEXT NOT NULL, session_ref_json TEXT, display_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('active','stale','closed')) DEFAULT 'active', turn_count INTEGER NOT NULL DEFAULT 0, last_run_id TEXT,
  last_error TEXT, cumulative_usage_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS agent_sessions_agent ON agent_sessions(agent_id, status);

CREATE TABLE IF NOT EXISTS worktrees (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), ticket_id TEXT, agent_id TEXT REFERENCES agents(id), provider TEXT NOT NULL,
  path TEXT NOT NULL, branch TEXT NOT NULL, status TEXT NOT NULL CHECK (status IN ('active','dirty','landed','removed','orphaned')) DEFAULT 'active',
  created_at TEXT NOT NULL, last_verified_at TEXT, removed_at TEXT, landed_evidence_json TEXT
);

CREATE TABLE IF NOT EXISTS tickets (
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id), project_id TEXT REFERENCES projects(id), number INTEGER NOT NULL,
  identifier TEXT NOT NULL, kind TEXT NOT NULL CHECK (kind IN ('change','task','scout','question')), title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK (status IN ('backlog','todo','proposing','proposed','approved','in_progress','in_review','merging','blocked','done','cancelled')) DEFAULT 'backlog',
  priority TEXT NOT NULL CHECK (priority IN ('critical','high','medium','low')) DEFAULT 'medium', auto_merge INTEGER NOT NULL DEFAULT 0,
  assignee_role_id TEXT REFERENCES roles(id), worker_id TEXT, assignee_human INTEGER NOT NULL DEFAULT 0, parent_id TEXT REFERENCES tickets(id),
  created_by_kind TEXT NOT NULL, created_by_id TEXT, origin_kind TEXT, origin_fingerprint TEXT, checkout_run_id TEXT, execution_run_id TEXT,
  execution_locked_at TEXT, openspec_change_name TEXT, openspec_state_json TEXT, delivery_json TEXT, unblock_json TEXT, monitor_next_check_at TEXT,
  blocked_transition_at TEXT, started_at TEXT, completed_at TEXT, cancelled_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  UNIQUE (workspace_id, number)
);
CREATE UNIQUE INDEX IF NOT EXISTS tickets_origin_open ON tickets(workspace_id, origin_kind, origin_fingerprint) WHERE origin_fingerprint IS NOT NULL AND status NOT IN ('done','cancelled');
CREATE INDEX IF NOT EXISTS tickets_ws_status ON tickets(workspace_id, status);
CREATE INDEX IF NOT EXISTS tickets_project ON tickets(project_id, status);

CREATE TABLE IF NOT EXISTS ticket_relations (ticket_id TEXT NOT NULL REFERENCES tickets(id), related_ticket_id TEXT NOT NULL REFERENCES tickets(id), kind TEXT NOT NULL DEFAULT 'blocks', PRIMARY KEY (ticket_id, related_ticket_id, kind));
CREATE TABLE IF NOT EXISTS ticket_comments (
  id TEXT PRIMARY KEY, ticket_id TEXT NOT NULL REFERENCES tickets(id), author_kind TEXT NOT NULL CHECK (author_kind IN ('human','agent','system')), author_id TEXT,
  run_id TEXT, body TEXT NOT NULL, kind TEXT NOT NULL CHECK (kind IN ('comment','status','report','relay')) DEFAULT 'comment',
  source_trust TEXT NOT NULL CHECK (source_trust IN ('trusted','agent','external')) DEFAULT 'agent', created_at TEXT NOT NULL, edited_at TEXT, deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS ticket_comments_ticket ON ticket_comments(ticket_id, created_at);
CREATE TABLE IF NOT EXISTS ticket_documents (id TEXT PRIMARY KEY, ticket_id TEXT NOT NULL REFERENCES tickets(id), key TEXT NOT NULL, current_revision INTEGER NOT NULL DEFAULT 0, UNIQUE (ticket_id, key));
CREATE TABLE IF NOT EXISTS ticket_document_revisions (id TEXT PRIMARY KEY, document_id TEXT NOT NULL REFERENCES ticket_documents(id), revision INTEGER NOT NULL, body TEXT NOT NULL, author_kind TEXT NOT NULL, author_id TEXT, run_id TEXT, created_at TEXT NOT NULL, UNIQUE (document_id, revision));
CREATE TABLE IF NOT EXISTS ticket_work_products (
  id TEXT PRIMARY KEY, ticket_id TEXT NOT NULL REFERENCES tickets(id), run_id TEXT, type TEXT NOT NULL CHECK (type IN ('pull_request','branch','commit','artifact','preview_url','report')),
  provider TEXT, external_id TEXT, url TEXT, title TEXT, state TEXT, is_primary INTEGER NOT NULL DEFAULT 0, metadata_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS decisions (
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id), ticket_id TEXT REFERENCES tickets(id),
  kind TEXT NOT NULL CHECK (kind IN ('approval','question','gate_finding','plan_approval','hire_approval','merge_approval','discard_approval')),
  owner TEXT NOT NULL CHECK (owner IN ('human','conductor')), asked_by_agent_id TEXT, asked_in_run_id TEXT, title TEXT NOT NULL, context TEXT NOT NULL DEFAULT '',
  options_json TEXT NOT NULL DEFAULT '[]', allow_free_text INTEGER NOT NULL DEFAULT 1, recommendation TEXT,
  status TEXT NOT NULL CHECK (status IN ('open','answered','expired','withdrawn','superseded')) DEFAULT 'open', answer_key TEXT, answer_text TEXT,
  answered_by_kind TEXT, answered_by_id TEXT, answered_at TEXT, expires_at TEXT, target_json TEXT, correlation_key TEXT, created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS decisions_open_corr ON decisions(ticket_id, correlation_key) WHERE status = 'open' AND correlation_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS decisions_ws_status ON decisions(workspace_id, status);

CREATE TABLE IF NOT EXISTS wakeups (
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id), agent_id TEXT NOT NULL REFERENCES agents(id),
  source TEXT NOT NULL, reason TEXT NOT NULL, payload_json TEXT NOT NULL DEFAULT '{}', idempotency_key TEXT,
  status TEXT NOT NULL CHECK (status IN ('queued','claimed','coalesced','skipped','completed','failed','cancelled')) DEFAULT 'queued',
  coalesced_into_id TEXT, skip_reason TEXT, run_id TEXT, requested_by_kind TEXT, requested_by_id TEXT, not_before TEXT,
  created_at TEXT NOT NULL, claimed_at TEXT, finished_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS wakeups_idem ON wakeups(agent_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS wakeups_agent_status ON wakeups(agent_id, status, created_at);

CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id), agent_id TEXT NOT NULL REFERENCES agents(id), ticket_id TEXT REFERENCES tickets(id),
  session_id TEXT, wakeup_ids_json TEXT NOT NULL DEFAULT '[]', runtime_id TEXT NOT NULL, model TEXT,
  status TEXT NOT NULL CHECK (status IN ('queued','running','succeeded','failed','timed_out','cancelled','interrupted')) DEFAULT 'queued',
  turn_epoch INTEGER NOT NULL, cwd TEXT NOT NULL, started_at TEXT, finished_at TEXT, exit_code INTEGER, signal TEXT, pid INTEGER, pgid INTEGER,
  error_code TEXT, error_family TEXT, retry_of_run_id TEXT, scheduled_retry_at TEXT, usage_json TEXT, cost_cents INTEGER, result_json TEXT,
  liveness TEXT, log_path TEXT, prompt_path TEXT, summary TEXT, last_event_at TEXT, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS runs_agent ON runs(agent_id, created_at);
CREATE INDEX IF NOT EXISTS runs_ws_status ON runs(workspace_id, status);
CREATE INDEX IF NOT EXISTS runs_ticket ON runs(ticket_id);

CREATE TABLE IF NOT EXISTS run_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL REFERENCES runs(id), seq INTEGER NOT NULL, ts TEXT NOT NULL, type TEXT NOT NULL,
  stream TEXT NOT NULL DEFAULT 'runtime', level TEXT NOT NULL DEFAULT 'info', payload_json TEXT NOT NULL DEFAULT '{}', source_event_id TEXT, UNIQUE (run_id, seq)
);

CREATE TABLE IF NOT EXISTS usage_events (
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id), project_id TEXT, role_id TEXT, agent_id TEXT NOT NULL, ticket_id TEXT, run_id TEXT NOT NULL,
  runtime_id TEXT NOT NULL, provider TEXT, model TEXT, billing_type TEXT NOT NULL DEFAULT 'unknown', input_tokens INTEGER NOT NULL DEFAULT 0,
  cached_input_tokens INTEGER NOT NULL DEFAULT 0, output_tokens INTEGER NOT NULL DEFAULT 0, cost_cents INTEGER, cost_status TEXT NOT NULL DEFAULT 'unpriced',
  duration_ms INTEGER NOT NULL DEFAULT 0, occurred_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS usage_ws_time ON usage_events(workspace_id, occurred_at);
CREATE INDEX IF NOT EXISTS usage_project_time ON usage_events(project_id, occurred_at);
CREATE INDEX IF NOT EXISTS usage_ticket ON usage_events(ticket_id);
CREATE INDEX IF NOT EXISTS usage_model_time ON usage_events(model, occurred_at);

CREATE TABLE IF NOT EXISTS channels (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id), kind TEXT NOT NULL, config_json TEXT NOT NULL DEFAULT '{}', status TEXT NOT NULL DEFAULT 'active', last_error TEXT, UNIQUE (workspace_id, kind));
CREATE TABLE IF NOT EXISTS channel_threads (
  id TEXT PRIMARY KEY, channel_id TEXT NOT NULL REFERENCES channels(id), agent_id TEXT NOT NULL, ticket_id TEXT, external_thread_id TEXT, external_user_id TEXT,
  human_label TEXT, is_primary INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, last_message_at TEXT
);
CREATE INDEX IF NOT EXISTS channel_threads_ext ON channel_threads(channel_id, external_thread_id);
CREATE TABLE IF NOT EXISTS thread_messages (
  id TEXT PRIMARY KEY, thread_id TEXT NOT NULL REFERENCES channel_threads(id), direction TEXT NOT NULL CHECK (direction IN ('inbound','outbound')), author_kind TEXT NOT NULL,
  author_id TEXT, run_id TEXT, body TEXT NOT NULL, parts_json TEXT NOT NULL DEFAULT '[]', external_message_id TEXT, delivery_status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS thread_messages_thread ON thread_messages(thread_id, created_at);

CREATE TABLE IF NOT EXISTS activity (
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, actor_kind TEXT NOT NULL, actor_id TEXT, run_id TEXT, action TEXT NOT NULL, entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL, ticket_id TEXT, details_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS activity_ws ON activity(workspace_id, created_at);

CREATE TABLE IF NOT EXISTS events (
  seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL, workspace_id TEXT NOT NULL, type TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS events_ws_seq ON events(workspace_id, seq);
CREATE TABLE IF NOT EXISTS webhook_cursors (webhook_url TEXT PRIMARY KEY, last_seq INTEGER NOT NULL DEFAULT 0, last_error TEXT, updated_at TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS routines (
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id), name TEXT NOT NULL, trigger_json TEXT NOT NULL, template_json TEXT NOT NULL,
  role_id TEXT, concurrency TEXT NOT NULL DEFAULT 'skip_if_active', status TEXT NOT NULL DEFAULT 'active', last_fired_at TEXT, next_fire_at TEXT, created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS knowledge_files (
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id), project_id TEXT, path TEXT NOT NULL, scope TEXT NOT NULL,
  token_estimate INTEGER NOT NULL DEFAULT 0, budget_tokens INTEGER NOT NULL, last_curated_at TEXT, curation_pending INTEGER NOT NULL DEFAULT 0,
  hash TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL, UNIQUE (workspace_id, path)
);
CREATE TABLE IF NOT EXISTS knowledge_revisions (
  id TEXT PRIMARY KEY, file_id TEXT NOT NULL REFERENCES knowledge_files(id), revision INTEGER NOT NULL, body TEXT NOT NULL, author_kind TEXT NOT NULL,
  author_id TEXT, run_id TEXT, reason TEXT NOT NULL, removed_entries_json TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL, UNIQUE (file_id, revision)
);

CREATE TABLE IF NOT EXISTS spec_capabilities (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), capability TEXT NOT NULL, title TEXT, requirement_count INTEGER NOT NULL DEFAULT 0,
  body_hash TEXT NOT NULL DEFAULT '', body TEXT NOT NULL DEFAULT '', path TEXT NOT NULL, last_archived_change TEXT, updated_at TEXT NOT NULL, UNIQUE (project_id, capability)
);
CREATE TABLE IF NOT EXISTS spec_requirements (id TEXT PRIMARY KEY, capability_id TEXT NOT NULL REFERENCES spec_capabilities(id), name TEXT NOT NULL, text TEXT NOT NULL, scenarios_json TEXT NOT NULL DEFAULT '[]');
CREATE TABLE IF NOT EXISTS spec_changes (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), change_name TEXT NOT NULL, state TEXT NOT NULL CHECK (state IN ('active','archived')),
  ticket_id TEXT, archived_as TEXT, created_at TEXT, archived_at TEXT, artifacts_json TEXT NOT NULL DEFAULT '{}', updated_at TEXT NOT NULL, UNIQUE (project_id, change_name, state)
);
CREATE TABLE IF NOT EXISTS spec_change_capabilities (change_id TEXT NOT NULL REFERENCES spec_changes(id), capability TEXT NOT NULL, delta_kind TEXT NOT NULL, PRIMARY KEY (change_id, capability));
CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_search USING fts5(kind, project_id, ref, title, body);

CREATE TABLE IF NOT EXISTS operator (id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, totp_secret_enc TEXT, recovery_codes_json TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS auth_sessions (
  id TEXT PRIMARY KEY, operator_id TEXT NOT NULL REFERENCES operator(id), token_hash TEXT NOT NULL UNIQUE, kind TEXT NOT NULL CHECK (kind IN ('web','cli','presenter')),
  device_name TEXT, created_at TEXT NOT NULL, last_seen_at TEXT NOT NULL, expires_at TEXT NOT NULL, revoked_at TEXT, ip TEXT, user_agent TEXT
);
CREATE TABLE IF NOT EXISTS login_attempts (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL, ip TEXT, ok INTEGER NOT NULL, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS login_attempts_user ON login_attempts(username, created_at);
CREATE TABLE IF NOT EXISTS push_subscriptions (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, endpoint TEXT NOT NULL UNIQUE, keys_json TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS surface_handles (presenter_id TEXT NOT NULL, agent_id TEXT NOT NULL, surface_kind TEXT NOT NULL, handle_json TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (presenter_id, agent_id));
CREATE TABLE IF NOT EXISTS secrets (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, name TEXT NOT NULL, env_var_name TEXT NOT NULL, scope TEXT NOT NULL, scope_id TEXT, UNIQUE (workspace_id, name));
