/**
 * The `weave_roadmap_*` tools (VS-397) — exercised through `runTool`, the same entry the MCP endpoint
 * and the agent route use, over the harness's real roadmap service and sqlite db.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { RoadmapItem, ToolResult } from '@weave-ai/shared';
import { TOOLS, runTool, type ToolCtx } from '../src/tools.js';
import type { RunTokenClaims } from '../src/runtoken.js';
import { makeHarness, ticket, type Harness } from './fakes.js';

let harness: Harness | null = null;
afterEach(async () => { await harness?.close(); harness = null; });

const WORKER: RunTokenClaims = { workspaceId: 'ws1', runId: 'run_1', agentId: 'ag_1', agentKind: 'worker', projectId: 'proj1', ticketId: 'tk_1', roleId: 'role_1' };
const WEAVER: RunTokenClaims = { workspaceId: 'ws1', runId: 'run_c', agentId: 'ag_conductor', agentKind: 'weaver', projectId: null, ticketId: null, roleId: null };

function seed(h: Harness): void {
  h.db.run("INSERT INTO projects (id, workspace_id, slug, name, git_url, default_branch, clone_path, max_workers, worktree_provider, openspec_enabled, policies_json, status, created_at, updated_at) VALUES ('proj1','ws1','api','API','git@example.com:acme/api.git','main','/tmp',4,'git',1,'{}','ready','t0','t0')");
  h.db.run("INSERT INTO projects (id, workspace_id, slug, name, git_url, default_branch, clone_path, max_workers, worktree_provider, openspec_enabled, policies_json, status, created_at, updated_at) VALUES ('proj2','ws1','web','Web','git@example.com:acme/web.git','main','/tmp/web',4,'git',1,'{}','ready','t0','t0')");
  // Real ticket rows too: `roadmap_items.ticket_id` is a real FK, and the fake's in-memory Map alone
  // is not enough to satisfy it. `tk_1` is this project's ticket, `tk_2` another project's.
  h.db.run("INSERT INTO tickets (id, workspace_id, project_id, number, identifier, kind, title, created_by_kind, created_at, updated_at) VALUES ('tk_1','ws1','proj1',42,'ACME-42','change','Add dark mode','human','t0','t0')");
  h.db.run("INSERT INTO tickets (id, workspace_id, project_id, number, identifier, kind, title, created_by_kind, created_at, updated_at) VALUES ('tk_2','ws1','proj2',43,'ACME-43','change','Other','human','t0','t0')");
  h.tickets.set('tk_2', ticket({ id: 'tk_2', projectId: 'proj2', identifier: 'ACME-43' }));
}

const ctxFor = (h: Harness, claims: RunTokenClaims): ToolCtx =>
  ({ ws: h.runtime, claims, actor: { kind: 'agent', id: claims.agentId, runId: claims.runId } });

const call = (h: Harness, name: string, input: unknown, claims: RunTokenClaims = WEAVER): Promise<ToolResult<never>> =>
  runTool(name, ctxFor(h, claims), input) as Promise<ToolResult<never>>;

const items = (h: Harness, result: ToolResult<never>): RoadmapItem[] =>
  (result as { ok: true; data: { items: RoadmapItem[] } }).data.items;

describe('the weave_roadmap_* tools (VS-397)', () => {
  it('adds and lists items for the weaver', async () => {
    const h = makeHarness(); harness = h; seed(h);
    const added = await call(h, 'weave_roadmap_add', { projectId: 'proj1', title: 'Dark mode', notes: '## later' });
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    expect(added.data).toMatchObject({ projectId: 'proj1', title: 'Dark mode', notes: '## later', status: 'idea', position: 0 });

    const listed = await call(h, 'weave_roadmap_list', { projectId: 'proj1' });
    expect(listed.ok).toBe(true);
    expect(items(h, listed).map((i) => i.title)).toEqual(['Dark mode']);
  });

  it('refuses an invalid status and an empty title without throwing', async () => {
    const h = makeHarness(); harness = h; seed(h);
    const bad = await call(h, 'weave_roadmap_add', { projectId: 'proj1', title: 'x', status: 'someday' });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error.code).toBe('validation');
    const empty = await call(h, 'weave_roadmap_add', { projectId: 'proj1', title: '   ' });
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(empty.error.code).toBe('validation');
  });

  it('links a ticket when an idea becomes work, and refuses another project\u2019s ticket', async () => {
    const h = makeHarness(); harness = h; seed(h);
    const added = await call(h, 'weave_roadmap_add', { projectId: 'proj1', title: 'Dark mode' });
    const item = (added as { ok: true; data: RoadmapItem }).data;

    const linked = await call(h, 'weave_roadmap_update', { itemId: item.id, ticketId: 'tk_1', status: 'planned' });
    expect(linked.ok).toBe(true);
    expect((linked as { ok: true; data: RoadmapItem }).data).toMatchObject({ ticketId: 'tk_1', status: 'planned' });

    const foreign = await call(h, 'weave_roadmap_update', { itemId: item.id, ticketId: 'tk_2' });
    expect(foreign.ok).toBe(false);
    if (!foreign.ok) expect(foreign.error.code).toBe('not_found');
  });

  it('round-trips a project named by slug for the weaver', async () => {
    const h = makeHarness(); harness = h; seed(h);
    const added = await call(h, 'weave_roadmap_add', { projectId: 'api', title: 'By slug' });
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    // Stored under the canonical id, so the id-addressed list sees it too.
    expect(added.data).toMatchObject({ projectId: 'proj1' });

    const bySlug = await call(h, 'weave_roadmap_list', { projectId: 'api' });
    expect(bySlug.ok).toBe(true);
    expect(items(h, bySlug).map((i) => i.title)).toEqual(['By slug']);
    const byId = await call(h, 'weave_roadmap_list', { projectId: 'proj1' });
    expect(items(h, byId).map((i) => i.title)).toEqual(['By slug']);
  });

  it('lets a worker read its own project named by its slug', async () => {
    const h = makeHarness(); harness = h; seed(h);
    await call(h, 'weave_roadmap_add', { projectId: 'proj1', title: 'Own' });
    const own = await call(h, 'weave_roadmap_list', { projectId: 'api' }, WORKER);
    expect(own.ok).toBe(true);
    expect(items(h, own).map((i) => i.title)).toEqual(['Own']);
  });

  it('lets a worker read its own project and refuses another project', async () => {
    const h = makeHarness(); harness = h; seed(h);
    await call(h, 'weave_roadmap_add', { projectId: 'proj1', title: 'Own' });
    await call(h, 'weave_roadmap_add', { projectId: 'proj2', title: 'Theirs' });

    const own = await call(h, 'weave_roadmap_list', {}, WORKER);
    expect(own.ok).toBe(true);
    expect(items(h, own).map((i) => i.title)).toEqual(['Own']);

    const other = await call(h, 'weave_roadmap_list', { projectId: 'proj2' }, WORKER);
    expect(other.ok).toBe(false);
    if (!other.ok) expect(other.error.code).toBe('forbidden');
  });

  it('refuses every roadmap write to a worker, leaving the roadmap unchanged', async () => {
    const h = makeHarness(); harness = h; seed(h);
    const added = await call(h, 'weave_roadmap_add', { projectId: 'proj1', title: 'Dark mode' });
    const item = (added as { ok: true; data: RoadmapItem }).data;

    for (const [name, input] of [
      ['weave_roadmap_add', { projectId: 'proj1', title: 'Sneaky' }],
      ['weave_roadmap_update', { itemId: item.id, title: 'Hijacked' }],
      ['weave_roadmap_remove', { itemId: item.id }],
    ] as const) {
      const res = await call(h, name, input, WORKER);
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error.code).toBe('forbidden');
    }

    const listed = await call(h, 'weave_roadmap_list', { projectId: 'proj1' });
    expect(items(h, listed).map((i) => i.title)).toEqual(['Dark mode']);
  });
});

describe('the roadmap block and pending-ticket tools (VS-478)', () => {
  it('creates a block, bundles three pending tickets and moves one between blocks', async () => {
    const h = makeHarness(); harness = h; seed(h);
    const made = await call(h, 'weave_roadmap_block_create', { projectId: 'proj1', title: 'UI polish' });
    expect(made.ok).toBe(true);
    if (!made.ok) return;
    const b1 = (made.data as { id: string }).id;
    const made2 = await call(h, 'weave_roadmap_block_create', { projectId: 'proj1', title: 'Docs' });
    const b2 = (made2 as { ok: true; data: { id: string } }).data.id;

    const a = (await call(h, 'weave_roadmap_item_add', { blockId: b1, title: 'A', description: 'a', kind: 'task', priority: 'high' })) as { ok: true; data: { id: string } };
    const b = (await call(h, 'weave_roadmap_item_add', { blockId: b1, title: 'B' })) as { ok: true; data: { id: string } };
    const c = (await call(h, 'weave_roadmap_item_add', { blockId: b1, title: 'C' })) as { ok: true; data: { id: string } };
    expect(a.ok && b.ok && c.ok).toBe(true);

    const merged = await call(h, 'weave_roadmap_item_merge', { itemIds: [a.data.id, b.data.id] });
    expect(merged.ok).toBe(true);
    if (merged.ok) expect((merged.data as { description: string }).description).toContain('### Merged: B');

    const moved = await call(h, 'weave_roadmap_item_update', { itemId: c.data.id, blockId: b2 });
    expect(moved.ok).toBe(true);
    if (moved.ok) expect((moved.data as { blockId: string }).blockId).toBe(b2);

    const listed = await call(h, 'weave_roadmap_block_list', { projectId: 'proj1' });
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    const blocks = (listed.data as { blocks: Array<{ id: string; items: RoadmapItem[] }> }).blocks;
    expect(blocks.find((x) => x.id === b1)!.items.map((i) => i.title)).toEqual(['A']);
    expect(blocks.find((x) => x.id === b2)!.items.map((i) => i.title)).toEqual(['C']);
  });

  it('starts a block into filing-ready drafts and links each created ticket', async () => {
    const h = makeHarness(); harness = h; seed(h);
    const made = await call(h, 'weave_roadmap_block_create', { projectId: 'proj1', title: 'UI polish' });
    const b1 = (made as { ok: true; data: { id: string } }).data.id;
    const i1 = (await call(h, 'weave_roadmap_item_add', { blockId: b1, title: 'One', description: 'd1', kind: 'change', priority: 'high' })) as { ok: true; data: { id: string } };

    const started = await call(h, 'weave_roadmap_block_start', { blockId: b1 });
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    const data = started.data as { block: { status: string }; drafts: Array<{ itemId: string; title: string; description: string; kind: string; priority: string }> };
    expect(data.block.status).toBe('started');
    expect(data.drafts).toEqual([{ itemId: i1.data.id, title: 'One', description: 'd1', kind: 'change', priority: 'high', roleId: null }]);

    const linked = await call(h, 'weave_roadmap_item_update', { itemId: i1.data.id, ticketId: 'tk_1' });
    expect(linked.ok).toBe(true);
    if (linked.ok) expect((linked.data as { ticketId: string }).ticketId).toBe('tk_1');
    // A second start has nothing left to file.
    const again = await call(h, 'weave_roadmap_block_start', { blockId: b1 });
    if (again.ok) expect((again.data as { drafts: unknown[] }).drafts).toHaveLength(0);
  });

  it('refuses every block and pending-ticket write to a worker', async () => {
    const h = makeHarness(); harness = h; seed(h);
    const made = await call(h, 'weave_roadmap_block_create', { projectId: 'proj1', title: 'UI polish' });
    const b1 = (made as { ok: true; data: { id: string } }).data.id;
    const item = (await call(h, 'weave_roadmap_item_add', { blockId: b1, title: 'A' })) as { ok: true; data: { id: string } };

    for (const [name, input] of [
      ['weave_roadmap_block_create', { projectId: 'proj1', title: 'Sneaky' }],
      ['weave_roadmap_block_list', { projectId: 'proj1' }],
      ['weave_roadmap_block_update', { blockId: b1, title: 'Hijacked' }],
      ['weave_roadmap_block_start', { blockId: b1 }],
      ['weave_roadmap_item_add', { blockId: b1, title: 'Sneaky' }],
      ['weave_roadmap_item_update', { itemId: item.data.id, title: 'Hijacked' }],
      ['weave_roadmap_item_merge', { itemIds: [item.data.id, 'ghost'] }],
    ] as const) {
      const res = await call(h, name, input, WORKER);
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error.code).toBe('forbidden');
    }
  });

  it('states the bundling intent in the tool descriptions', () => {
    const byName = new Map(TOOLS.map((t) => [t.name, t.description]));
    expect(byName.get('weave_roadmap_block_create')).toMatch(/bundle|one ticket/);
    expect(byName.get('weave_roadmap_block_start')).toMatch(/weave_ticket_create/);
    expect(byName.get('weave_roadmap_block_start')).toMatch(/bundl/);
    expect(byName.get('weave_roadmap_item_merge')).toMatch(/bundle|one worker/);
  });
});
