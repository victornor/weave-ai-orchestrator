/**
 * `changelogEntry` — one `activity` row, one changelog entry (PLAN §13.6). The record is a projection
 * over the activity table rather than a log of its own, so the one-line summary is rendered here at
 * read time rather than stored: the daemon, the web app and the CLI all call this, which is what makes
 * the same entry read identically everywhere, and a wording fix applies to the whole history at once
 * without rewriting an append-only row.
 *
 * Every detail field is treated as absent-until-proven-present. An old row whose service has since
 * changed what it records degrades to a plainer line rather than to an empty or a broken one.
 */
import { CHANGELOG_SOURCES, type ChangelogEntry, type ChangelogKind } from '@weave-ai/shared';
import { oneLine } from './format.js';

/** An activity row as the changelog reads it, with `details_json` already decoded. */
export interface ActivityRow {
  id: string;
  action: string;
  actorKind: string;
  actorId: string | null;
  entityType: string;
  entityId: string;
  ticketId: string | null;
  projectId: string | null;
  details: Record<string, unknown>;
  createdAt: string;
}

/** What the row cannot carry itself: the names the reader recognises. */
export interface ChangelogContext {
  ticketIdentifier?: string | null;
  ticketTitle?: string | null;
  /** The role's or the project's display name, for entries that are not about a ticket. */
  entityName?: string | null;
  /** How the actor should read: a person's name, a role's name, `conductor`. */
  actorLabel?: string | null;
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null);

/** The changelog kind an activity row projects to, or null when the row is operational detail. */
export function changelogKindOf(action: string, details: Record<string, unknown> = {}): ChangelogKind | null {
  for (const [kind, source] of Object.entries(CHANGELOG_SOURCES)) {
    if (source.action !== action) continue;
    if (source.detail && str(details[source.detail.key]) !== source.detail.value) continue;
    return kind as ChangelogKind;
  }
  return null;
}

/** How the actor reads in an entry. `system` is the daemon acting on its own. */
function actorOf(row: ActivityRow, ctx: ChangelogContext): ChangelogEntry['actor'] {
  const kind = (row.actorKind === 'human' || row.actorKind === 'agent' ? row.actorKind : 'system') as ChangelogEntry['actor']['kind'];
  const label = str(ctx.actorLabel) ?? (kind === 'human' ? 'the workspace owner' : kind === 'agent' ? 'an agent' : 'the daemon');
  return { kind, id: row.actorId, label };
}

/**
 * The summary line. Each kind names what happened and the one thing that identifies it; the ticket's
 * own identifier is carried in its own field, so it is not repeated here.
 */
function summaryOf(kind: ChangelogKind, row: ActivityRow, ctx: ChangelogContext): string {
  const title = str(ctx.ticketTitle);
  const named = str(ctx.entityName);
  const d = row.details;
  switch (kind) {
    case 'filed': {
      const ticketKind = str(d.kind);
      return oneLine(`Filed${ticketKind ? ` ${ticketKind}` : ''}${title ? `: ${title}` : ''}`);
    }
    case 'plan_approved':
      return oneLine(`Plan approved${title ? `: ${title}` : ''}`);
    case 'pr_opened':
      return oneLine(`Pull request opened${title ? ` for ${title}` : ''}`);
    case 'landed': {
      const mode = str(d.mode) ?? str(d.detail);
      return oneLine(`Landed${title ? `: ${title}` : ''}${mode ? ` (${mode})` : ''}`);
    }
    case 'cancelled': {
      const reason = str(d.reason);
      return oneLine(`Cancelled${title ? `: ${title}` : ''}${reason ? ` — ${reason}` : ''}`);
    }
    case 'hired': {
      const project = str(d.project);
      return oneLine(`Hired ${named ?? 'a role'}${project ? ` for ${project}` : ''}`);
    }
    case 'upgraded': {
      const to = str(d.toRelease) ?? str(d.version);
      const from = str(d.fromRelease);
      if (to && from) return oneLine(`Daemon upgraded from ${from} to ${to}`);
      return oneLine(`Daemon upgraded${to ? ` to ${to}` : ''}`);
    }
  }
}

/** Where the entry points: a pull request goes to the forge, everything about a ticket to the ticket. */
function linkOf(kind: ChangelogKind, row: ActivityRow): ChangelogEntry['link'] {
  if (kind === 'pr_opened') {
    const url = str(row.details.url);
    if (url) return { kind: 'url', target: url };
  }
  return row.ticketId ? { kind: 'ticket', target: row.ticketId } : null;
}

/** One activity row as a changelog entry, or null when the row is not one of the projected kinds. */
export function changelogEntry(row: ActivityRow, ctx: ChangelogContext = {}): ChangelogEntry | null {
  const kind = changelogKindOf(row.action, row.details);
  if (!kind) return null;
  return {
    id: row.id,
    at: row.createdAt,
    kind,
    actor: actorOf(row, ctx),
    projectId: row.projectId,
    ticketId: row.ticketId,
    ticketIdentifier: str(ctx.ticketIdentifier),
    summary: summaryOf(kind, row, ctx),
    link: linkOf(kind, row),
  };
}

// ---------------------------------------------------------------- timeline grouping

/**
 * The heatmap and the timeline separators have to agree on where a day starts, and they only do if
 * both bucket in the same named timezone. SQLite can express a fixed offset but not an IANA zone,
 * which is wrong across a DST boundary and so wrong for part of any one-year range — so day bucketing
 * lives here, in one pure function both sides call.
 */
const dayFormatters = new Map<string, Intl.DateTimeFormat>();

function dayFormatter(timezone: string): Intl.DateTimeFormat {
  let f = dayFormatters.get(timezone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' });
    dayFormatters.set(timezone, f);
  }
  return f;
}

/** The `YYYY-MM-DD` an instant falls on in `timezone`. `en-CA` formats exactly that way. */
export function dayKey(at: string | Date, timezone: string): string {
  return dayFormatter(timezone).format(at instanceof Date ? at : new Date(at));
}

/** The Monday-based ISO week a `YYYY-MM-DD` belongs to, as its own `YYYY-MM-DD`. */
export function weekKey(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  // getUTCDay is 0 on Sunday; shift so Monday starts the week.
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

/** The `YYYY-MM` a `YYYY-MM-DD` belongs to. */
export function monthKey(day: string): string {
  return day.slice(0, 7);
}

export interface TimelineGroup {
  day: string;
  week: string;
  month: string;
  /** True on the first group of a new week or month, which is where the heavier separator goes. */
  startsWeek: boolean;
  startsMonth: boolean;
  entries: ChangelogEntry[];
}

/**
 * Entries, newest first, grouped into the days they fall on in `timezone`. A group is marked as
 * starting a week or a month when it is the first group of one *in the direction the reader reads*,
 * which — because the list runs newest first — is the oldest day of that period in the list.
 */
export function groupTimeline(entries: ChangelogEntry[], timezone: string): TimelineGroup[] {
  const groups: TimelineGroup[] = [];
  for (const entry of entries) {
    const day = dayKey(entry.at, timezone);
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.entries.push(entry);
    else groups.push({ day, week: weekKey(day), month: monthKey(day), startsWeek: false, startsMonth: false, entries: [entry] });
  }
  // Newest first, so a period's boundary is the last group carrying it.
  for (let i = 0; i < groups.length; i += 1) {
    const g = groups[i]!;
    const older = groups[i + 1];
    g.startsWeek = !older || older.week !== g.week;
    g.startsMonth = !older || older.month !== g.month;
  }
  return groups;
}
