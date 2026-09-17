/**
 * VS-514: the agent-facing ticket tools require a worker-option choice when the workspace catalog
 * holds a configured option, and the refusal names every configured option with its description.
 * Exercised through `runTool`, the same entry the MCP endpoint and the agent route use, plus the
 * human HTTP path that keeps the default.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { WorkerModelOption } from '@weave-ai/shared';
import { createApp } from '../src/app.js';
import { runTool, type ToolCtx } from '../src/tools.js';
import type { RunTokenClaims } from '../src/runtoken.js';
import { authed, makeHarness, type Harness } from './fakes.js';

let harness: Harness | null = null;
afterEach(async () => { await harness?.close(); harness = null; });

const WEAVER: RunTokenClaims = { workspaceId: 'ws1', runId: 'run_c', agentId: 'ag_conductor', agentKind: 'weaver', projectId: null, ticketId: null, roleId: null };
const WORKER: RunTokenClaims = { workspaceId: 'ws1', runId: 'run_w', agentId: 'ag_1', agentKind: 'worker', projectId: 'proj1', ticketId: 'tk_1', roleId: 'role_1' };
const SESSION: RunTokenClaims = { workspaceId: 'ws1', runId: 'run_s', agentId: 'ag_s', agentKind: 'session', projectId: 'proj1', ticketId: null, roleId: 'role_1' };

const ctxFor = (h: Harness, claims: RunTokenClaims): ToolCtx =>
  ({ ws: h.runtime, claims, actor: { kind: 'agent', id: claims.agentId, runId: claims.runId } });

const call = (h: Harness, name: string, input: unknown, claims: RunTokenClaims = WEAVER) =>
  runTool(name, ctxFor(h, claims), input);

const CONFIGURED: WorkerModelOption[] = [
  { id: 'quick', description: 'Fastest. The fix is already located and specified.', runtime: 'opencode', model: 'glm-4.6' },
  { id: 'deep', description: 'Cause unknown, a design decision is open.', runtime: 'claude', model: 'opus' },
];

const withCatalog = (h: Harness, options: WorkerModelOption[]): void => { h.runtime.ctx.config.models.workerOptions = options; };

describe('VS-514 worker-option choice on the agent ticket tools', () => {
  it('refuses a create with no workerModelId and names every configured option with its description', async () => {
    const h = makeHarness(); harness = h; withCatalog(h, CONFIGURED);
    const res = await call(h, 'weave_ticket_create', { kind: 'change', title: 'Live view starves tabs' });
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error('expected refusal');
    expect(res.error.code).toBe('validation');
    expect(res.error.message).toContain('- quick: Fastest. The fix is already located and specified.');
    expect(res.error.message).toContain('- deep: Cause unknown, a design decision is open.');
    expect(h.tickets.size).toBe(1);
  });

  it('creates with a configured option and stores it', async () => {
    const h = makeHarness(); harness = h; withCatalog(h, CONFIGURED);
    const res = await call(h, 'weave_ticket_create', { kind: 'change', title: 'Cause unknown work', workerModelId: 'deep' });
    expect(res.ok).toBe(true);
    const created = [...h.tickets.values()].find((t) => t.title === 'Cause unknown work');
    expect(created?.workerModelId).toBe('deep');
  });

  it('refuses an unknown id naming the valid options', async () => {
    const h = makeHarness(); harness = h; withCatalog(h, CONFIGURED);
    const res = await call(h, 'weave_ticket_create', { kind: 'change', title: 'X', workerModelId: 'nope' });
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error('expected refusal');
    expect(res.error.message).toContain("unknown worker model option 'nope'");
    expect(res.error.message).toContain("'quick'");
    expect(res.error.message).toContain("'deep'");
  });

  it('keeps the default when the catalog is empty or every option is unconfigured', async () => {
    const h = makeHarness(); harness = h;
    expect((await call(h, 'weave_ticket_create', { kind: 'task', title: 'No catalog' })).ok).toBe(true);
    withCatalog(h, [{ id: 'quick', description: 'Fastest.', runtime: null, model: null }]);
    const res = await call(h, 'weave_ticket_create', { kind: 'task', title: 'Unconfigured only' });
    expect(res.ok).toBe(true);
    const created = [...h.tickets.values()].find((t) => t.title === 'Unconfigured only');
    expect(created?.workerModelId).toBeNull();
  });

  it('requires the choice of a worker filing its own ticket', async () => {
    const h = makeHarness(); harness = h; withCatalog(h, CONFIGURED);
    const refused = await call(h, 'weave_ticket_create', { kind: 'task', title: 'Follow-up' }, WORKER);
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error.code).toBe('validation');
    const ok = await call(h, 'weave_ticket_create', { kind: 'task', title: 'Follow-up', workerModelId: 'quick' }, WORKER);
    expect(ok.ok).toBe(true);
  });

  it('requires the choice when assign attaches a role and the ticket names none', async () => {
    const h = makeHarness(); harness = h; withCatalog(h, CONFIGURED);
    const refused = await call(h, 'weave_ticket_assign', { id: 'tk_1', roleId: 'role_1' });
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.error.code).toBe('validation');
      expect(refused.error.message).toContain('quick');
      expect(refused.error.message).toContain('deep');
    }
    expect(h.tickets.get('tk_1')?.assigneeRoleId).toBeNull();
  });

  it('assigns with a chosen option, and needs no re-choice from a ticket that already names one', async () => {
    const h = makeHarness(); harness = h; withCatalog(h, CONFIGURED);
    const assigned: Array<[string | null, string | null | undefined]> = [];
    (h.impls.tickets as Record<string, unknown>).assign = (_a: unknown, id: string, roleId: string | null, model?: string | null) => {
      assigned.push([roleId, model]);
      return { ...h.tickets.get(id)!, assigneeRoleId: roleId, workerModelId: model ?? h.tickets.get(id)!.workerModelId };
    };
    expect((await call(h, 'weave_ticket_assign', { id: 'tk_1', roleId: 'role_1', workerModelId: 'deep' })).ok).toBe(true);
    expect(assigned[0]).toEqual(['role_1', 'deep']);
    h.tickets.set('tk_1', { ...h.tickets.get('tk_1')!, workerModelId: 'quick' });
    expect((await call(h, 'weave_ticket_assign', { id: 'tk_1', roleId: 'role_1' })).ok).toBe(true);
    expect(assigned[1]).toEqual(['role_1', undefined]);
    expect((await call(h, 'weave_ticket_assign', { id: 'tk_1', roleId: null })).ok).toBe(true);
    expect(assigned[2]).toEqual([null, undefined]);
  });

  it('requires the choice when a session files a new ticket, and accepts one with', async () => {
    const h = makeHarness(); harness = h; withCatalog(h, CONFIGURED);
    const refused = await call(h, 'weave_session_take_ticket', { kind: 'task', title: 'Session work' }, SESSION);
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error.message).toContain('quick');
    const taken: Array<Record<string, unknown>> = [];
    (h.impls.workers as Record<string, unknown>).takeTicketForSession = (_a: unknown, sessionId: string, input: Record<string, unknown>) => {
      taken.push(input);
      return { agent: { id: sessionId }, ticket: { ...h.tickets.get('tk_1')!, id: 'tk_new', workerModelId: input['workerModelId'] ?? null } };
    };
    const ok = await call(h, 'weave_session_take_ticket', { kind: 'task', title: 'Session work', workerModelId: 'deep' }, SESSION);
    expect(ok.ok).toBe(true);
    expect(taken[0]?.['workerModelId']).toBe('deep');
  });
});

describe('VS-514 the human HTTP path keeps the default', () => {
  it('POST /tickets without workerModelId still creates', async () => {
    const h = makeHarness(); harness = h; withCatalog(h, CONFIGURED);
    const res = await createApp(h.deps).fetch(new Request('http://127.0.0.1:7433/api/w/ws1/tickets', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authed() },
      body: JSON.stringify({ kind: 'task', title: 'By hand' }),
    }));
    expect(res.status).toBe(201);
    const body = await res.json() as { workerModelId: string | null };
    expect(body.workerModelId).toBeNull();
  });
});
