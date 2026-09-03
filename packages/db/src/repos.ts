import { Db, bool } from './db.js';

/** Row → domain coercions shared by core services. No business logic here. */
export function ticketRow<T extends Record<string, unknown>>(r: T): T { return { ...r, autoMerge: bool(r.autoMerge), assigneeHuman: bool(r.assigneeHuman) }; }
export function projectRow<T extends Record<string, unknown>>(r: T): T { return { ...r, openspecEnabled: bool(r.openspecEnabled), warmPaths: (r as { warmPaths?: unknown }).warmPaths ?? [] }; }
export function decisionRow<T extends Record<string, unknown>>(r: T): T { return { ...r, allowFreeText: bool(r.allowFreeText) }; }
export function knowledgeRow<T extends Record<string, unknown>>(r: T): T { return { ...r, curationPending: bool(r.curationPending) }; }
export function threadRow<T extends Record<string, unknown>>(r: T): T { return { ...r, isPrimary: bool(r.isPrimary) }; }
export function workProductRow<T extends Record<string, unknown>>(r: T): T { return { ...r, isPrimary: bool(r.isPrimary) }; }
export function openDb(path: string): Db { const db = new Db(path); db.migrate(); return db; }
