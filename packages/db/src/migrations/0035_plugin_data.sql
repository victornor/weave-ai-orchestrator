-- VS-334: a per-plugin, per-workspace document store, reached through PluginHost.store. Reserved
-- to plugin use — no core service reads or writes this table. `plugin_id` plus `key` is the whole
-- identity (the db is already one-per-workspace, so no workspace_id column is needed); `value_json`
-- holds whatever JSON-shaped value the plugin chose to store under that key.
CREATE TABLE IF NOT EXISTS plugin_data (
  plugin_id TEXT NOT NULL, key TEXT NOT NULL, value_json TEXT NOT NULL DEFAULT '{}', updated_at TEXT NOT NULL,
  PRIMARY KEY (plugin_id, key)
);
