/**
 * VS-393: `weave_ticket_open_pull_request` is a worker tool that forwards to the ticket service's
 * `openPullRequest`. Exercised through `runTool`, the same entry the MCP endpoint and the agent
 * route use, with a ticket service double — the draft/base/idempotency behaviour itself is tested
 * against a fake forge in `@weave-ai/core`'s `tickets.test.ts`.
 */
import { describe, expect, it, vi } from 'vitest';
import { runTool, type ToolCtx } from '../src/tools.js';
import type { RunTokenClaims } from '../src/runtoken.js';

const TICKET = { id: 'tk_1', identifier: 'ACME-42', projectId: 'proj1', title: 'Add dark mode', status: 'in_review', kind: 'change', parentId: null };

function ctxFor(kind: 'weaver' | 'worker', openPullRequest: ReturnType<typeof vi.fn>): ToolCtx {
  const claims: RunTokenClaims = { workspaceId: 'ws1', runId: 'run_1', agentId: 'ag_1', agentKind: kind, projectId: 'proj1', ticketId: 'tk_1', roleId: 'role_1' };
  return {
    ws: { services: { tickets: { get: () => TICKET, openPullRequest } } },
    claims,
    actor: { kind: 'agent', id: 'ag_1', runId: 'run_1' },
    incidents: undefined,
  } as unknown as ToolCtx;
}

describe('weave_ticket_open_pull_request (VS-393)', () => {
  it('is available to a worker and forwards the ticket id, title and body', async () => {
    const openPullRequest = vi.fn(async () => ({ url: 'https://example.com/pr/7', number: 7 }));
    const res = await runTool('weave_ticket_open_pull_request', ctxFor('worker', openPullRequest), { id: 'tk_1', title: 'ACME-42: Add dark mode', body: 'body' });
    expect(res).toEqual({ ok: true, data: { url: 'https://example.com/pr/7', number: 7 } });
    expect(openPullRequest).toHaveBeenCalledWith(expect.objectContaining({ kind: 'agent' }), 'tk_1', { title: 'ACME-42: Add dark mode', body: 'body' });
  });

  it('is not available to the weaver', async () => {
    const openPullRequest = vi.fn();
    const res = await runTool('weave_ticket_open_pull_request', ctxFor('weaver', openPullRequest), { id: 'tk_1', title: 'x' });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('forbidden');
    expect(openPullRequest).not.toHaveBeenCalled();
  });
});
