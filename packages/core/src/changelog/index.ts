/**
 * The changelog (PLAN §13.6): the human-facing record of what happened in a workspace and in each of
 * its projects. It is a read-only projection over the `activity` table, not a log of its own — the
 * daemon has always recorded these events and never read them back, so the record needs no backfill
 * step and no second write path that could disagree with the first.
 *
 * It is deliberately not a knowledge file: no budget, no curation, no place in any agent's context.
 * Nothing here writes, and no route or tool exposes a write, which is what makes it append-only.
 */
import type { Db } from '@weave-ai/db';
import {
  CHANGELOG_KINDS, CHANGELOG_MEASURE_KIND, CHANGELOG_SOURCES, OcError,
  type ChangelogDay, type ChangelogHeatmap, type ChangelogKind, type ChangelogPage,
} from '@weave-ai/shared';
import { changelogEntry, dayKey, type ActivityRow } from '@weave-ai/render';
import type { ChangelogHeatmapQuery, ChangelogQuery, ChangelogService, CoreServices } from '../api.js';
import type { WorkspaceContext } from '../context.js';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
/** A year plus the days needed to square off the calendar grid the heatmap draws. */
const DEFAULT_HEATMAP_DAYS = 371;

/**
 * The `WHERE` that selects exactly the projected actions. Two kinds share an action with rows that are
 * not changelog entries at all, so those carry a `json_extract` on the detail that distinguishes them
 * — `ticket.transition` fires on every status edge, `ticket.work_product` records branches and reports.
 */
const PROJECTION = CHANGELOG_KINDS.map((kind) => {
  const source = CHANGELOG_SOURCES[kind];
  return source.detail
    ? `(action = '${source.action}' AND json_extract(details_json, '$.${source.detail.key}') = '${source.detail.value}')`
    : `action = '${source.action}'`;
}).join(' OR ');

interface Row extends Omit<ActivityRow, 'details'> {
  details: string | Record<string, unknown>;
  identifier: string | null;
  ticketTitle: string | null;
  roleName: string | null;
  projectSlug: string | null;
}

/**
 * The names a row cannot carry itself. Left-joined rather than looked up per row: a page is 50 rows and
 * three joins beat 150 point queries, and a ticket that has since been hard-deleted simply reads null.
 */
const SELECT = `
  SELECT a.id, a.action, a.actor_kind, a.actor_id, a.entity_type, a.entity_id, a.ticket_id, a.project_id,
         a.details_json AS details, a.created_at,
         t.identifier AS identifier, t.title AS ticket_title, r.name AS role_name, p.slug AS project_slug
    FROM activity a
    LEFT JOIN tickets t ON t.id = a.ticket_id
    LEFT JOIN roles r ON r.id = a.entity_id AND a.entity_type = 'role'
    LEFT JOIN projects p ON p.id = a.project_id
   WHERE a.workspace_id = ? AND (${PROJECTION.replace(/\b(action|details_json)\b/g, 'a.$1')})`;

const decode = (v: string | Record<string, unknown>): Record<string, unknown> => {
  if (typeof v !== 'string') return v ?? {};
  try { const parsed: unknown = JSON.parse(v); return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {}; }
  catch { return {}; }
};

/** The cursor is the ordering key itself, so paging needs no server state. */
const encodeCursor = (row: { createdAt: string; id: string }): string => `${row.createdAt}|${row.id}`;
function decodeCursor(cursor: string): { at: string; id: string } {
  const at = cursor.slice(0, cursor.lastIndexOf('|'));
  const id = cursor.slice(cursor.lastIndexOf('|') + 1);
  if (!at || !id) throw new OcError('validation', `not a changelog cursor: ${cursor}`);
  return { at, id };
}

const toEntry = (row: Row) => changelogEntry(
  { ...row, details: decode(row.details) },
  {
    ticketIdentifier: row.identifier,
    ticketTitle: row.ticketTitle,
    entityName: row.roleName ?? row.projectSlug,
    actorLabel: row.actorKind === 'agent' ? 'an agent' : null,
  },
);

/** `YYYY-MM-DD` is what the day bucketing produces and what a range is expressed in. */
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const addDays = (day: string, n: number): string => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

export function createChangelogService(ctx: WorkspaceContext, _deps: () => CoreServices): ChangelogService {
  const db: Db = ctx.db;
  const ws = ctx.workspaceId;
  const defaultZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

  /**
   * An unknown project must say so rather than answer an empty changelog: an empty record and a
   * mistyped id look identical to the reader, and only one of them is worth acting on.
   */
  function requireProject(projectId?: string | null): string | null {
    if (!projectId) return null;
    const found = db.get<{ id: string }>('SELECT id FROM projects WHERE workspace_id = ? AND (id = ? OR slug = ?)', [ws, projectId, projectId]);
    if (!found) throw new OcError('not_found', `project ${projectId} not found`);
    return found.id;
  }

  function zoneOf(timezone?: string | null): string {
    const tz = timezone?.trim() || defaultZone;
    try { new Intl.DateTimeFormat('en-CA', { timeZone: tz }); return tz; }
    catch { throw new OcError('validation', `not a known timezone: ${tz}`); }
  }

  return {
    list(q: ChangelogQuery = {}): ChangelogPage {
      const limit = Math.min(Math.max(1, q.limit ?? DEFAULT_LIMIT), MAX_LIMIT);
      const projectId = requireProject(q.projectId);
      const params: Array<string | number> = [ws];
      let sql = SELECT;
      if (projectId) { sql += ' AND a.project_id = ?'; params.push(projectId); }
      if (q.before) {
        // (created_at, id) descending is a total order: ids are ULIDs, so they break a tie within a
        // timestamp. A row inserted while a caller pages sorts above the cursor and never appears here.
        const { at, id } = decodeCursor(q.before);
        sql += ' AND (a.created_at < ? OR (a.created_at = ? AND a.id < ?))';
        params.push(at, at, id);
      }
      // One more than asked for, so "is there anything older" needs no second query.
      sql += ' ORDER BY a.created_at DESC, a.id DESC LIMIT ?';
      params.push(limit + 1);

      const rows = db.all<Row>(sql, params);
      const page = rows.slice(0, limit);
      const entries = page.map(toEntry).filter((e): e is NonNullable<typeof e> => e !== null);
      const last = page[page.length - 1];
      return { entries, nextCursor: rows.length > limit && last ? encodeCursor(last) : null };
    },

    heatmap(q: ChangelogHeatmapQuery = {}): ChangelogHeatmap {
      const timezone = zoneOf(q.timezone);
      const to = q.to?.trim() || dayKey(new Date(), timezone);
      if (!DAY_RE.test(to)) throw new OcError('validation', `not a date: ${to}`);
      const from = q.from?.trim() || addDays(to, -(DEFAULT_HEATMAP_DAYS - 1));
      if (!DAY_RE.test(from)) throw new OcError('validation', `not a date: ${from}`);
      if (from > to) throw new OcError('validation', `the range starts after it ends: ${from} to ${to}`);

      const projectId = requireProject(q.projectId);
      const params: Array<string> = [ws];
      let sql = `${SELECT}`;
      if (projectId) { sql += ' AND a.project_id = ?'; params.push(projectId); }
      // Widen the instant range by a day either side: a day in `timezone` can reach up to 14 hours
      // past the same UTC date in either direction, and the bucketing below discards the overhang.
      sql += ' AND a.created_at >= ? AND a.created_at < ?';
      params.push(`${addDays(from, -1)}T00:00:00.000Z`, `${addDays(to, 2)}T00:00:00.000Z`);

      const empty = (): Record<ChangelogKind, number> =>
        Object.fromEntries(CHANGELOG_KINDS.map((k) => [k, 0])) as Record<ChangelogKind, number>;

      const byDay = new Map<string, ChangelogDay>();
      for (const row of db.all<Row>(sql, params)) {
        const entry = toEntry(row);
        if (!entry) continue;
        const date = dayKey(entry.at, timezone);
        if (date < from || date > to) continue;   // the overhang the widened range pulled in
        let day = byDay.get(date);
        if (!day) { day = { date, landed: 0, total: 0, byKind: empty() }; byDay.set(date, day); }
        day.byKind[entry.kind] += 1;
        day.total += 1;
        if (entry.kind === CHANGELOG_MEASURE_KIND) day.landed += 1;
      }

      // Dense: every day in the range, so the grid needs no gap filling and a quiet day reads as zero.
      const days: ChangelogDay[] = [];
      for (let date = from; date <= to; date = addDays(date, 1)) {
        days.push(byDay.get(date) ?? { date, landed: 0, total: 0, byKind: empty() });
      }

      return {
        days,
        timezone,
        measure: {
          kind: CHANGELOG_MEASURE_KIND,
          label: 'Tickets landed',
          definition: 'Tickets whose work reached the repository that day.',
        },
      };
    },
  };
}
