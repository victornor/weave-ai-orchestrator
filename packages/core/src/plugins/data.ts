/**
 * Backs `PluginHost.store` (VS-334): a namespaced, durable document store per plugin, in the
 * `plugin_data` table (migration 0035). `Db.update`'s single-`id` assumption doesn't fit this
 * table's composite `(plugin_id, key)` primary key, so `put` is a hand-written upsert.
 */
import { nowIso, type Db } from '@weave-ai/db';

function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export class PluginDataService {
  constructor(private readonly db: Db) {}

  get(pluginId: string, key: string): unknown | null {
    // `Db.camel()` strips the whole `_json` suffix, not just snake->camel — `value_json` decodes to
    // a `value` property, not `valueJson`. Verified against the real row shape, not assumed.
    const row = this.db.get<{ value: unknown }>('SELECT value_json FROM plugin_data WHERE plugin_id = ? AND key = ?', [pluginId, key]);
    return row === undefined ? null : row.value;
  }

  put(pluginId: string, key: string, value: unknown): void {
    this.db.run(
      `INSERT INTO plugin_data (plugin_id, key, value_json, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (plugin_id, key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
      [pluginId, key, JSON.stringify(value), nowIso()],
    );
  }

  delete(pluginId: string, key: string): void {
    this.db.run('DELETE FROM plugin_data WHERE plugin_id = ? AND key = ?', [pluginId, key]);
  }

  list(pluginId: string, prefix?: string): Array<{ key: string; value: unknown }> {
    const rows = prefix
      ? this.db.all<{ key: string; value: unknown }>(
          "SELECT key, value_json FROM plugin_data WHERE plugin_id = ? AND key LIKE ? ESCAPE '\\' ORDER BY key",
          [pluginId, `${escapeLike(prefix)}%`],
        )
      : this.db.all<{ key: string; value: unknown }>('SELECT key, value_json FROM plugin_data WHERE plugin_id = ? ORDER BY key', [pluginId]);
    return rows.map((r) => ({ key: r.key, value: r.value }));
  }

  /** Removes every row for `pluginId` — the operator-only purge, never reachable from a plugin's own routes or a page's bridge. */
  purge(pluginId: string): number {
    return this.db.run('DELETE FROM plugin_data WHERE plugin_id = ?', [pluginId]).changes;
  }
}
