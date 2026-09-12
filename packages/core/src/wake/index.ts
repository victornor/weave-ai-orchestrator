import { newId, nowIso } from '@weave-ai/db';
import { OcError, type Wakeup, type WakeStatus } from '@weave-ai/shared';
import type { WorkspaceContext } from '../context.js';
import type { CoreServices, EnqueueInput, WakeService } from '../api.js';
import { recordActivity } from '../events.js';

interface AgentLite { id: string; kind: string; status: string; roleId: string | null }

function row(ctx: WorkspaceContext, id: string): Wakeup {
  const w = ctx.db.get<Wakeup>('SELECT * FROM wakeups WHERE id = ?', [id]);
  if (!w) throw new OcError('not_found', `wakeup ${id} not found`);
  return { ...w, payload: (w.payload ?? {}) as Record<string, unknown> };
}

/** PLAN §7.1: the single funnel into the wake queue. Every suppressed wake is recorded with a reason. */
export function createWakeService(ctx: WorkspaceContext, _deps: () => CoreServices): WakeService {
  const log = ctx.log('wake');

  const insert = (agentId: string, input: EnqueueInput, status: WakeStatus, extra: Record<string, unknown> = {}): Wakeup => {
    const id = newId();
    ctx.db.insert('wakeups', {
      id,
      workspaceId: ctx.workspaceId,
      agentId,
      source: input.source,
      reason: input.reason,
      payloadJson: input.payload ?? {},
      idempotencyKey: input.idempotencyKey ?? null,
      status,
      notBefore: input.notBefore ?? null,
      requestedByKind: input.requestedBy?.kind ?? 'system',
      requestedById: input.requestedBy?.id ?? null,
      createdAt: nowIso(),
      ...extra,
    });
    return row(ctx, id);
  };

  const skip = (agentId: string, input: EnqueueInput, reason: string): Wakeup => {
    const w = insert(agentId, input, 'skipped', { skipReason: reason, finishedAt: nowIso() });
    ctx.events.emit('wake.skipped', 'wakeup', w.id, { agentId, source: input.source, reason: input.reason, skipReason: reason });
    log.debug({ agentId, source: input.source, skipReason: reason }, 'wake skipped');
    return w;
  };

  return {
    enqueue(agentId: string, input: EnqueueInput): Wakeup {
      const agent = ctx.db.get<AgentLite>('SELECT id, kind, status, role_id FROM agents WHERE id = ? AND workspace_id = ?', [agentId, ctx.workspaceId]);
      if (!agent) throw new OcError('not_found', `agent ${agentId} not found`);

      // Gate 0: idempotency — a live wake with the same key wins. Skipped/cancelled/failed do not
      // consume the key (VS-154): `wakeups_idem` is UNIQUE on (agent_id, idempotency_key), so the
      // dead row's key is cleared and a later enqueue can insert a new queued wake.
      if (input.idempotencyKey) {
        const existing = ctx.db.get<{ id: string; status: string }>('SELECT id, status FROM wakeups WHERE agent_id = ? AND idempotency_key = ?', [agentId, input.idempotencyKey]);
        if (existing) {
          if (existing.status === 'queued' || existing.status === 'claimed' || existing.status === 'coalesced' || existing.status === 'completed') {
            return row(ctx, existing.id);
          }
          ctx.db.update('wakeups', existing.id, { idempotencyKey: null });
        }
      }

      // Gate 1: workspace must be active.
      const ws = ctx.db.get<{ status: string }>('SELECT status FROM workspaces WHERE id = ?', [ctx.workspaceId]);
      if (ws && ws.status !== 'active') return skip(agentId, input, `workspace_${ws.status}`);

      // Gate 2: agent status, and a worker whose role is retired.
      // A paused role leaves the wake queued; the dispatcher does not claim until the role is
      // active (VS-154) — same as an expired runtime login.
      if (agent.status === 'paused') return skip(agentId, input, 'agent_paused');
      if (agent.status === 'retired') return skip(agentId, input, 'agent_retired');
      if (agent.status === 'done') return skip(agentId, input, 'agent_done');
      if (agent.kind === 'worker' && agent.roleId) {
        const role = ctx.db.get<{ status: string }>('SELECT status FROM roles WHERE id = ?', [agent.roleId]);
        if (role?.status === 'retired') return skip(agentId, input, 'role_retired');
      }

      // Gate 3: coalesce into an already-queued wake (payloads are appended, never dropped).
      const target = ctx.db.get<Wakeup>(
        'SELECT * FROM wakeups WHERE agent_id = ? AND status = ? AND (not_before IS NULL OR not_before <= ?) ORDER BY created_at LIMIT 1',
        [agentId, 'queued', input.notBefore ?? nowIso()],
      );
      if (target) {
        const payload = (target.payload ?? {}) as Record<string, unknown> & { bundle?: unknown[] };
        const bundle = Array.isArray(payload.bundle) ? payload.bundle : [];
        // requestedBy travels with the bundle entry (VS-143) so a human-requested wake that
        // coalesces into an already-queued one is still visible as human-requested to a consumer
        // that only sees the target row — the isolated-daemon dispatch gate in particular.
        bundle.push({
          source: input.source, reason: input.reason, payload: input.payload ?? {}, at: nowIso(),
          requestedByKind: input.requestedBy?.kind ?? 'system', requestedById: input.requestedBy?.id ?? null,
        });
        ctx.db.update('wakeups', target.id, { payloadJson: { ...payload, bundle } });
        const coalesced = insert(agentId, input, 'coalesced', { coalescedIntoId: target.id, finishedAt: nowIso() });
        ctx.events.emit('wake.queued', 'wakeup', target.id, { agentId, source: input.source, reason: input.reason, coalescedFrom: coalesced.id });
        log.debug({ agentId, into: target.id, source: input.source }, 'wake coalesced');
        return coalesced;
      }

      // Gate 4: queue it.
      const w = insert(agentId, input, 'queued');
      recordActivity(ctx.db, ctx.workspaceId, input.requestedBy ?? { kind: 'system', id: null }, 'wake.enqueue', 'wakeup', w.id, { agentId, source: input.source, reason: input.reason });
      ctx.events.emit('wake.queued', 'wakeup', w.id, { agentId, source: input.source, reason: input.reason });
      log.debug({ agentId, source: input.source, wakeId: w.id }, 'wake queued');
      return w;
    },

    listForAgent(agentId: string, status?: WakeStatus[]): Wakeup[] {
      const params: unknown[] = [agentId];
      let sql = 'SELECT * FROM wakeups WHERE agent_id = ?';
      if (status?.length) { sql += ` AND status IN (${status.map(() => '?').join(',')})`; params.push(...status); }
      sql += ' ORDER BY created_at';
      return ctx.db.all<Wakeup>(sql, params as never[]).map((w) => ({ ...w, payload: (w.payload ?? {}) as Record<string, unknown> }));
    },

    cancelForAgent(agentId: string, reason: string): number {
      const n = ctx.db.run("UPDATE wakeups SET status = 'cancelled', skip_reason = ?, finished_at = ? WHERE agent_id = ? AND status = 'queued'", [reason, nowIso(), agentId]).changes;
      if (n) log.info({ agentId, reason, cancelled: n }, 'queued wakes cancelled');
      return n;
    },
  };
}
