/**
 * Daemon-level system incidents (VS-174). Agents file them through `weave_incident`; the human reads
 * them on the global Incidents page and the conductor through `weave_incident_list`/`weave_incident_get`
 * (VS-222). Since VS-499 reads span every workspace: the conductor that owns Weave AI must be able to
 * see and close the incidents the other workspaces file. Lives in `daemon.sqlite`, not a workspace db.
 */
import { newId, nowIso, type Db } from '@weave-ai/db';
import {
  INCIDENT_REPORTER_KINDS, OcError,
  type Incident, type IncidentReporterKind, type IncidentStatusFilter,
} from '@weave-ai/shared';

export const INCIDENT_TITLE_MAX = 200;
export const INCIDENT_BODY_MAX = 2000;
export const INCIDENT_EVIDENCE_MAX = 8000;
export const INCIDENT_LIST_DEFAULT = 100;
export const INCIDENT_LIST_MAX = 200;
export const INCIDENT_RESOLUTION_MAX = 2000;

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
  /**
   * Narrow to the incidents filed from exactly this workspace. Unset returns every row across every
   * workspace (VS-499) — the deliberate narrowing filter, not a caller-scope. A workspace-less row is
   * not filed from any workspace, so it is excluded when this is set.
   */
  workspaceId?: string;
  limit?: number;
  /** Filters on resolution state; unset (like `all`) applies no filter (VS-271). No default here — see `weave_incident_list`. */
  status?: IncidentStatusFilter;
}

/** Input to `resolve` (VS-271): the reason is required, the ticket reference is optional and unvalidated. */
export interface IncidentResolveInput {
  resolution: string;
  resolvedByAgentId: string;
  /** The resolving run's workspace (VS-499); recorded so a cross-workspace resolve keeps both sides of the audit trail. */
  resolvedByWorkspaceId?: string | null;
  ticketId?: string | null;
}

export interface IncidentsService {
  create(input: IncidentCreateInput): Incident;
  get(id: string): Incident;
  list(query?: IncidentListQuery): { items: Incident[]; total: number };
  resolve(id: string, input: IncidentResolveInput): Incident;
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
  const read = (id: string): Incident => {
    const row = db.get<Incident>('SELECT * FROM incidents WHERE id = ?', [id]);
    if (!row) throw new OcError('not_found', `incident ${id} not found`);
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

    get: (id) => read(id),

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
        conds.push('workspace_id = ?');
        params.push(query.workspaceId);
      }
      // No default here: unset behaves like 'all'. `weave_incident_list` defaults to 'open' in its own
      // input schema so the default cannot leak into this service's other caller, `GET
      // /api/incidents` (VS-271).
      if (query.status === 'open') {
        conds.push('resolved_at IS NULL');
      } else if (query.status === 'resolved') {
        conds.push('resolved_at IS NOT NULL');
      }
      const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
      const total = db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM incidents ${where}`, params)?.n ?? 0;
      const items = db.all<Incident>(
        `SELECT * FROM incidents ${where} ORDER BY created_at DESC, id DESC LIMIT ?`,
        [...params, limit],
      );
      return { items, total };
    },

    resolve(id, input) {
      const row = read(id);
      if (row.resolvedAt) {
        throw new OcError('wrong_status', `incident ${id} is already resolved`, {
          resolvedAt: row.resolvedAt,
          resolvedByAgentId: row.resolvedByAgentId,
          resolution: row.resolution,
        });
      }
      const resolution = trimRequired('resolution', input.resolution, INCIDENT_RESOLUTION_MAX);
      db.update('incidents', id, {
        resolvedAt: nowIso(),
        resolvedByAgentId: input.resolvedByAgentId,
        resolvedByWorkspaceId: input.resolvedByWorkspaceId ?? null,
        resolution,
        resolutionTicketId: input.ticketId ?? null,
      });
      return read(id);
    },
  };
}
