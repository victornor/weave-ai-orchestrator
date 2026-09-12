import { newId, nowIso } from '@weave-ai/db';
import type { AgentKind, SessionPolicy } from '@weave-ai/shared';
import type { SessionRef } from '@weave-ai/runtime-sdk';
import type { WorkspaceContext } from '../context.js';
import { modelSettingFor, modelsFor } from '../models/resolve.js';

export interface SessionRow {
  id: string; agentId: string; runtimeId: string; sessionRef: SessionRef | null; displayId: string | null;
  status: 'active' | 'stale' | 'closed'; turnCount: number; lastRunId: string | null; lastError: string | null;
  cumulativeUsage: Record<string, number> | null; createdAt: string; updatedAt: string;
}

export interface TurnSession { session: SessionRow; ref: SessionRef | null; isFirstTurn: boolean; stale: boolean; policy: SessionPolicy }

export interface SessionsService {
  active(agentId: string): SessionRow | null;
  forTurn(agent: { id: string; kind: string; runtimeId: string }, policy: SessionPolicy): TurnSession;
  record(sessionId: string, patch: { ref?: SessionRef | null; displayId?: string | null; runId?: string | null; error?: string | null; usage?: { inputTokens: number; outputTokens: number; cachedInputTokens?: number } | null }): void;
  reset(agentId: string, reason: string): SessionRow;
  close(agentId: string): void;
  markStaleIfIdle(agentId: string, maxIdleDays: number): boolean;
}

/** PLAN §7.4: one session per agent — persistent for the conductor, per ticket for a worker, `fresh` never resumes. */
export function createSessions(ctx: WorkspaceContext): SessionsService {
  const log = ctx.log('run');

  const get = (agentId: string): SessionRow | null =>
    ctx.db.get<SessionRow>("SELECT * FROM agent_sessions WHERE agent_id = ? AND status = 'active' ORDER BY created_at DESC LIMIT 1", [agentId]) ?? null;

  const create = (agentId: string, runtimeId: string): SessionRow => {
    const id = newId();
    const now = nowIso();
    ctx.db.insert('agent_sessions', { id, agentId, runtimeId, sessionRefJson: null, displayId: null, status: 'active', turnCount: 0, cumulativeUsageJson: {}, createdAt: now, updatedAt: now });
    return ctx.db.get<SessionRow>('SELECT * FROM agent_sessions WHERE id = ?', [id])!;
  };

  const service: SessionsService = {
    active: get,

    forTurn(agent, policy) {
      let session = get(agent.id);
      let stale = false;
      if (session && policy === 'persistent') {
        const idleDays = (Date.now() - new Date(session.updatedAt).getTime()) / 86_400_000;
        const max = ctx.config.defaults.sessionMaxIdleDays;
        if (session.turnCount > 0 && idleDays > max) {
          ctx.db.update('agent_sessions', session.id, { status: 'stale', updatedAt: nowIso() });
          log.info({ agentId: agent.id, idleDays: Math.round(idleDays) }, 'session went stale; starting a new one');
          session = null;
          stale = true;
        }
      }
      if (session && policy === 'fresh') {
        ctx.db.update('agent_sessions', session.id, { status: 'closed', updatedAt: nowIso() });
        session = null;
      }
      // A session handle belongs to the CLI that issued it, so a workspace model setting that now
      // names another runtime cannot resume this one — it is retired and the next turn starts fresh
      // (VS-77). Changing only the model or the effort keeps the session.
      if (session && session.runtimeId !== agent.runtimeId) {
        ctx.db.update('agent_sessions', session.id, { status: 'stale', updatedAt: nowIso() });
        log.info({ agentId: agent.id, from: session.runtimeId, to: agent.runtimeId }, 'runtime changed; starting a new session');
        session = null;
        stale = true;
      }
      if (!session) session = create(agent.id, agent.runtimeId);
      const ref = policy === 'fresh' ? null : (session.sessionRef ?? null);
      return { session, ref, isFirstTurn: session.turnCount === 0 || ref === null, stale, policy };
    },

    record(sessionId, patch) {
      const cur = ctx.db.get<SessionRow>('SELECT * FROM agent_sessions WHERE id = ?', [sessionId]);
      if (!cur) return;
      const usage = (cur.cumulativeUsage ?? {}) as Record<string, number>;
      if (patch.usage) {
        usage.inputTokens = (usage.inputTokens ?? 0) + patch.usage.inputTokens;
        usage.outputTokens = (usage.outputTokens ?? 0) + patch.usage.outputTokens;
        usage.cachedInputTokens = (usage.cachedInputTokens ?? 0) + (patch.usage.cachedInputTokens ?? 0);
      }
      ctx.db.update('agent_sessions', sessionId, {
        sessionRefJson: patch.ref === undefined ? undefined : patch.ref,
        displayId: patch.displayId === undefined ? undefined : patch.displayId,
        lastRunId: patch.runId === undefined ? undefined : patch.runId,
        lastError: patch.error === undefined ? undefined : patch.error,
        turnCount: cur.turnCount + 1,
        cumulativeUsageJson: usage,
        updatedAt: nowIso(),
      });
    },

    reset(agentId, reason) {
      const cur = get(agentId);
      if (cur) ctx.db.update('agent_sessions', cur.id, { status: 'closed', lastError: reason, updatedAt: nowIso() });
      const agent = ctx.db.get<{ kind: AgentKind; runtimeId: string }>('SELECT kind, runtime_id FROM agents WHERE id = ?', [agentId]);
      log.info({ agentId, reason }, 'session reset');
      return create(agentId, agent?.runtimeId ?? modelSettingFor(modelsFor(ctx), agent?.kind ?? 'worker').runtime);
    },

    close(agentId) {
      ctx.db.run("UPDATE agent_sessions SET status = 'closed', updated_at = ? WHERE agent_id = ? AND status = 'active'", [nowIso(), agentId]);
    },

    markStaleIfIdle(agentId, maxIdleDays) {
      const cur = get(agentId);
      if (!cur) return false;
      const idleDays = (Date.now() - new Date(cur.updatedAt).getTime()) / 86_400_000;
      if (idleDays <= maxIdleDays) return false;
      ctx.db.update('agent_sessions', cur.id, { status: 'stale', updatedAt: nowIso() });
      return true;
    },
  };
  return service;
}
