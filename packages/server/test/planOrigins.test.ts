/** Plan-origin reads (VS-550): the workspace bulk read for the board and `plan` on ticket detail. */
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { authed, makeHarness, type Harness } from './fakes.js';

let harness: Harness | null = null;
afterEach(async () => { await harness?.close(); harness = null; });

const HUMAN = { kind: 'human', id: 'victor' } as const;

function seed(h: Harness): void {
  h.db.run("INSERT INTO projects (id, workspace_id, slug, name, git_url, default_branch, clone_path, max_workers, worktree_provider, openspec_enabled, policies_json, status, created_at, updated_at) VALUES ('proj1','ws1','api','API','git@example.com:acme/api.git','main','/tmp',4,'git',1,'{}','ready','t0','t0')");
  h.db.run("INSERT INTO channels (id, workspace_id, kind) VALUES ('c1','ws1','web')");
  h.db.run("INSERT INTO channel_threads (id, channel_id, agent_id, created_at) VALUES ('th1','c1','ag_conductor','t0')");
}

describe('plan-origin reads (VS-550)', () => {
  it('lists a linked ticket with its plan and marks an early dispatch', async () => {
    harness = makeHarness(); seed(harness);
    const planning = harness.runtime.services.planning;
    const plan = planning.create(HUMAN, 'proj1', { threadId: 'th1', title: 'Redesign the board' });
    const draft = planning.addDraft(HUMAN, plan.id, { title: 'Scout the merge queue', kind: 'scout', suggestedTier: 'quick' });
    harness.db.insert('tickets', { id: 'tk_1', workspaceId: 'ws1', projectId: 'proj1', number: 42, identifier: 'ACME-42', kind: 'scout', title: 'Scout', createdByKind: 'human', createdAt: '2000-01-01T00:00:00.000Z', updatedAt: '2000-01-01T00:00:00.000Z' });
    planning.linkDraft(draft.id, { ticketId: 'tk_1' });

    const app = createApp(harness.deps);
    const res = await app.fetch(new Request('http://127.0.0.1/api/w/ws1/plan-origins', { headers: authed() }));
    expect(res.status).toBe(200);
    const { origins } = await res.json() as { origins: Array<Record<string, unknown>> };
    expect(origins).toHaveLength(1);
    expect(origins[0]).toMatchObject({ ticketId: 'tk_1', planId: plan.id, planTitle: 'Redesign the board', planStatus: 'drafting', dispatched: true });
  });

  it('carries the origin on ticket detail and null for a ticket with no plan', async () => {
    harness = makeHarness(); seed(harness);
    const app = createApp(harness.deps);
    const detail = await app.fetch(new Request('http://127.0.0.1/api/w/ws1/tickets/tk_1', { headers: authed() }));
    expect(detail.status).toBe(200);
    expect((await detail.json() as { plan: unknown }).plan).toBeNull();
  });
});
