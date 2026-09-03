import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ulid } from 'ulid';

export type Row = Record<string, unknown>;
export type Params = Record<string, SQLInputValue> | SQLInputValue[];

const here = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(here, 'migrations');

/** Thin typed wrapper over node:sqlite with camelCase row mapping and migrations. One instance per workspace. */
export class Db {
  readonly sqlite: DatabaseSync;
  constructor(public readonly path: string) {
    this.sqlite = new DatabaseSync(path);
    this.sqlite.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  }
  migrate(): void {
    this.sqlite.exec('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
    const applied = new Set(this.all<{ value: string }>("SELECT value FROM meta WHERE key LIKE 'migration:%'").map((r) => r.value));
    const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
    for (const f of files) {
      if (applied.has(f)) continue;
      const sql = readFileSync(join(MIGRATIONS_DIR, f), 'utf8');
      this.sqlite.exec('BEGIN');
      try { this.sqlite.exec(sql); this.sqlite.prepare("INSERT INTO meta(key, value) VALUES (?, ?)").run(`migration:${f}`, f); this.sqlite.exec('COMMIT'); }
      catch (e) { this.sqlite.exec('ROLLBACK'); throw e; }
    }
  }
  close(): void { this.sqlite.close(); }
  run(sql: string, params: Params = []): { changes: number; lastInsertRowid: number | bigint } {
    const st = this.sqlite.prepare(sql);
    const r = Array.isArray(params) ? st.run(...params) : st.run(params as Record<string, SQLInputValue>);
    return { changes: Number(r.changes), lastInsertRowid: r.lastInsertRowid };
  }
  get<T = Row>(sql: string, params: Params = []): T | undefined {
    const st = this.sqlite.prepare(sql);
    const r = Array.isArray(params) ? st.get(...params) : st.get(params as Record<string, SQLInputValue>);
    return r === undefined ? undefined : (camel(r as Row) as T);
  }
  all<T = Row>(sql: string, params: Params = []): T[] {
    const st = this.sqlite.prepare(sql);
    const rows = Array.isArray(params) ? st.all(...params) : st.all(params as Record<string, SQLInputValue>);
    return rows.map((r) => camel(r as Row) as T);
  }
  transaction<T>(fn: () => T): T {
    this.sqlite.exec('BEGIN IMMEDIATE');
    try { const r = fn(); this.sqlite.exec('COMMIT'); return r; }
    catch (e) { this.sqlite.exec('ROLLBACK'); throw e; }
  }
  /** Insert helper: object keys are camelCase, mapped to snake_case columns. Values that are objects/arrays are JSON-encoded when the column ends with _json. */
  insert(table: string, obj: Record<string, unknown>): void {
    const cols: string[] = []; const vals: SQLInputValue[] = [];
    for (const [k, v] of Object.entries(obj)) { if (v === undefined) continue; cols.push(snake(k)); vals.push(encode(k, v)); }
    this.run(`INSERT INTO ${table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`, vals);
  }
  update(table: string, id: string, obj: Record<string, unknown>): number {
    const sets: string[] = []; const vals: SQLInputValue[] = [];
    for (const [k, v] of Object.entries(obj)) { if (v === undefined) continue; sets.push(`${snake(k)} = ?`); vals.push(encode(k, v)); }
    if (!sets.length) return 0;
    vals.push(id);
    return this.run(`UPDATE ${table} SET ${sets.join(', ')} WHERE id = ?`, vals).changes;
  }
}

function encode(key: string, v: unknown): SQLInputValue {
  if (v === null) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'number' || typeof v === 'string' || typeof v === 'bigint') return v;
  if (v instanceof Uint8Array) return v;
  if (key.endsWith('Json') || typeof v === 'object') return JSON.stringify(v);
  return String(v);
}
export function snake(s: string): string { return s.replace(/[A-Z]/g, (c) => '_' + c.toLowerCase()); }
export function camelKey(s: string): string { return s.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase()); }
/** Map a row: snake→camel; `*_json` columns decoded and suffix dropped; integer 0/1 left as numbers (callers coerce booleans). */
export function camel(row: Row): Row {
  const out: Row = {};
  for (const [k, v] of Object.entries(row)) {
    if (k.endsWith('_json')) { const key = camelKey(k.slice(0, -5)); out[key] = typeof v === 'string' ? safeJson(v) : v; }
    else out[camelKey(k)] = v;
  }
  return out;
}
function safeJson(s: string): unknown { try { return JSON.parse(s); } catch { return null; } }
export const newId = (): string => ulid();
export const nowIso = (): string => new Date().toISOString();
export const bool = (v: unknown): boolean => v === 1 || v === true || v === '1';
