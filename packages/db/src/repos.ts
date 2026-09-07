import { Db, bool } from './db.js';

/** Row → domain coercions shared by core services. No business logic here. */
export function ticketRow<T extends Record<string, unknown>>(r: T): T { return { ...r, autoMerge: bool(r.autoMerge), assigneeHuman: bool(r.assigneeHuman) }; }
export function projectRow<T extends Record<string, unknown>>(r: T): T { return { ...r, openspecEnabled: bool(r.openspecEnabled), warmPaths: (r as { warmPaths?: unknown }).warmPaths ?? [] }; }
export function decisionRow<T extends Record<string, unknown>>(r: T): T { return { ...r, allowFreeText: bool(r.allowFreeText), inputs: (r as { inputs?: unknown }).inputs ?? [] }; }
export function knowledgeRow<T extends Record<string, unknown>>(r: T): T { return { ...r, curationPending: bool(r.curationPending) }; }
export function threadRow<T extends Record<string, unknown>>(r: T): T { return { ...r, isPrimary: bool(r.isPrimary) }; }
export function workProductRow<T extends Record<string, unknown>>(r: T): T { return { ...r, isPrimary: bool(r.isPrimary) }; }
export function openDb(path: string): Db { const db = new Db(path); db.migrate(); return db; }

/**
 * A database as it stood before `through` was written — every migration up to and including that
 * file, and no more. For tests that need to seed rows on the old schema and then let the real open
 * migrate them; reopening with `openDb` applies the rest.
 */
export function openDbAsOf(path: string, through: string): Db { const db = new Db(path); db.migrate(through); return db; }
