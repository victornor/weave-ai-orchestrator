import { newId, nowIso } from '@weave-ai/db';
import type { AgentKind, SessionPolicy } from '@weave-ai/shared';
import type { SessionRef } from '@weave-ai/runtime-sdk';
import type { WorkspaceContext } from '../context.js';
import { modelSettingFor, modelsFor } from '../models/resolve.js';

export interface SessionRow {
  id: string; agentId: string; runtimeId: string; sessionRef: SessionRef | null; displayId: string | null;
  status: 'active' | 'stale' | 'closed'; turnCount: number; lastRunId: string | null; lastError: string | null;
  cumulativeUsage: Record<string, number> | null; createdAt: string; updatedAt: string;
  /** ISO while an out-of-band compaction is running; null otherwise. Set on the session, never `agents.status`. */
  compactingAt?: string | null; compactingError?: string | null;
  /** The last turn's own context size (its last request), for the automatic compaction policy. */
  lastContextTokens?: number | null;
  /** VS-542: the MCP tool-list fingerprint this session was started under; null on a row predating the column. */
  toolContract: string | null;
}

export interface TurnSession { session: SessionRow; ref: SessionRef | null; isFirstTurn: boolean; stale: boolean; policy: SessionPolicy }

export interface SessionsService {
  active(agentId: string): SessionRow | null;
  /**
   * VS-542: `contract` is the current tool-list fingerprint for the agent's kind. When it is given
   * and differs from the session's recorded one, the session is retired and a new one started, so the
   * runtime fetches the current tool definitions rather than resuming under a stale contract.
   */
  forTurn(agent: { id: string; kind: string; runtimeId: string }, policy: SessionPolicy, contract?: string): TurnSession;
  record(sessionId: string, patch: { ref?: SessionRef | null; displayId?: string | null; runId?: string | null; error?: string | null; usage?: { inputTokens: number; outputTokens: number; cachedInputTokens?: number } | null; contextTokens?: number | null }): void;
  reset(agentId: string, reason: string): SessionRow;
  close(agentId: string): void;
  markStaleIfIdle(agentId: string, maxIdleDays: number): boolean;
  /** Mark the session compacting (or clear it). While set, the dispatcher leaves this agent's wakes queued. */
  setCompacting(sessionId: string, at: string | null, error?: string | null): void;
  /**
   * End an adapter-initiated compaction: clear the mark and store the post-compaction context size
   * the runtime reported, or clear the observation when it reported none. VS-518 — the runtime path
   * needs the same one-shot consumption VS-500 gave the daemon path, or the automatic policy can
   * fire on the pre-compaction number the runtime already replaced.
   */
  noteCompactionEnd(sessionId: string, postTokens: number | null): void;
  /** True while this agent's active session is compacting — what the chat banner and the dispatch gate read. */
  compacting(agentId: string): boolean;
}

/** PLAN §7.4: one session per agent — persistent for the conductor, per ticket for a worker, `fresh` never resumes. */
export function createSessions(ctx: WorkspaceContext): SessionsService {
  const log = ctx.log('run');

  const get = (agentId: string): SessionRow | null =>
    ctx.db.get<SessionRow>("SELECT * FROM agent_sessions WHERE agent_id = ? AND status = 'active' ORDER BY created_at DESC LIMIT 1", [agentId]) ?? null;

  const create = (agentId: string, runtimeId: string, contract: string | null): SessionRow => {
    const id = newId();
    const now = nowIso();
    ctx.db.insert('agent_sessions', { id, agentId, runtimeId, sessionRefJson: null, displayId: null, status: 'active', turnCount: 0, cumulativeUsageJson: {}, toolContract: contract, createdAt: now, updatedAt: now });
    return ctx.db.get<SessionRow>('SELECT * FROM agent_sessions WHERE id = ?', [id])!;
  };

  const service: SessionsService = {
    active: get,

    forTurn(agent, policy, contract) {
      let session = get(agent.id);
      let stale = false;
      // VS-542: the runtime fixed its tool definitions when this session started, so a contract
      // change since then cannot reach it by resuming. Retire it and start fresh so the next spawn
      // fetches the current definitions. A null (pre-column) fingerprint is treated as different.
      if (session && contract !== undefined && session.toolContract !== contract) {
        ctx.db.update('agent_sessions', session.id, { status: 'stale', updatedAt: nowIso() });
        log.info({ agentId: agent.id, had: session.toolContract, now: contract }, 'tool contract changed; starting a new session');
        session = null;
        stale = true;
      }
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
      if (!session) session = create(agent.id, agent.runtimeId, contract ?? null);
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
        // The last request's size, not the turn's totals — what an automatic compaction policy is measured against.
        lastContextTokens: patch.contextTokens === undefined ? undefined : patch.contextTokens,
        updatedAt: nowIso(),
      });
    },

    reset(agentId, reason) {
      const cur = get(agentId);
      if (cur) ctx.db.update('agent_sessions', cur.id, { status: 'closed', lastError: reason, updatedAt: nowIso() });
      const agent = ctx.db.get<{ kind: AgentKind; runtimeId: string }>('SELECT kind, runtime_id FROM agents WHERE id = ?', [agentId]);
      log.info({ agentId, reason }, 'session reset');
      const runtimeId = agent?.runtimeId ?? modelSettingFor(modelsFor(ctx), agent?.kind ?? 'worker').runtime;
      return create(agentId, runtimeId, agent ? ctx.toolContractHash?.(agent.kind) ?? null : null);
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

    setCompacting(sessionId, at, error = null) {
      // Consume the context observation when an out-of-band compaction starts. The dispatcher must
      // not retry the same measurement after either a successful compaction or a legitimate failure.
      ctx.db.update('agent_sessions', sessionId, {
        compactingAt: at,
        compactingError: error,
        lastContextTokens: at === null ? undefined : null,
        updatedAt: nowIso(),
      });
    },

    noteCompactionEnd(sessionId, postTokens) {
      ctx.db.update('agent_sessions', sessionId, {
        compactingAt: null,
        compactingError: null,
        lastContextTokens: postTokens,
        updatedAt: nowIso(),
      });
    },

    compacting(agentId) {
      return !!ctx.db.get(
        "SELECT 1 FROM agent_sessions WHERE agent_id = ? AND status = 'active' AND compacting_at IS NOT NULL LIMIT 1",
        [agentId],
      );
    },
  };
  return service;
}
