-- VS-478. A project's roadmap as ordered, named **blocks** of **pending tickets**, so the weaver can
-- collect related small asks, bundle them, and start a whole block as real tickets at once.
-- `roadmap_blocks` carries one block per project, in a dense manual order (`position`, zero-based per
-- project) with the lifecycle `open | started | dropped` — `done` is never stored, it is derived from
-- the block's linked tickets (see `roadmapBlockStatus` in packages/shared/src/enums.ts), so it cannot
-- drift from the work it describes. `project_id` carries `ON DELETE CASCADE` for the same reason
-- `0040`'s `roadmap_items` does: project removal is a soft archive that keeps the row, and a future
-- hard delete must take the blocks with it rather than strand them. No `workspace_id`: this database
-- is already one per workspace, and the project already carries it.
CREATE TABLE IF NOT EXISTS roadmap_blocks (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  position INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('open','started','dropped')) DEFAULT 'open',
  started_at TEXT,
  created_by_kind TEXT NOT NULL,
  created_by_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS roadmap_blocks_project_position ON roadmap_blocks (project_id, position);

-- The pending-ticket fields a roadmap item gains (VS-478). `block_id` is nullable — an item with no
-- block is a *loose item*, exactly VS-397's old behaviour, so no existing row is migrated or given a
-- block nobody chose; `ON DELETE SET NULL` means dropping a block later returns its items to loose
-- rather than deleting ideas. `description` is the markdown body the created ticket will carry,
-- separate from `notes` (the roadmap's own commentary). `kind`/`priority` reuse the ticket enums;
-- `role_id` is the target role, `ON DELETE SET NULL` so retiring a role cannot delete a pending
-- ticket. All are additive with defaults, so a pre-0043 row keeps its fields and reads as a loose
-- item with `kind` change, `priority` medium, no role and an empty description.
ALTER TABLE roadmap_items ADD COLUMN block_id TEXT REFERENCES roadmap_blocks(id) ON DELETE SET NULL;
ALTER TABLE roadmap_items ADD COLUMN description TEXT NOT NULL DEFAULT '';
ALTER TABLE roadmap_items ADD COLUMN kind TEXT NOT NULL CHECK (kind IN ('change','task','scout','question','operational')) DEFAULT 'change';
ALTER TABLE roadmap_items ADD COLUMN priority TEXT NOT NULL CHECK (priority IN ('critical','high','medium','low')) DEFAULT 'medium';
ALTER TABLE roadmap_items ADD COLUMN role_id TEXT REFERENCES roles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS roadmap_items_block_position ON roadmap_items (block_id, position);

-- What a merge absorbed (VS-478). Merging two pending tickets into one deletes the absorbed rows, so
-- their id/title/description are snapshotted here: the record has to outlive the rows it came from,
-- and `source_item_id` is therefore plain text with no foreign key. `item_id` is the survivor, and
-- `ON DELETE CASCADE` keeps the record attached to the item it explains.
CREATE TABLE IF NOT EXISTS roadmap_item_merges (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL REFERENCES roadmap_items(id) ON DELETE CASCADE,
  source_item_id TEXT NOT NULL,
  source_title TEXT NOT NULL,
  source_description TEXT NOT NULL DEFAULT '',
  merged_by_kind TEXT NOT NULL,
  merged_by_id TEXT,
  merged_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS roadmap_item_merges_item ON roadmap_item_merges (item_id);
