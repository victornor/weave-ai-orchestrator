# ADR 0001 — node:sqlite with hand-written SQL instead of Drizzle + better-sqlite3

Date: 2026-09-04 · Status: accepted

## Context
PLAN §4.2 specified SQLite via better-sqlite3 + Drizzle ORM. On the target machine (Node 26.7) better-sqlite3 12.x has no prebuilt binary and needs a native build; pnpm 11 additionally blocks build scripts by default. Node ≥ 22.5 ships `node:sqlite` (DatabaseSync) with WAL, prepared statements and FTS5.

## Decision
Use `node:sqlite` through a small typed wrapper (`packages/db/src/db.ts`: get/all/run/insert/update/transaction, snake_case ↔ camelCase mapping, `*_json` column decoding) and plain SQL migrations in `packages/db/src/migrations/*.sql`. No ORM. Schema constraints (CHECK enums, partial unique indexes) live in SQL.

## Consequences
- Zero native dependencies; one fewer build step; the daemon runs wherever Node ≥ 22.5 runs.
- Queries are hand-written; the repo layer keeps them small and colocated with services. Drizzle's type inference is replaced by the shared DTO types in `@agent-conductor/shared`.
- Migrations are forward-only SQL files applied in order and recorded in `meta`.
