/**
 * Daemon-level system incidents (VS-174). Agents file them through `ac_incident`; the human reads
 * them on the global Incidents page, the conductor through `ac_incident_list`/`ac_incident_get`
 * (VS-222), scoped to its own workspace. Lives in `daemon.sqlite`, not a workspace db.
 */
import { newId, nowIso, type Db } from '@agent-conductor/db';
import {
  INCIDENT_REPORTER_KINDS, OcError,
  type Incident, type IncidentReporterKind,
} from '@agent-conductor/shared';

export const INCIDENT_TITLE_MAX = 200;
export const INCIDENT_BODY_MAX = 2000;
export const INCIDENT_EVIDENCE_MAX = 8000;
export const INCIDENT_LIST_DEFAULT = 100;
export const INCIDENT_LIST_MAX = 200;

export interface IncidentCreateInput {
  reporterKind: IncidentReporterKind;
  title: string;
  whatFailed: string;
  tryingToDo: string;
  evidence?: string | null;
  workspaceId?: string | null;
  projectId?: string | null;
  ticketId?: string | null;
  agentId: string;
  runId: string;
  roleId?: string | null;
}

export interface IncidentListQuery {
  reporterKind?: IncidentReporterKind;
  /** Return only incidents created strictly after this ISO-8601 instant (VS-222). */
  since?: string;
  /** Scope to this workspace plus workspace-less (daemon-global) rows; unset returns every row. (VS-222) */
  workspaceId?: string;
  limit?: number;
}

/** Read scope for `get`: rows from another workspace are forbidden; workspace-less rows are daemon-global. (VS-222) */
export interface IncidentGetScope {
  workspaceId?: string;
}

export interface IncidentsService {
  create(input: IncidentCreateInput): Incident;
  get(id: string, scope?: IncidentGetScope): Incident;
  list(query?: IncidentListQuery): { items: Incident[]; total: number };
}

function trimRequired(label: string, value: string, max: number): string {
  const text = value.trim();
  if (!text) throw new OcError('validation', `${label} is required`);
  if (text.length > max) throw new OcError('validation', `${label} is at most ${max} characters`);
  return text;
}

function optionalText(value: string | null | undefined, max: number): string | null {
  if (value == null) return null;
  const text = value.trim();
  if (!text) return null;
  if (text.length > max) throw new OcError('validation', `evidence is at most ${max} characters`);
  return text;
}

export function createIncidentsService(db: Db): IncidentsService {
  const read = (id: string, scope?: IncidentGetScope): Incident => {
    const row = db.get<Incident>('SELECT * FROM incidents WHERE id = ?', [id]);
    if (!row) throw new OcError('not_found', `incident ${id} not found`);
    if (scope?.workspaceId && row.workspaceId && row.workspaceId !== scope.workspaceId) {
      throw new OcError('forbidden', `incident ${id} belongs to another workspace`);
    }
    return row;
  };

  return {
    create(input) {
      if (!(INCIDENT_REPORTER_KINDS as readonly string[]).includes(input.reporterKind)) {
        throw new OcError('validation', `unknown reporter kind "${input.reporterKind}"`);
      }
      const title = trimRequired('title', input.title, INCIDENT_TITLE_MAX);
      const whatFailed = trimRequired('whatFailed', input.whatFailed, INCIDENT_BODY_MAX);
      const tryingToDo = trimRequired('tryingToDo', input.tryingToDo, INCIDENT_BODY_MAX);
      const evidence = optionalText(input.evidence, INCIDENT_EVIDENCE_MAX);
      const id = newId();
      const createdAt = nowIso();
      db.insert('incidents', {
        id,
        reporterKind: input.reporterKind,
        title,
        whatFailed,
        tryingToDo,
        evidence,
        workspaceId: input.workspaceId ?? null,
        projectId: input.projectId ?? null,
        ticketId: input.ticketId ?? null,
        agentId: input.agentId,
        runId: input.runId,
        roleId: input.roleId ?? null,
        createdAt,
      });
      return read(id);
    },

    get: (id, scope) => read(id, scope),

    list(query = {}) {
      const limit = Math.min(Math.max(query.limit ?? INCIDENT_LIST_DEFAULT, 1), INCIDENT_LIST_MAX);
      const reporter = query.reporterKind;
      if (reporter && !(INCIDENT_REPORTER_KINDS as readonly string[]).includes(reporter)) {
        throw new OcError('validation', `unknown reporter kind "${reporter}"`);
      }
      const conds: string[] = [];
      const params: (string | number)[] = [];
      if (reporter) {
        conds.push('reporter_kind = ?');
        params.push(reporter);
      }
      if (query.since !== undefined) {
        const since = new Date(query.since);
        if (Number.isNaN(since.getTime())) throw new OcError('validation', 'since is not a valid ISO-8601 instant');
        // Normalized to the stored `nowIso()` format, so a bound without milliseconds compares as an
        // instant, not as a string prefix (VS-222).
        conds.push('created_at > ?');
        params.push(since.toISOString());
      }
      if (query.workspaceId) {
        conds.push('(workspace_id = ? OR workspace_id IS NULL)');
        params.push(query.workspaceId);
      }
      const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
      const total = db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM incidents ${where}`, params)?.n ?? 0;
      const items = db.all<Incident>(
        `SELECT * FROM incidents ${where} ORDER BY created_at DESC, id DESC LIMIT ?`,
        [...params, limit],
      );
      return { items, total };
    },
  };
}
