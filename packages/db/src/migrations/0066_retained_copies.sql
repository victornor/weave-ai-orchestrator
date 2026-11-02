-- VS-955. The last retained-copy scan: one row per `workers/` checkout the daemon keeps because its
-- work has not landed. Replaced wholesale by each scan; the API, CLI and web app read it instead of
-- walking the disk. `copy_json` is the whole RetainedCopy; `bytes` and `class` are columns for sorting.
CREATE TABLE IF NOT EXISTS retained_copies (
  directory TEXT PRIMARY KEY,
  worker_id TEXT,
  class TEXT NOT NULL,
  bytes INTEGER,
  copy_json TEXT NOT NULL,
  scanned_at TEXT NOT NULL
);
