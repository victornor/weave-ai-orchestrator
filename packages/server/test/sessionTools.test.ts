/**
 * `weave_session_take_ticket` (VS-495) — exercised through `runTool`, the same entry the MCP
 * endpoint and the agent route use. The service-level behavior (worktree, ticket binding, the
 * supervisor-sweep race) is covered in `packages/core/src/workers/workers.test.ts`; this only
 * covers the tool boundary: who may call it and how its input maps onto the service call.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Agent, Ticket, ToolResult } from '@weave-ai/shared';
import { runTool, type ToolCtx } from '../src/tools.js';
import type { RunTokenClaims } from '../src/runtoken.js';
import { makeHarness, type Harness } from './fakes.js';

let harness: Harness | null = null;
afterEach(async () => { await harness?.close(); harness = null; });

const SESSION: RunTokenClaims = { workspaceId: 'ws1', runId: 'run_s', agentId: 'ag_session', agentKind: 'session', projectId: 'proj1', ticketId: null, planId: null, roleId: 'role_1' };
const WORKER: RunTokenClaims = { workspaceId: 'ws1', runId: 'run_w', agentId: 'ag_worker', agentKind: 'worker', projectId: 'proj1', ticketId: 'tk_1', planId: null, roleId: 'role_1' };
const WEAVER: RunTokenClaims = { workspaceId: 'ws1', runId: 'run_c', agentId: 'ag_conductor', agentKind: 'weaver', projectId: null, ticketId: null, planId: null, roleId: null };

const ctxFor = (h: Harness, claims: RunTokenClaims): ToolCtx =>
  ({ ws: h.runtime, claims, actor: { kind: 'agent', id: claims.agentId, runId: claims.runId } });

const call = (h: Harness, claims: RunTokenClaims, input: unknown): Promise<ToolResult<never>> =>
  runTool('weave_session_take_ticket', ctxFor(h, claims), input) as Promise<ToolResult<never>>;

describe('weave_session_take_ticket (VS-495)', () => {
  it('is refused for a worker', async () => {
    const h = makeHarness(); harness = h;
    const result = await call(h, WORKER, { kind: 'task', title: 'Do it' });
    expect(result.ok).toBe(false);
    expect((result as { ok: false; error: { code: string } }).error.code).toBe('forbidden');
  });

  it('is refused for the weaver', async () => {
    const h = makeHarness(); harness = h;
    const result = await call(h, WEAVER, { kind: 'task', title: 'Do it' });
    expect(result.ok).toBe(false);
    expect((result as { ok: false; error: { code: string } }).error.code).toBe('forbidden');
  });

  it('requires kind and title when no ticketId is given', async () => {
    const h = makeHarness(); harness = h;
    const result = await call(h, SESSION, {});
    expect(result.ok).toBe(false);
    expect((result as { ok: false; error: { code: string } }).error.code).toBe('validation');
  });

  it('passes the session\'s own project and role, never the caller\'s, to a fresh ticket', async () => {
    const h = makeHarness(); harness = h;
    const takeTicketForSession = vi.fn(async () => ({ agent: { id: 'ag_session', kind: 'session' } as Agent, ticket: { id: 'tk_9', identifier: 'TST-9' } as Ticket }));
    h.impls.workers!.takeTicketForSession = takeTicketForSession;

    const result = await call(h, SESSION, { kind: 'task', title: 'Wire the endpoint' });

    expect(result.ok).toBe(true);
    expect(takeTicketForSession).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'agent', id: 'ag_session' }),
      'ag_session',
      expect.objectContaining({ projectId: 'proj1', kind: 'task', title: 'Wire the endpoint' }),
    );
  });

  it('passes an existing ticketId straight through, ignoring any creation fields', async () => {
    const h = makeHarness(); harness = h;
    const takeTicketForSession = vi.fn(async () => ({ agent: { id: 'ag_session', kind: 'session' } as Agent, ticket: { id: 'tk_5', identifier: 'TST-5' } as Ticket }));
    h.impls.workers!.takeTicketForSession = takeTicketForSession;

    const result = await call(h, SESSION, { ticketId: 'tk_5', title: 'ignored' });

    expect(result.ok).toBe(true);
    expect(takeTicketForSession).toHaveBeenCalledWith(expect.anything(), 'ag_session', { ticketId: 'tk_5' });
  });
});
