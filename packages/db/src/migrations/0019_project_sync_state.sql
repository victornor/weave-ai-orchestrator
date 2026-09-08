-- VS-131. How a project's primary clone compares to origin/<landingBranch>. Additive and
-- reversible (drop the column): every existing row defaults to 'in_sync' until the next fetch or
-- sync check recomputes it, which is honest — nothing has observed a diverged clone before this.
ALTER TABLE projects ADD COLUMN sync_state TEXT NOT NULL DEFAULT 'in_sync'
  CHECK (sync_state IN ('in_sync', 'behind', 'diverged'));
