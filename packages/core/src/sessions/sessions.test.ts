import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeHarness, type TestHarness } from '../testing/context.js';
import { createSessions } from './index.js';

/** VS-542: a session is retired when the tool contract it was started under no longer holds. */
describe('sessions: tool contract', () => {
  let h: TestHarness;
  beforeEach(() => { h = makeHarness(); });
  afterEach(() => h.cleanup());

  it('records the contract and resumes the same session while it is unchanged', () => {
    const id = h.addWorker(null);
    const sessions = createSessions(h.ctx);

    const first = sessions.forTurn({ id, kind: 'worker', runtimeId: 'claude' }, 'per_ticket', 'contract-A');
    expect(first.isFirstTurn).toBe(true);
    sessions.record(first.session.id, { ref: { sessionId: 's1' } });

    const second = sessions.forTurn({ id, kind: 'worker', runtimeId: 'claude' }, 'per_ticket', 'contract-A');
    expect(second.session.id).toBe(first.session.id);
    expect(second.isFirstTurn).toBe(false);
    expect(second.stale).toBe(false);
    expect(second.retireReason).toBeNull();
    expect(h.db.get<{ toolContract: string }>('SELECT tool_contract AS toolContract FROM agent_sessions WHERE id = ?', [first.session.id])!.toolContract).toBe('contract-A');
  });

  it('retires the session and starts a fresh one when the contract changes', () => {
    const id = h.addWorker(null);
    const sessions = createSessions(h.ctx);

    const first = sessions.forTurn({ id, kind: 'worker', runtimeId: 'claude' }, 'per_ticket', 'contract-A');
    sessions.record(first.session.id, { ref: { sessionId: 's1' } });

    const second = sessions.forTurn({ id, kind: 'worker', runtimeId: 'claude' }, 'per_ticket', 'contract-B');
    expect(second.session.id).not.toBe(first.session.id);
    expect(second.isFirstTurn).toBe(true);
    expect(second.stale).toBe(true);
    expect(h.db.get<{ status: string }>('SELECT status FROM agent_sessions WHERE id = ?', [first.session.id])!.status).toBe('stale');
    expect(h.db.get<{ toolContract: string }>('SELECT tool_contract AS toolContract FROM agent_sessions WHERE id = ?', [second.session.id])!.toolContract).toBe('contract-B');
    // VS-656: the reason the session was retired is recorded and handed back, so the surface can mark it.
    expect(h.db.get<{ retiredReason: string | null }>('SELECT retired_reason AS retiredReason FROM agent_sessions WHERE id = ?', [first.session.id])!.retiredReason).toBe('tool_contract');
    expect(second.retireReason).toBe('tool_contract');
  });

  it('treats a session with no recorded contract as different', () => {
    const id = h.addWorker(null);
    const sessions = createSessions(h.ctx);

    const first = sessions.forTurn({ id, kind: 'worker', runtimeId: 'claude' }, 'per_ticket');
    sessions.record(first.session.id, { ref: { sessionId: 's1' } });
    expect(first.session.toolContract).toBeNull();

    const second = sessions.forTurn({ id, kind: 'worker', runtimeId: 'claude' }, 'per_ticket', 'contract-A');
    expect(second.session.id).not.toBe(first.session.id);
    expect(second.stale).toBe(true);
  });

  it('does not compare when no contract is supplied', () => {
    const id = h.addWorker(null);
    const sessions = createSessions(h.ctx);

    const first = sessions.forTurn({ id, kind: 'worker', runtimeId: 'claude' }, 'per_ticket', 'contract-A');
    sessions.record(first.session.id, { ref: { sessionId: 's1' } });

    const second = sessions.forTurn({ id, kind: 'worker', runtimeId: 'claude' }, 'per_ticket');
    expect(second.session.id).toBe(first.session.id);
    expect(second.isFirstTurn).toBe(false);
    expect(second.stale).toBe(false);
  });
});

/** VS-656: why a session was retired is recorded so the conversation can mark the boundary. */
describe('sessions: retirement reason', () => {
  let h: TestHarness;
  beforeEach(() => { h = makeHarness(); });
  afterEach(() => h.cleanup());

  it('records idle when a persistent session is retired for being idle', () => {
    const id = h.addWorker(null);
    const sessions = createSessions(h.ctx);
    const first = sessions.forTurn({ id, kind: 'session', runtimeId: 'opencode' }, 'persistent', 'contract-A');
    sessions.record(first.session.id, { ref: { sessionId: 's1' } });
    h.db.run('UPDATE agent_sessions SET updated_at = ? WHERE id = ?', [
      new Date(Date.now() - 30 * 86_400_000).toISOString(), first.session.id,
    ]);

    const second = sessions.forTurn({ id, kind: 'session', runtimeId: 'opencode' }, 'persistent', 'contract-A');
    expect(second.session.id).not.toBe(first.session.id);
    expect(second.retireReason).toBe('idle');
    expect(h.db.get<{ retiredReason: string | null }>('SELECT retired_reason AS retiredReason FROM agent_sessions WHERE id = ?', [first.session.id])!.retiredReason).toBe('idle');
  });

  it('records runtime when the session moves to another runtime', () => {
    const id = h.addWorker(null);
    const sessions = createSessions(h.ctx);
    const first = sessions.forTurn({ id, kind: 'session', runtimeId: 'opencode' }, 'persistent', 'contract-A');
    sessions.record(first.session.id, { ref: { sessionId: 's1' } });

    const second = sessions.forTurn({ id, kind: 'session', runtimeId: 'codex' }, 'persistent', 'contract-A');
    expect(second.session.id).not.toBe(first.session.id);
    expect(second.retireReason).toBe('runtime');
    expect(h.db.get<{ retiredReason: string | null }>('SELECT retired_reason AS retiredReason FROM agent_sessions WHERE id = ?', [first.session.id])!.retiredReason).toBe('runtime');
  });

  it('records reset when an operator resets the session', () => {
    const id = h.addWorker(null);
    const sessions = createSessions(h.ctx);
    const first = sessions.forTurn({ id, kind: 'session', runtimeId: 'opencode' }, 'persistent', 'contract-A');

    sessions.reset(id, 'reset by operator');
    expect(h.db.get<{ retiredReason: string | null }>('SELECT retired_reason AS retiredReason FROM agent_sessions WHERE id = ?', [first.session.id])!.retiredReason).toBe('reset');
  });
});
