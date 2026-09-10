/**
 * Daemon-level system incidents (VS-174). Agents file them through `ac_incident`; the human reads
 * them on the global Incidents page. Lives in `daemon.sqlite`, not a workspace db.
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
  limit?: number;
}

export interface IncidentsService {
  create(input: IncidentCreateInput): Incident;
  get(id: string): Incident;
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

    get: read,

    list(query = {}) {
      const limit = Math.min(Math.max(query.limit ?? INCIDENT_LIST_DEFAULT, 1), INCIDENT_LIST_MAX);
      const reporter = query.reporterKind;
      if (reporter && !(INCIDENT_REPORTER_KINDS as readonly string[]).includes(reporter)) {
        throw new OcError('validation', `unknown reporter kind "${reporter}"`);
      }
      const where = reporter ? 'WHERE reporter_kind = ?' : '';
      const params = reporter ? [reporter] : [];
      const total = db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM incidents ${where}`, params)?.n ?? 0;
      const items = db.all<Incident>(
        `SELECT * FROM incidents ${where} ORDER BY created_at DESC, id DESC LIMIT ?`,
        [...params, limit],
      );
      return { items, total };
    },
  };
}
