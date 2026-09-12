/**
 * Recurring conductor alarms (VS-220). Human-facing name is "Scheduled tasks"; the table,
 * HTTP, CLI and MCP identifiers stay `routine`. Fires go through `wake.enqueue({ source: 'routine' })`.
 */
import { newId, nowIso } from '@weave-ai/db';
import {
  OcError, ROUTINE_ACTIONS, ROUTINE_CONCURRENCY, ROUTINE_MAX_TICKETS_PER_FIRE, ROUTINE_STATUSES,
  ROUTINE_USAGE_WINDOWS, resolveUsageWindow,
  type Routine, type RoutineAction, type RoutineConcurrency, type RoutineFire, type RoutineListItem,
  type RoutineStatus, type RoutineTemplate, type RoutineTrigger, type RoutineUsage, type RoutineUsageWindow,
  type Wakeup,
} from '@weave-ai/shared';
import type { Actor, CoreServices, RoutineCreateInput, RoutinePatch, RoutinesService } from '../api.js';
import type { WorkspaceContext } from '../context.js';
import { recordActivity } from '../events.js';
import { flattenWakes } from '../prompts/index.js';
import { nextAfter, parseSchedule } from './schedule.js';

const LIVE_WAKE = new Set(['queued', 'claimed']);

function isAction(v: unknown): v is RoutineAction {
  return (ROUTINE_ACTIONS as readonly string[]).includes(String(v));
}

function parseTemplate(raw: { instruction: string; action?: unknown; maxTicketsPerFire?: unknown; projectId?: unknown }): RoutineTemplate {
  const instruction = raw.instruction.trim();
  if (!instruction) throw new OcError('validation', 'instruction is required');
  const action: RoutineAction = isAction(raw.action) ? raw.action : 'report';
  const defaultCap = action === 'file_work' ? 3 : 0;
  const cap = raw.maxTicketsPerFire === undefined || raw.maxTicketsPerFire === null ? defaultCap : Number(raw.maxTicketsPerFire);
  if (!Number.isInteger(cap) || cap < 0 || cap > ROUTINE_MAX_TICKETS_PER_FIRE) {
    throw new OcError('validation', `maxTicketsPerFire must be an integer 0-${ROUTINE_MAX_TICKETS_PER_FIRE}`);
  }
  const projectId = typeof raw.projectId === 'string' && raw.projectId.trim() ? raw.projectId.trim() : null;
  return { instruction, action, maxTicketsPerFire: cap, projectId };
}

function isThisRoutineWake(w: { source: string; payload: Record<string, unknown> }, routineId: string): boolean {
  return w.source === 'routine' && String(w.payload['routineId'] ?? '') === routineId;
}

function asRoutine(row: Routine): Routine {
  return {
    ...row,
    trigger: row.trigger,
    template: row.template,
    roleId: row.roleId ?? null,
    lastFiredAt: row.lastFiredAt ?? null,
    nextFireAt: row.nextFireAt ?? null,
    inFlightWakeId: row.inFlightWakeId ?? null,
    concurrency: (row.concurrency || 'skip_if_active') as RoutineConcurrency,
    status: row.status,
  };
}

export function createRoutinesService(ctx: WorkspaceContext, deps: () => CoreServices): RoutinesService {
  const log = ctx.log('routine');
  const ws = ctx.workspaceId;

  const get = (id: string): Routine => {
    const row = ctx.db.get<Routine>('SELECT * FROM routines WHERE workspace_id = ? AND id = ?', [ws, id]);
    if (!row) throw new OcError('not_found', `routine ${id} not found`);
    return asRoutine(row);
  };

  const write = (actor: Actor, id: string, fields: Record<string, unknown>, action: string, extra: Record<string, unknown> = {}): Routine => {
    const now = nowIso();
    ctx.db.update('routines', id, { ...fields, updatedAt: now });
    const next = get(id);
    recordActivity(ctx.db, ws, actor, action, 'routine', id, extra);
    return next;
  };

  const inFlightLive = (wakeId: string | null): boolean => {
    if (!wakeId) return false;
    const w = ctx.db.get<{ status: string }>('SELECT status FROM wakeups WHERE id = ?', [wakeId]);
    return Boolean(w && LIVE_WAKE.has(w.status));
  };

  const arm = (trigger: RoutineTrigger, from: string): string => nextAfter(trigger, from);

  return {
    list() {
      const rows = ctx.db.all<Routine>('SELECT * FROM routines WHERE workspace_id = ? ORDER BY name COLLATE NOCASE, created_at', [ws]).map(asRoutine);
      const counts = ctx.db.all<{ routineId: string; n: number }>(
        `SELECT json_extract(w.payload_json, '$.routineId') AS routine_id, COUNT(*) AS n
           FROM wakeups w
          WHERE w.workspace_id = ?
            AND w.source = 'routine'
            AND w.status != 'skipped'
          GROUP BY routine_id`,
        [ws],
      );
      const byId = new Map(counts.map((c) => [c.routineId, Number(c.n)]));
      return rows.map((r): RoutineListItem => ({ ...r, fireCount: byId.get(r.id) ?? 0 }));
    },

    get,

    create(actor, input) {
      const name = input.name.trim();
      if (!name) throw new OcError('validation', 'name is required');
      const trigger = parseSchedule(input.trigger);
      const template = parseTemplate({
        instruction: input.instruction,
        action: input.action,
        maxTicketsPerFire: input.maxTicketsPerFire,
        projectId: input.projectId,
      });
      if (template.projectId) {
        try { deps().projects.get(template.projectId); }
        catch { throw new OcError('not_found', `project ${template.projectId} not found`); }
      }
      const now = nowIso();
      const id = newId();
      ctx.db.insert('routines', {
        id, workspaceId: ws, name,
        triggerJson: trigger, templateJson: template,
        roleId: null, concurrency: 'skip_if_active', status: 'active',
        lastFiredAt: null, nextFireAt: arm(trigger, now), inFlightWakeId: null,
        createdAt: now, updatedAt: now,
      });
      const created = get(id);
      recordActivity(ctx.db, ws, actor, 'routine.create', 'routine', id, { name, action: template.action });
      ctx.events.emit('routine.created', 'routine', id, created);
      return created;
    },

    update(actor, id, patch) {
      const current = get(id);
      const fields: Record<string, unknown> = {};
      if (patch.name !== undefined) {
        const name = patch.name.trim();
        if (!name) throw new OcError('validation', 'name is required');
        fields.name = name;
      }
      let trigger = current.trigger;
      if (patch.trigger !== undefined) {
        trigger = parseSchedule(patch.trigger);
        fields.triggerJson = trigger;
      }
      const tmplPatch = {
        instruction: patch.instruction ?? current.template.instruction,
        action: patch.action ?? current.template.action,
        maxTicketsPerFire: patch.maxTicketsPerFire ?? current.template.maxTicketsPerFire,
        projectId: patch.projectId === undefined ? current.template.projectId : patch.projectId,
      };
      if (patch.instruction !== undefined || patch.action !== undefined || patch.maxTicketsPerFire !== undefined || patch.projectId !== undefined) {
        const template = parseTemplate(tmplPatch);
        if (template.projectId) {
          try { deps().projects.get(template.projectId); }
          catch { throw new OcError('not_found', `project ${template.projectId} not found`); }
        }
        fields.templateJson = template;
      }
      if (patch.status !== undefined) {
        if (!(ROUTINE_STATUSES as readonly string[]).includes(patch.status)) {
          throw new OcError('validation', `status must be ${ROUTINE_STATUSES.join('|')}`);
        }
        fields.status = patch.status;
        if (patch.status === 'active' && current.status === 'paused') {
          fields.nextFireAt = arm(trigger, nowIso());
        }
      }
      if (fields.triggerJson && current.status === 'active') {
        fields.nextFireAt = arm(trigger, nowIso());
      }
      if (!Object.keys(fields).length) return current;
      const next = write(actor, id, fields, 'routine.update', { keys: Object.keys(fields) });
      ctx.events.emit('routine.updated', 'routine', id, next);
      return next;
    },

    remove(actor, id) {
      get(id);
      ctx.db.run('DELETE FROM routines WHERE id = ? AND workspace_id = ?', [id, ws]);
      recordActivity(ctx.db, ws, actor, 'routine.remove', 'routine', id, {});
      ctx.events.emit('routine.removed', 'routine', id, { id });
    },

    fires(id) {
      get(id);
      const rows = ctx.db.all<{
        id: string;
        createdAt: string;
        status: string;
        runId: string | null;
      }>(
        `SELECT w.id, w.created_at, w.status,
                COALESCE(w.run_id, p.run_id) AS run_id
           FROM wakeups w
           LEFT JOIN wakeups p ON p.id = w.coalesced_into_id
          WHERE w.workspace_id = ?
            AND w.source = 'routine'
            AND json_extract(w.payload_json, '$.routineId') = ?
            AND w.status != 'skipped'
          ORDER BY w.created_at DESC, w.id DESC`,
        [ws, id],
      );
      const runCache = new Map<string, { status: string; summary: string | null; sharedTurn: boolean }>();
      const ofRun = (runId: string): { status: string; summary: string | null; sharedTurn: boolean } | null => {
        const hit = runCache.get(runId);
        if (hit) return hit;
        const run = ctx.db.get<{ status: string; summary: string | null; wakeupIds: string[] }>(
          'SELECT status, summary, wakeup_ids_json FROM runs WHERE id = ?',
          [runId],
        );
        if (!run) return null;
        const ids = run.wakeupIds ?? [];
        const claimed = ids.length
          ? ctx.db.all<Wakeup>(`SELECT * FROM wakeups WHERE id IN (${ids.map(() => '?').join(',')})`, ids)
          : [];
        const sharedTurn = flattenWakes(claimed).some((w) => !isThisRoutineWake(w, id));
        const val = { status: run.status, summary: run.summary ?? null, sharedTurn };
        runCache.set(runId, val);
        return val;
      };
      return rows.map((w): RoutineFire => {
        const run = w.runId ? ofRun(w.runId) : null;
        return {
          wakeId: w.id,
          runId: w.runId,
          firedAt: w.createdAt,
          status: run?.status ?? w.status,
          summary: run?.summary ?? null,
          sharedTurn: run?.sharedTurn ?? false,
        };
      });
    },

    usage(id, window, now) {
      get(id);
      if (!(ROUTINE_USAGE_WINDOWS as readonly string[]).includes(window)) {
        throw new OcError('validation', `window must be ${ROUTINE_USAGE_WINDOWS.join('|')}`);
      }
      const range = resolveUsageWindow(window as RoutineUsageWindow, undefined, now ?? new Date());
      const like = `routine:${id}:%`;
      const agg = ctx.db.get<{
        tokensIn: number; tokensOut: number; tokensCached: number; runs: number; costCents: number; costReportedCents: number;
      }>(
        `SELECT
            COALESCE(SUM(u.input_tokens), 0) AS tokensIn,
            COALESCE(SUM(u.output_tokens), 0) AS tokensOut,
            COALESCE(SUM(u.cached_input_tokens), 0) AS tokensCached,
            COUNT(DISTINCT u.run_id) AS runs,
            COALESCE(SUM(u.cost_cents), 0) AS costCents,
            COALESCE(SUM(CASE WHEN u.cost_status = 'reported' THEN u.cost_cents ELSE 0 END), 0) AS costReportedCents
          FROM usage_events u
          WHERE u.workspace_id = ?
            AND u.occurred_at >= ? AND u.occurred_at < ?
            AND (
              u.run_id IN (
                SELECT DISTINCT COALESCE(w.run_id, p.run_id)
                FROM wakeups w
                LEFT JOIN wakeups p ON p.id = w.coalesced_into_id
                WHERE w.workspace_id = ?
                  AND w.source = 'routine'
                  AND json_extract(w.payload_json, '$.routineId') = ?
                  AND COALESCE(w.run_id, p.run_id) IS NOT NULL
              )
              OR u.ticket_id IN (
                WITH RECURSIVE origin(id) AS (
                  SELECT id FROM tickets
                    WHERE workspace_id = ? AND origin_kind = 'routine' AND origin_fingerprint LIKE ?
                  UNION
                  SELECT t.id FROM tickets t JOIN origin ON t.parent_id = origin.id
                )
                SELECT id FROM origin
              )
            )`,
        [ws, range.start, range.end, ws, id, ws, like],
      );
      const out: RoutineUsage = {
        tokensIn: Number(agg?.tokensIn ?? 0),
        tokensOut: Number(agg?.tokensOut ?? 0),
        tokensCached: Number(agg?.tokensCached ?? 0),
        runs: Number(agg?.runs ?? 0),
        costCents: Number(agg?.costCents ?? 0),
        costReportedCents: Number(agg?.costReportedCents ?? 0),
        window,
      };
      return out;
    },

    fireDue(nowArg) {
      const now = nowArg ?? nowIso();
      const due = ctx.db.all<Routine>(
        `SELECT * FROM routines WHERE workspace_id = ? AND status = 'active' AND next_fire_at IS NOT NULL AND next_fire_at <= ? ORDER BY next_fire_at, created_at`,
        [ws, now],
      ).map(asRoutine);
      const fired: Routine[] = [];
      let conductorId: string;
      try { conductorId = deps().workers.conductor().id; }
      catch { log.warn('fireDue skipped: no conductor'); return fired; }

      for (const r of due) {
        if (r.concurrency !== 'skip_if_active' && !(ROUTINE_CONCURRENCY as readonly string[]).includes(r.concurrency)) {
          continue;
        }
        if (inFlightLive(r.inFlightWakeId)) continue;
        if (r.inFlightWakeId && !inFlightLive(r.inFlightWakeId)) {
          ctx.db.update('routines', r.id, { inFlightWakeId: null, updatedAt: now });
        }

        const dueStamp = r.nextFireAt!;
        const payload = {
          routineId: r.id,
          name: r.name,
          instruction: r.template.instruction,
          action: r.template.action,
          maxTicketsPerFire: r.template.maxTicketsPerFire,
          projectId: r.template.projectId ?? null,
        };
        const wake = deps().wake.enqueue(conductorId, {
          source: 'routine',
          reason: `scheduled task: ${r.name}`,
          payload,
          idempotencyKey: `routine:${r.id}:${dueStamp}`,
          requestedBy: { kind: 'system', id: null },
        });

        if (wake.status === 'skipped') {
          const skip = wake.skipReason ?? '';
          if (skip === 'agent_paused' || skip.startsWith('workspace_')) {
            log.debug({ routineId: r.id, skip }, 'fireDue retry next tick');
            continue;
          }
          log.warn({ routineId: r.id, skip }, 'fireDue skipped; advancing anyway');
          ctx.db.update('routines', r.id, {
            lastFiredAt: now,
            nextFireAt: arm(r.trigger, now),
            inFlightWakeId: null,
            updatedAt: now,
          });
          continue;
        }

        const liveId = wake.status === 'coalesced' && wake.coalescedIntoId ? wake.coalescedIntoId : wake.id;
        ctx.db.update('routines', r.id, {
          lastFiredAt: now,
          nextFireAt: arm(r.trigger, now),
          inFlightWakeId: liveId,
          updatedAt: now,
        });
        ctx.events.emit('routine.fired', 'routine', r.id, { wakeId: liveId, name: r.name });
        fired.push(get(r.id));
      }
      return fired;
    },

    onRunFinalized(wakes, nowArg) {
      const now = nowArg ?? nowIso();
      const ids = wakes.map((w) => w.id);
      if (!ids.length) return;
      const placeholders = ids.map(() => '?').join(',');
      const rows = ctx.db.all<Routine>(
        `SELECT * FROM routines WHERE workspace_id = ? AND in_flight_wake_id IN (${placeholders})`,
        [ws, ...ids],
      );
      for (const raw of rows) {
        const r = asRoutine(raw);
        const patch: Record<string, unknown> = { inFlightWakeId: null, updatedAt: now };
        if (r.nextFireAt && r.nextFireAt <= now) {
          patch.nextFireAt = arm(r.trigger, now);
        }
        ctx.db.update('routines', r.id, patch);
      }
    },
  };
}

export function isRoutineConcurrency(v: unknown): v is RoutineConcurrency {
  return (ROUTINE_CONCURRENCY as readonly string[]).includes(String(v));
}

export type { Wakeup, RoutineStatus };
