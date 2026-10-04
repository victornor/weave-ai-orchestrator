/**
 * The per-runtime login gate (VS-75, runtime-credentials/login-outage).
 *
 * The outage of 2026-09-07 turned one expired login into three retry cards, a twice-paused
 * conductor and a dropped merge. These pin the shape that replaces it: one gate, one card, one
 * message on the channel path, and a resume nobody has to ask for.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { newId, nowIso } from '@weave-ai/db';
import { DEFAULT_MODEL_SETTING, type Agent, type Decision } from '@weave-ai/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createAccountsService } from '../usage/accounts.js';
import { createDispatcher } from './dispatcher.js';
import { makeHarness, type TestHarness } from '../testing/context.js';
import { LOGIN_PAUSE_CODE, authOutageCorrelationKey, gateRuntimeForLogin, loginCorrelationKey, loginPauseRuntime, recheckRuntimeLogin, releaseLoginPausesForAbandonedRuntimes, ungateRuntime } from './authgate.js';

let h: TestHarness;
/** Every decision the fake service was asked to create, in order. */
let created: Array<Record<string, unknown>>;
let withdrawn: string[];
let notified: string[];

/** A decisions double with the one behaviour that matters here: an open card is findable by key. */
function fakeDecisions(): Record<string, unknown> {
  const open: Decision[] = [];
  return {
    create: (_actor: unknown, input: Record<string, unknown>) => {
      created.push(input);
      const d = { id: newId(), status: 'open', correlationKey: input['correlationKey'], ...input } as unknown as Decision;
      open.push(d);
      return d;
    },
    list: () => open.filter((d) => d.status === 'open'),
    withdraw: (_actor: unknown, id: string) => {
      withdrawn.push(id);
      const d = open.find((x) => x.id === id)!;
      (d as { status: string }).status = 'withdrawn';
      return d;
    },
  };
}

const gate = (detail: string | null = 'OAuth session expired and could not be refreshed'): void =>
  gateRuntimeForLogin(h.ctx, h.deps, { runtimeId: 'claude' }, detail);

const agentRow = (id: string) => h.db.get<{ status: string; pauseReason: string | null; pauseDetail: { code?: string } | null }>('SELECT * FROM agents WHERE id = ?', [id])!;

beforeEach(() => {
  h = makeHarness();
  created = []; withdrawn = []; notified = [];
  h.services.accounts = createAccountsService(h.ctx);
  h.services.decisions = fakeDecisions() as never;
  h.services.threads = {
    notifyHuman: async (_actor: unknown, m: { text: string }) => { notified.push(m.text); },
  } as never;
  // A credential file so the state reads as present rather than "gone entirely".
  mkdirSync(join(h.ctx.paths.runtimesHome, 'claude'), { recursive: true });
  writeFileSync(join(h.ctx.paths.runtimesHome, 'claude', '.credentials.json'), '{}');
});
afterEach(() => h.cleanup());

describe('the first authentication failure stops the runtime', () => {
  it('raises the gate and records why', () => {
    gate();
    const cred = h.services.accounts!.credential('claude');
    expect(cred.needsLogin).toBe(true);
    expect(cred.refreshFailedAt).not.toBeNull();
    expect(h.services.accounts!.gatedRuntimes()).toEqual(['claude']);
  });

  it('pauses every agent on the runtime, not only the one that failed', () => {
    const a = h.addWorker(null);
    const b = h.addWorker(null);
    gate();
    for (const id of [a, b, h.conductorId]) {
      expect(agentRow(id).status).toBe('paused');
      expect(agentRow(id).pauseDetail?.code).toBe(LOGIN_PAUSE_CODE);
    }
  });

  it('leaves agents on another runtime alone', () => {
    const other = h.addWorker(null, { runtimeId: 'codex' });
    gate();
    expect(agentRow(other).status).toBe('active');
  });

  it('keeps the pending wake-ups rather than discarding them', () => {
    const w = h.addWorker(null);
    h.db.insert('wakeups', {
      id: newId(), workspaceId: h.workspaceId, agentId: w, source: 'system', reason: 'work',
      payloadJson: {}, status: 'queued', createdAt: nowIso(),
    });
    gate();
    const still = h.db.get<{ status: string }>('SELECT status FROM wakeups WHERE agent_id = ?', [w])!;
    expect(still.status).toBe('queued');
  });
});

describe('one outage raises exactly one decision', () => {
  it('raises one card for three agents that would each have failed', () => {
    h.addWorker(null); h.addWorker(null); h.addWorker(null);
    gate();
    expect(created).toHaveLength(1);
    expect(created[0]!['owner']).toBe('human');
    expect(created[0]!['correlationKey']).toBe(loginCorrelationKey('claude'));
    // Not attached to a ticket: the outage is not about one ticket.
    expect(created[0]!['ticketId']).toBeNull();
  });

  it('does not raise a second card when the runtime fails again', () => {
    gate();
    gate('a second failure');
    gate('a third failure');
    expect(created).toHaveLength(1);
    expect(h.services.decisions!.list({ status: ['open'] })).toHaveLength(1);
  });

  it('tells the human what to do', () => {
    gate();
    const context = String(created[0]!['context']);
    expect(String(created[0]!['title'])).toContain('claude');
    expect(context).toContain('weave runtime login claude');
    expect(context).toContain('resumes on its own');
  });

  it('puts no token on the card or the message', () => {
    gateRuntimeForLogin(h.ctx, h.deps, { runtimeId: 'claude' }, 'refresh failed for sk-ant-oat01-LEAKED-TOKEN-VALUE');
    const cred = h.services.accounts!.credential('claude');
    expect(cred.detail).not.toContain('sk-ant-oat01-LEAKED-TOKEN-VALUE');
    expect(JSON.stringify(cred)).not.toContain('LEAKED');
  });
});

describe('the human is told over the channel, not through the conductor', () => {
  it('delivers a message even though the conductor is on the gated runtime', () => {
    gate();
    expect(agentRow(h.conductorId).status).toBe('paused');   // the conductor cannot take a turn
    expect(notified).toHaveLength(1);                        // and the human is told anyway
    expect(notified[0]).toContain('weave runtime login claude');
  });

  it('does not repeat the message on a second failure', () => {
    gate();
    gate('again');
    expect(notified).toHaveLength(1);
  });
});

describe('the work resumes by itself when the login is restored', () => {
  it('releases the agents, clears the gate and withdraws the card', () => {
    const w = h.addWorker(null);
    gate();
    const released = ungateRuntime(h.ctx, h.deps, 'claude');

    expect(released).toBe(2);                                 // the worker and the conductor
    expect(agentRow(w).status).toBe('active');
    expect(agentRow(w).pauseReason).toBeNull();
    expect(agentRow(h.conductorId).status).toBe('active');
    expect(h.services.accounts!.gatedRuntimes()).toEqual([]);
    expect(h.services.accounts!.credential('claude').lastVerifiedAt).not.toBeNull();
    expect(withdrawn).toHaveLength(1);
  });

  it('leaves a worker paused for its own reason paused', () => {
    const mine = h.addWorker(null);
    gate();
    // This one was parked for a quota limit before the outage; the outage must not resume it.
    h.db.update('agents', mine, {
      pauseReason: 'provider_quota: waiting for a human',
      pauseDetailJson: { family: 'provider_quota', code: 'usage_limit', message: null, resetAt: null, runId: null },
      updatedAt: nowIso(),
    });

    ungateRuntime(h.ctx, h.deps, 'claude');

    expect(agentRow(mine).status).toBe('paused');
    expect(agentRow(h.conductorId).status).toBe('active');
  });

  it('needs no answer to the decision', () => {
    gate();
    ungateRuntime(h.ctx, h.deps, 'claude');
    // Withdrawn by the system, never answered by the human.
    expect(withdrawn).toHaveLength(1);
    expect(h.services.decisions!.list({ status: ['open'] })).toEqual([]);
  });
});

describe('the dispatcher starts nothing on a gated runtime', () => {
  it('does not claim a queued wake while the gate is up, and does once it is down', async () => {
    h.services.accounts = createAccountsService(h.ctx);
    const w = h.addWorker(null);
    const wakeId = newId();
    h.db.insert('wakeups', {
      id: wakeId, workspaceId: h.workspaceId, agentId: w, source: 'system', reason: 'work',
      payloadJson: {}, status: 'queued', createdAt: nowIso(),
    });
    gate();

    const dispatcher = createDispatcher(h.ctx, h.deps);
    await dispatcher.tick();
    await dispatcher.tick();

    // Still queued, and no run was created: the work is preserved rather than claimed and failed.
    expect(h.db.get<{ status: string }>('SELECT status FROM wakeups WHERE id = ?', [wakeId])!.status).toBe('queued');
    expect(h.db.all('SELECT id FROM runs WHERE agent_id = ?', [w])).toHaveLength(0);
  });

  it('leaves an agent on an ungated runtime dispatchable', () => {
    const other = h.addWorker(null, { runtimeId: 'codex' });
    gate();
    const candidates = h.db.all<{ id: string }>(
      `SELECT a.id FROM agents a WHERE a.workspace_id = ?
         AND a.runtime_id NOT IN (SELECT runtime_id FROM runtime_credentials WHERE workspace_id = ? AND needs_login = 1)`,
      [h.workspaceId, h.workspaceId],
    );
    expect(candidates.map((c) => c.id)).toContain(other);
  });
});

describe('resume is not offered into a failure', () => {
  it('refuses to resume a worker while its runtime still needs a login', async () => {
    const { createWorkersService } = await import('../workers/index.js');
    const workers = createWorkersService(h.ctx, h.deps);
    const w = h.addWorker(null);
    gate();

    expect(() => workers.resume({ kind: 'human', id: null }, w)).toThrow(/waiting on the claude login/);
    expect(agentRow(w).status).toBe('paused');
  });

  it('allows a resume again once the gate is down', async () => {
    const { createWorkersService } = await import('../workers/index.js');
    const workers = createWorkersService(h.ctx, h.deps);
    h.services.wake = { enqueue: () => ({}) } as never;
    const w = h.addWorker(null);
    gate();
    h.services.accounts!.noteVerified('claude');

    expect(() => workers.resume({ kind: 'human', id: null }, w)).not.toThrow();
    expect(agentRow(w).status).toBe('active');
  });
});

describe('a ticket whose worker pauses for a login outage tells the conductor (VS-137)', () => {
  it('raises a conductor-owned gate_finding on the ticket', () => {
    gateRuntimeForLogin(h.ctx, h.deps, { runtimeId: 'claude', agentId: 'ag_1', agentName: 'Backend Engineer #7', ticketId: 'tkt_1' }, 'expired');

    const onTicket = created.filter((d) => d['ticketId'] === 'tkt_1');
    expect(onTicket).toHaveLength(1);
    expect(onTicket[0]!['kind']).toBe('gate_finding');
    expect(onTicket[0]!['owner']).toBe('weaver');
    expect(onTicket[0]!['correlationKey']).toBe(authOutageCorrelationKey('tkt_1'));
    // The runtime-wide, human-owned card is unaffected: this is additional, not a replacement.
    expect(created.filter((d) => d['ticketId'] === null)).toHaveLength(1);
  });

  it('raises no second card on the same ticket while one is open', () => {
    gateRuntimeForLogin(h.ctx, h.deps, { runtimeId: 'claude', agentId: 'ag_1', ticketId: 'tkt_1' }, 'expired');
    gateRuntimeForLogin(h.ctx, h.deps, { runtimeId: 'claude', agentId: 'ag_1', ticketId: 'tkt_1' }, 'expired again');

    expect(created.filter((d) => d['ticketId'] === 'tkt_1')).toHaveLength(1);
  });

  it('raises no error and no per-ticket card for an agent with no ticket', () => {
    expect(() => gateRuntimeForLogin(h.ctx, h.deps, { runtimeId: 'claude', agentId: 'ag_1' }, 'expired')).not.toThrow();
    expect(created.filter((d) => d['ticketId'] !== null)).toHaveLength(0);
    // The workspace-wide decision still raises normally.
    expect(created).toHaveLength(1);
  });
});

/**
 * runtime-credentials/credential-visibility: nothing the outage path writes may carry the token.
 * The `RuntimeCredential` shape has no field for one, and the detail is redacted before storage;
 * this pins both, and pins that the card and the channel message stay clean too.
 */
describe('no surface exposes the credential', () => {
  const TOKEN = 'sk-ant-oat01-01ARZ3NDEKTSV4RRFFQ69G5FAVAAAA';

  it('keeps the token out of the card, the message and the stored state', () => {
    gateRuntimeForLogin(h.ctx, h.deps, { runtimeId: 'claude' }, `refresh failed: ${TOKEN} rejected`);

    const everything = JSON.stringify({
      card: created,
      message: notified,
      state: h.services.accounts!.credentials(),
      one: h.services.accounts!.credential('claude'),
    });
    expect(everything).not.toContain(TOKEN);
    expect(everything).not.toContain('sk-ant-oat01');
    expect(everything).not.toContain('01ARZ3NDEKTSV4RRFFQ69G5FAV');
  });

  it('reports only the facts about the credential, never its contents', () => {
    gate();
    expect(Object.keys(h.services.accounts!.credential('claude')).sort()).toEqual([
      'detail', 'expiresAt', 'lastVerifiedAt', 'needsLogin', 'present', 'refreshFailedAt', 'runtimeId', 'updatedAt', 'workspaceId',
    ]);
  });
});

/**
 * VS-77 meets VS-75: moving the workspace's model settings off a dead runtime must lift the login
 * pauses that runtime raised. `ungateRuntime` only releases agents still stamped with the gated
 * runtime, and a login that never comes back (a cancelled subscription) releases nothing — so the
 * pauses outlive the runtime that raised them and every chat message queues forever.
 */
describe('a login pause outliving a runtime the workspace abandoned', () => {
  const moveTo = async (runtime: string): Promise<void> => {
    await h.ctx.saveConfig({
      ...h.ctx.config,
      models: {
        ...h.ctx.config.models,
        weaver: { ...(h.ctx.config.models.weaver ?? DEFAULT_MODEL_SETTING), runtime },
        workers: { ...(h.ctx.config.models.workers ?? DEFAULT_MODEL_SETTING), runtime },
      },
    });
  };

  it('releases and restamps the paused agents, and withdraws the gate card', async () => {
    const w = h.addWorker(null);
    gate();
    expect(agentRow(w).status).toBe('paused');
    await moveTo('opencode');

    expect(releaseLoginPausesForAbandonedRuntimes(h.ctx, h.deps)).toBe(2);  // the worker and the conductor

    expect(agentRow(w).status).toBe('active');
    expect(h.db.get<{ runtimeId: string }>('SELECT * FROM agents WHERE id = ?', [w])!.runtimeId).toBe('opencode');
    expect(withdrawn).toHaveLength(1);
    expect(releaseLoginPausesForAbandonedRuntimes(h.ctx, h.deps)).toBe(0);  // idempotent: the second sweep finds nothing
  });

  it('keeps the pause while the gated runtime still governs the agents', () => {
    const w = h.addWorker(null);
    gate();

    expect(releaseLoginPausesForAbandonedRuntimes(h.ctx, h.deps)).toBe(0);
    expect(agentRow(w).status).toBe('paused');
    expect(withdrawn).toHaveLength(0);
  });

  it('keeps a pause raised for one runtime after a move to another gated one', async () => {
    const w = h.addWorker(null);
    gate();
    // opencode is gated too, and now governs: the move trades one dead login for another.
    gateRuntimeForLogin(h.ctx, h.deps, { runtimeId: 'opencode' }, 'expired');
    await moveTo('opencode');

    expect(releaseLoginPausesForAbandonedRuntimes(h.ctx, h.deps)).toBe(0);
    expect(agentRow(w).status).toBe('paused');
    // The pause now names the runtime its next turn would actually fail on, and ungate of that
    // runtime releases it in the ordinary way.
    expect(agentRow(w).pauseReason).toBe(`${LOGIN_PAUSE_CODE}: the opencode login expired`);
    expect(h.db.get<{ runtimeId: string }>('SELECT * FROM agents WHERE id = ?', [w])!.runtimeId).toBe('opencode');
  });

  it('reads the paused-for runtime off a reason string from before the detail row recorded it', () => {
    const w = h.addWorker(null);
    gate();
    h.db.update('agents', w, { pauseDetailJson: { family: 'auth', code: LOGIN_PAUSE_CODE, message: null, resetAt: null, runId: null } });

    const agent = h.db.get<Agent>('SELECT * FROM agents WHERE id = ?', [w])!;
    expect(loginPauseRuntime(agent)).toBe('claude');
  });
});

describe('the outage is announced with the exact fix, once, and ends cleanly (VS-769)', () => {
  let filed: Array<Record<string, unknown>>;
  let resolved: string[];
  beforeEach(() => {
    filed = []; resolved = [];
    const open: Array<Record<string, unknown>> = [];
    h.services.incidents = {
      create: (i: Record<string, unknown>) => { const row = { id: `inc${filed.length + 1}`, ...i }; filed.push(row); open.push(row); return row; },
      list: () => ({ items: open.filter((i) => !resolved.includes(String(i['id']))), total: 0 }),
      resolve: (id: string) => { resolved.push(id); return {}; },
    } as never;
  });

  it('names the runtime, the paused agents and the runtime-specific command', () => {
    h.addWorker(null);
    gate();
    const context = String(created[0]!['context']);
    expect(context).toContain('Paused:');
    expect(context).toContain('weave runtime login claude');
    expect(notified[0]).toContain('weave runtime login claude');
    expect(notified[0]).toContain('Paused:');
  });

  it('gives another runtime its own command, not claude\'s', () => {
    gateRuntimeForLogin(h.ctx, h.deps, { runtimeId: 'codex' }, null);
    expect(String(created[0]!['context'])).toContain('weave runtime login codex');
    expect(String(created[0]!['context'])).toContain('`codex login`');
    expect(String(created[0]!['context'])).not.toContain('claude');
  });

  it('files one incident per outage however many runs fail', () => {
    gate(); gate(); gate();
    expect(filed).toHaveLength(1);
    expect(filed[0]!['reporterKind']).toBe('system');
    expect(filed[0]!['title']).toBe('Runtime login expired: claude');
  });

  it('posts one recovery line, resolves the incident and withdraws the card', () => {
    gate();
    notified.length = 0;
    ungateRuntime(h.ctx, h.deps, 'claude');
    expect(notified).toHaveLength(1);
    expect(notified[0]).toContain('login is working again');
    expect(resolved).toEqual(['inc1']);
    expect(withdrawn).toHaveLength(1);
    // Clearing a gate that is not up says nothing.
    ungateRuntime(h.ctx, h.deps, 'claude');
    expect(notified).toHaveLength(1);
  });

  it('a later outage files a new incident', () => {
    gate(); ungateRuntime(h.ctx, h.deps, 'claude'); gate();
    expect(filed).toHaveLength(2);
  });
});

describe('a probe alone does not lift the gate (VS-769)', () => {
  const credPath = () => join(h.ctx.paths.runtimesHome, 'claude', '.credentials.json');
  const setExpiry = (ms: number): void => writeFileSync(credPath(), JSON.stringify({ claudeAiOauth: { expiresAt: ms } }));
  let probes: number;
  beforeEach(() => {
    probes = 0;
    // The real claude reader parses this same file; the harness registers no adapters, so a reader
    // with the same contract stands in (the CLI itself is never launched).
    const runtimes = h.ctx.registries.runtimes as unknown as { get: (id: string) => unknown };
    const realGet = runtimes.get.bind(runtimes);
    runtimes.get = (id: string) => id !== 'claude' ? realGet(id) : {
      readCredential: ({ configHome }: { configHome: string }) => {
        const raw = JSON.parse(readFileSync(join(configHome, '.credentials.json'), 'utf8')) as { claudeAiOauth?: { expiresAt?: number } };
        const ms = raw.claudeAiOauth?.expiresAt;
        return { present: true, expiresAt: typeof ms === 'number' ? new Date(ms).toISOString() : null };
      },
    };
    const real = h.services.accounts!;
    h.services.accounts = Object.assign(Object.create(real), {
      refresh: async () => { probes += 1; return [{ runtimeId: 'claude', billingType: 'subscription_included' }]; },
    }) as never;
  });

  it('the claude credential reader reports the expiry the test writes', () => {
    setExpiry(Date.parse('2026-10-04T20:00:00Z'));
    expect(h.services.accounts!.credential('claude').expiresAt).toBe('2026-10-04T20:00:00.000Z');
  });

  it('keeps the gate when the probe works but the credential is unchanged', async () => {
    setExpiry(Date.parse('2026-10-04T20:00:00Z'));
    gate();
    const r = await recheckRuntimeLogin(h.ctx, h.deps, 'claude', { manual: false });
    expect(r.released).toBe(false);
    expect(probes).toBe(0);
    expect(h.services.accounts!.gatedRuntimes()).toEqual(['claude']);
    expect(withdrawn).toHaveLength(0);
  });

  it('releases once the credential changed and the probe describes the account', async () => {
    setExpiry(Date.parse('2026-10-04T20:00:00Z'));
    gate();
    setExpiry(Date.parse('2026-10-05T02:00:00Z'));
    expect((await recheckRuntimeLogin(h.ctx, h.deps, 'claude', { manual: false })).released).toBe(true);
    expect(h.services.accounts!.gatedRuntimes()).toEqual([]);
  });

  it('after a probe release that fails again, only a manual re-check lifts the gate', async () => {
    setExpiry(Date.parse('2026-10-04T20:00:00Z'));
    gate();
    setExpiry(Date.parse('2026-10-05T02:00:00Z'));
    await recheckRuntimeLogin(h.ctx, h.deps, 'claude', { manual: false });
    gate();                                          // the login was still dead
    setExpiry(Date.parse('2026-10-05T04:00:00Z'));   // even a changed credential does not bring the auto-probe back
    expect((await recheckRuntimeLogin(h.ctx, h.deps, 'claude', { manual: false })).released).toBe(false);
    expect((await recheckRuntimeLogin(h.ctx, h.deps, 'claude', { manual: true })).released).toBe(true);
  });

  it('a manual re-check releases even when the credential file looks unchanged', async () => {
    setExpiry(Date.parse('2026-10-04T20:00:00Z'));
    gate();
    expect((await recheckRuntimeLogin(h.ctx, h.deps, 'claude', { manual: true })).released).toBe(true);
  });

  it('a manual re-check does not release when the probe still cannot describe the account', async () => {
    gate();
    (h.services.accounts as never as { refresh: unknown }).refresh = async () => [{ runtimeId: 'claude', billingType: 'unknown' }];
    expect((await recheckRuntimeLogin(h.ctx, h.deps, 'claude', { manual: true })).released).toBe(false);
  });
});
