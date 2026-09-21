/**
 * VS-638: a turn woken by a human message that carried a composer-selected roadmap block refuses to
 * file a ticket unless `blockOverride` names why, while leaving every other turn, caller and tool
 * alone. Exercised through `runTool`, the same entry the MCP endpoint and the agent route use.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { ToolResult } from '@weave-ai/shared';
import { runTool, type ToolCtx } from '../src/tools.js';
import type { RunTokenClaims } from '../src/runtoken.js';
import { makeHarness, type Harness } from './fakes.js';

let harness: Harness | null = null;
afterEach(async () => { await harness?.close(); harness = null; });

const WEAVER: RunTokenClaims = { workspaceId: 'ws1', runId: 'run_c', agentId: 'ag_conductor', agentKind: 'weaver', projectId: null, ticketId: null, roleId: null };
const WORKER: RunTokenClaims = { workspaceId: 'ws1', runId: 'run_1', agentId: 'ag_1', agentKind: 'worker', projectId: 'proj1', ticketId: 'tk_1', roleId: 'role_1' };

function seed(h: Harness): void {
  h.db.run("INSERT INTO projects (id, workspace_id, slug, name, git_url, default_branch, clone_path, max_workers, worktree_provider, openspec_enabled, policies_json, status, created_at, updated_at) VALUES ('proj1','ws1','api','API','git@example.com:acme/api.git','main','/tmp',4,'git',1,'{}','ready','t0','t0')");
}

/** The turn's own wake, as `runs.get().wakeupIds` names it. */
function wake(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'wk_1', workspaceId: 'ws1', agentId: 'ag_conductor', source: 'human_message',
    reason: 'message from captain about api',
    payload: { threadId: 'th_1', messageId: 'm_1', body: 'add a friendly empty state', projectId: 'proj1', projectSlug: 'api', blockId: null, blockTitle: null },
    status: 'claimed', ...over,
  };
}

/** Replace the wakes the turn was woken by. */
function turnWokeBy(h: Harness, w: Record<string, unknown>): void {
  h.impls.wake!.listForAgent = () => [w as never];
}

const ctxFor = (h: Harness, claims: RunTokenClaims): ToolCtx =>
  ({ ws: h.runtime, claims, actor: { kind: 'agent', id: claims.agentId, runId: claims.runId } });

const call = (h: Harness, name: string, input: unknown, claims: RunTokenClaims = WEAVER): Promise<ToolResult<never>> =>
  runTool(name, ctxFor(h, claims), input) as Promise<ToolResult<never>>;

async function makeBlock(h: Harness, title = 'UI polish #3'): Promise<string> {
  const made = await call(h, 'weave_roadmap_block_create', { projectId: 'proj1', title });
  return (made as { ok: true; data: { id: string } }).data.id;
}

describe('VS-638 ticket-create block guard', () => {
  it('refuses to file a ticket in a turn woken by a message with a block selected, naming the block', async () => {
    const h = makeHarness(); harness = h; seed(h);
    const blockId = await makeBlock(h);
    turnWokeBy(h, wake({ payload: { threadId: 'th_1', messageId: 'm_1', body: 'add a friendly empty state', projectId: 'proj1', projectSlug: 'api', blockId, blockTitle: 'UI polish #3' } }));
    const before = h.tickets.size;

    const refused = await call(h, 'weave_ticket_create', { projectId: 'proj1', kind: 'task', title: 'Friendly empty state' });
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.error.code).toBe('validation');
      expect(refused.error.message).toContain('UI polish #3');
      expect(refused.error.message).toContain('weave_roadmap_item_add');
      expect(refused.error.message).toContain('weave_roadmap_block_start');
    }
    expect(h.tickets.size).toBe(before);
  });

  it('files the ticket and records the reason when blockOverride is given', async () => {
    const h = makeHarness(); harness = h; seed(h);
    const blockId = await makeBlock(h);
    turnWokeBy(h, wake({ payload: { threadId: 'th_1', messageId: 'm_1', body: 'open a separate ticket', projectId: 'proj1', projectSlug: 'api', blockId, blockTitle: 'UI polish #3' } }));

    const filed = await call(h, 'weave_ticket_create', { projectId: 'proj1', kind: 'task', title: 'Its own ticket', blockOverride: 'captain asked for a separate ticket' });
    expect(filed.ok).toBe(true);
    if (!filed.ok) return;
    const created = filed.data as { id: string };
    const row = h.db.get<{ action: string; entityId: string; details: Record<string, unknown> }>("SELECT action, entity_id, details_json FROM activity WHERE action = 'ticket.create_block_override' AND entity_id = ?", [created.id]);
    expect(row).toBeTruthy();
    expect(row!.details).toMatchObject({ blockId, blockTitle: 'UI polish #3', reason: 'captain asked for a separate ticket' });
  });

  it('surfaces the selected block on the weave_inbox message entry (VS-638)', async () => {
    const h = makeHarness(); harness = h; seed(h);
    const blockId = await makeBlock(h);
    turnWokeBy(h, wake({ payload: { threadId: 'th_1', messageId: 'm_1', body: 'add a friendly empty state', projectId: 'proj1', projectSlug: 'api', blockId, blockTitle: 'UI polish #3' } }));
    const inbox = await call(h, 'weave_inbox', {});
    expect(inbox.ok).toBe(true);
    if (!inbox.ok) return;
    const messages = (inbox.data as { messages: Array<{ selection?: string }> }).messages;
    expect(messages[0]?.selection).toContain('UI polish #3');
    expect(messages[0]?.selection).toContain('weave_roadmap_item_add');
  });

  it('never blocks weave_roadmap_item_add in the same turn', async () => {
    const h = makeHarness(); harness = h; seed(h);
    const blockId = await makeBlock(h);
    turnWokeBy(h, wake({ payload: { threadId: 'th_1', messageId: 'm_1', body: 'add a friendly empty state', projectId: 'proj1', projectSlug: 'api', blockId, blockTitle: 'UI polish #3' } }));

    const added = await call(h, 'weave_roadmap_item_add', { blockId, title: 'Friendly empty state', description: 'Show a hint.' });
    expect(added.ok).toBe(true);
  });

  it('does not leak into the next turn, woken by a message without a block', async () => {
    const h = makeHarness(); harness = h; seed(h);
    const blockId = await makeBlock(h);
    turnWokeBy(h, wake({ payload: { threadId: 'th_1', messageId: 'm_1', body: 'add a friendly empty state', projectId: 'proj1', projectSlug: 'api', blockId, blockTitle: 'UI polish #3' } }));
    expect((await call(h, 'weave_ticket_create', { kind: 'task', title: 'refused' })).ok).toBe(false);

    turnWokeBy(h, wake({ payload: { threadId: 'th_1', messageId: 'm_2', body: 'now do this on its own', projectId: 'proj1', projectSlug: 'api', blockId: null, blockTitle: null } }));
    const filed = await call(h, 'weave_ticket_create', { kind: 'task', title: 'fine now' });
    expect(filed.ok).toBe(true);
  });

  it('leaves a project-only message, a worker turn, a routine turn and a human caller unaffected', async () => {
    const h = makeHarness(); harness = h; seed(h);
    // A message with a project but no block.
    turnWokeBy(h, wake());
    expect((await call(h, 'weave_ticket_create', { kind: 'task', title: 'no block' })).ok).toBe(true);

    // A worker turn woken by a ticket event.
    turnWokeBy(h, { id: 'wk_1', workspaceId: 'ws1', agentId: 'ag_1', source: 'ticket_assigned', reason: 'assigned', payload: {}, status: 'claimed' });
    expect((await call(h, 'weave_ticket_create', { kind: 'task', title: 'worker files' }, WORKER)).ok).toBe(true);

    // A routine turn.
    turnWokeBy(h, { id: 'wk_1', workspaceId: 'ws1', agentId: 'ag_conductor', source: 'routine', reason: 'alarm', payload: { action: 'report' }, status: 'claimed' });
    expect((await call(h, 'weave_ticket_create', { kind: 'task', title: 'routine files' })).ok).toBe(true);

    // A human caller in a block-selected turn is exempt.
    const blockId = await makeBlock(h);
    turnWokeBy(h, wake({ payload: { threadId: 'th_1', messageId: 'm_1', body: 'add a friendly empty state', projectId: 'proj1', projectSlug: 'api', blockId, blockTitle: 'UI polish #3' } }));
    const humanCtx: ToolCtx = { ws: h.runtime, claims: WEAVER, actor: { kind: 'human', id: 'captain' } };
    const human = await runTool('weave_ticket_create', humanCtx, { kind: 'task', title: 'human files' });
    expect(human.ok).toBe(true);
  });
});
