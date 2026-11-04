-- ac:foreign_keys_off
-- VS-964. `projects.sync_state`'s CHECK gains `empty`: the clone was taken of a remote with no commits
-- yet, which is a different condition from `diverged`. SQLite cannot ALTER a CHECK, so the table is
-- rebuilt with every column it carries today (0001's set plus 0016, 0019, 0036, 0038, 0063, 0064's
-- appended ones, less the two 0012 dropped), copied by name so column order cannot misalign.
CREATE TABLE projects_new (
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id), slug TEXT NOT NULL, name TEXT NOT NULL, git_url TEXT NOT NULL,
  default_branch TEXT NOT NULL DEFAULT 'main', clone_path TEXT NOT NULL, max_workers INTEGER NOT NULL DEFAULT 4, setup_command TEXT,
  warm_paths_json TEXT NOT NULL DEFAULT '[]', worktree_provider TEXT NOT NULL CHECK (worktree_provider IN ('worktrunk','git')) DEFAULT 'worktrunk',
  openspec_enabled INTEGER NOT NULL DEFAULT 1, openspec_version TEXT, policies_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL CHECK (status IN ('cloning','ready','error','archived')) DEFAULT 'cloning', last_fetched_at TEXT, error_text TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, landing_branch TEXT, sync_state TEXT NOT NULL DEFAULT 'in_sync'
  CHECK (sync_state IN ('in_sync', 'behind', 'diverged', 'empty')), knowledge_repo_enabled INTEGER NOT NULL DEFAULT 0, knowledge_switch_json TEXT,
  primary_clone_synced_head TEXT, worker_identity_json TEXT, UNIQUE (workspace_id, slug)
);
INSERT INTO projects_new (
  id, workspace_id, slug, name, git_url, default_branch, clone_path, max_workers, setup_command, warm_paths_json, worktree_provider,
  openspec_enabled, openspec_version, policies_json, status, last_fetched_at, error_text, created_at, updated_at, landing_branch, sync_state,
  knowledge_repo_enabled, knowledge_switch_json, primary_clone_synced_head, worker_identity_json
) SELECT
  id, workspace_id, slug, name, git_url, default_branch, clone_path, max_workers, setup_command, warm_paths_json, worktree_provider,
  openspec_enabled, openspec_version, policies_json, status, last_fetched_at, error_text, created_at, updated_at, landing_branch, sync_state,
  knowledge_repo_enabled, knowledge_switch_json, primary_clone_synced_head, worker_identity_json
FROM projects;
DROP TABLE projects;
ALTER TABLE projects_new RENAME TO projects;
