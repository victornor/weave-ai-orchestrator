/** HTTP roadmap (`/projects/:id/roadmap`) — session auth, CRUD, order, project scoping (VS-397). */
import { afterEach, describe, expect, it } from 'vitest';
import type { RoadmapItem } from '@weave-ai/shared';
import { createApp } from '../src/app.js';
import { authed, makeHarness, type Harness } from './fakes.js';

let harness: Harness | null = null;
afterEach(async () => { await harness?.close(); harness = null; });

const PROJECT = 'proj1';

function seedProjects(h: Harness): void {
  h.db.run("INSERT INTO projects (id, workspace_id, slug, name, git_url, default_branch, clone_path, max_workers, worktree_provider, openspec_enabled, policies_json, status, created_at, updated_at) VALUES ('proj1','ws1','api','API','git@example.com:acme/api.git','main','/tmp',4,'git',1,'{}','ready','t0','t0')");
  h.db.run("INSERT INTO projects (id, workspace_id, slug, name, git_url, default_branch, clone_path, max_workers, worktree_provider, openspec_enabled, policies_json, status, created_at, updated_at) VALUES ('proj2','ws1','web','Web','git@example.com:acme/web.git','main','/tmp/web',4,'git',1,'{}','ready','t0','t0')");
}

describe('roadmap HTTP (VS-397)', () => {
  it('lists empty, creates and appends in order', async () => {
    harness = makeHarness();
    seedProjects(harness);
    const app = createApp(harness.deps);

    const empty = await app.fetch(new Request(`http://127.0.0.1/api/w/ws1/projects/${PROJECT}/roadmap`, { headers: authed() }));
    expect(empty.status).toBe(200);
    expect(await empty.json()).toEqual({ items: [] });

    for (const title of ['Dark mode', 'Keyboard shortcuts']) {
      const created = await app.fetch(new Request(`http://127.0.0.1/api/w/ws1/projects/${PROJECT}/roadmap`, {
        method: 'POST', headers: authed({ 'content-type': 'application/json' }), body: JSON.stringify({ title }),
      }));
      expect(created.status).toBe(201);
    }
    const listed = await app.fetch(new Request(`http://127.0.0.1/api/w/ws1/projects/${PROJECT}/roadmap`, { headers: authed() }));
    const body = await listed.json() as { items: RoadmapItem[] };
    expect(body.items.map((i) => i.title)).toEqual(['Dark mode', 'Keyboard shortcuts']);
    expect(body.items.map((i) => i.position)).toEqual([0, 1]);
    expect(body.items[0]).toMatchObject({ status: 'idea', notes: '', ticketId: null, projectId: PROJECT });
  });

  it('updates title, notes, status and position, then deletes', async () => {
    harness = makeHarness();
    seedProjects(harness);
    const app = createApp(harness.deps);
    const post = async (title: string): Promise<RoadmapItem> => {
      const res = await app.fetch(new Request(`http://127.0.0.1/api/w/ws1/projects/${PROJECT}/roadmap`, {
        method: 'POST', headers: authed({ 'content-type': 'application/json' }), body: JSON.stringify({ title }),
      }));
      return res.json() as Promise<RoadmapItem>;
    };
    const a = await post('A');
    const b = await post('B');

    const patched = await app.fetch(new Request(`http://127.0.0.1/api/w/ws1/projects/${PROJECT}/roadmap/${b.id}`, {
      method: 'PATCH', headers: authed({ 'content-type': 'application/json' }), body: JSON.stringify({ title: 'B v2', notes: '## later', status: 'planned', position: 0 }),
    }));
    expect(patched.status).toBe(200);
    expect(await patched.json()).toMatchObject({ title: 'B v2', notes: '## later', status: 'planned', position: 0 });

    const listed = await app.fetch(new Request(`http://127.0.0.1/api/w/ws1/projects/${PROJECT}/roadmap`, { headers: authed() }));
    expect((await listed.json() as { items: RoadmapItem[] }).items.map((i) => i.id)).toEqual([b.id, a.id]);

    const removed = await app.fetch(new Request(`http://127.0.0.1/api/w/ws1/projects/${PROJECT}/roadmap/${a.id}`, { method: 'DELETE', headers: authed() }));
    expect(removed.status).toBe(200);
    expect(await removed.json()).toEqual({ ok: true });
    const after = await app.fetch(new Request(`http://127.0.0.1/api/w/ws1/projects/${PROJECT}/roadmap`, { headers: authed() }));
    expect((await after.json() as { items: RoadmapItem[] }).items.map((i) => i.id)).toEqual([b.id]);
  });

  it('rejects a status the enum does not carry', async () => {
    harness = makeHarness();
    seedProjects(harness);
    const app = createApp(harness.deps);
    const res = await app.fetch(new Request(`http://127.0.0.1/api/w/ws1/projects/${PROJECT}/roadmap`, {
      method: 'POST', headers: authed({ 'content-type': 'application/json' }), body: JSON.stringify({ title: 'A', status: 'someday' }),
    }));
    expect(res.status).toBe(400);
  });

  it('never reaches another project\u2019s item by id', async () => {
    harness = makeHarness();
    seedProjects(harness);
    const app = createApp(harness.deps);
    const created = await app.fetch(new Request('http://127.0.0.1/api/w/ws1/projects/proj2/roadmap', {
      method: 'POST', headers: authed({ 'content-type': 'application/json' }), body: JSON.stringify({ title: 'Theirs' }),
    }));
    const theirs = await created.json() as RoadmapItem;

    const patch = await app.fetch(new Request(`http://127.0.0.1/api/w/ws1/projects/${PROJECT}/roadmap/${theirs.id}`, {
      method: 'PATCH', headers: authed({ 'content-type': 'application/json' }), body: JSON.stringify({ title: 'Hijacked' }),
    }));
    expect(patch.status).toBe(404);
    const del = await app.fetch(new Request(`http://127.0.0.1/api/w/ws1/projects/${PROJECT}/roadmap/${theirs.id}`, { method: 'DELETE', headers: authed() }));
    expect(del.status).toBe(404);
    // Still there, untouched.
    const theirsList = await app.fetch(new Request('http://127.0.0.1/api/w/ws1/projects/proj2/roadmap', { headers: authed() }));
    const theirsBody = await theirsList.json() as { items: RoadmapItem[] };
    expect(theirsBody.items).toHaveLength(1);
    expect(theirsBody.items[0]!.title).toBe('Theirs');
  });
});
