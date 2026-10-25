/** VS-830: a re-point reports when it leaves the daemon's release source on the project's previous URL. */
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { authed, makeHarness, type Harness, type HarnessOptions } from './fakes.js';

let harness: Harness | null = null;
afterEach(async () => { await harness?.close(); harness = null; });

const app = (opts: HarnessOptions) => {
  harness = makeHarness(opts);
  return { h: harness, fetch: (path: string, init?: RequestInit) => createApp(harness!.deps).fetch(new Request(`http://127.0.0.1:7433${path}`, init)) };
};

const patchProject = (path: string, body: unknown, headers = authed()) => new Request(`http://127.0.0.1:7433${path}`, {
  method: 'PATCH', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify(body),
});

/** A ready project row the fake's `projects.get` reads back. */
function seedProject(h: Harness, over: { id: string; gitUrl: string }): void {
  h.db.run(
    `INSERT INTO projects (id, workspace_id, slug, name, git_url, default_branch, landing_branch, clone_path, max_workers,
       worktree_provider, openspec_enabled, status, sync_state, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [over.id, 'ws1', over.id, over.id, over.gitUrl, 'main', null, tmpdir(), 2, 'git', 1, 'ready', 'in_sync', '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z'],
  );
}

describe('PATCH /projects/:id and the daemon release source (VS-830)', () => {
  const oldUrl = 'git@github.com:victornor/agent-conductor.git';
  const newUrl = 'git@github.com:victornor/weave-ai-orchestrator.git';

  it('reports the release source it left on the previous URL', async () => {
    const { h, fetch } = app({ daemon: { upgrade: { source: oldUrl, ref: 'main' } } });
    seedProject(h, { id: 'api', gitUrl: oldUrl });
    h.impls['projects']!['update'] = async (_a: unknown, id: string, patch: { url?: string }) => {
      const row = h.db.get<Record<string, unknown>>('SELECT * FROM projects WHERE id = ?', [id])!;
      h.db.run('UPDATE projects SET git_url = ? WHERE id = ?', [patch.url ?? row['git_url'], id]);
      return { ...row, gitUrl: patch.url ?? row['git_url'] };
    };
    const res = await fetch(`/api/w/ws1/projects/api`, patchProject(`/api/w/ws1/projects/api`, { url: newUrl }));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ gitUrl: newUrl, releaseSource: { previousUrl: oldUrl, currentUrl: newUrl } });
  });

  it('matches the source however it is written', async () => {
    const { h, fetch } = app({ daemon: { upgrade: { source: 'https://github.com/victornor/agent-conductor' } } });
    seedProject(h, { id: 'api', gitUrl: oldUrl });
    h.impls['projects']!['update'] = async (_a: unknown, id: string, patch: { url?: string }) => ({ ...h.db.get<Record<string, unknown>>('SELECT * FROM projects WHERE id = ?', [id])!, gitUrl: patch.url });
    const body = await (await fetch('/api/w/ws1/projects/api', patchProject('/api/w/ws1/projects/api', { url: newUrl }))).json();
    expect(body.releaseSource).toEqual({ previousUrl: oldUrl, currentUrl: newUrl });
  });

  it('reports nothing when the release source is an independent choice', async () => {
    const { h, fetch } = app({ daemon: { upgrade: { source: 'git@github.com:someone/else.git' } } });
    seedProject(h, { id: 'api', gitUrl: oldUrl });
    h.impls['projects']!['update'] = async (_a: unknown, id: string, patch: { url?: string }) => ({ ...h.db.get<Record<string, unknown>>('SELECT * FROM projects WHERE id = ?', [id])!, gitUrl: patch.url });
    const body = await (await fetch('/api/w/ws1/projects/api', patchProject('/api/w/ws1/projects/api', { url: newUrl }))).json();
    expect(body.releaseSource).toBeUndefined();
  });

  it('reports nothing when there is no release source at all', async () => {
    const { h, fetch } = app({});
    seedProject(h, { id: 'api', gitUrl: oldUrl });
    h.impls['projects']!['update'] = async (_a: unknown, id: string, patch: { url?: string }) => ({ ...h.db.get<Record<string, unknown>>('SELECT * FROM projects WHERE id = ?', [id])!, gitUrl: patch.url });
    const body = await (await fetch('/api/w/ws1/projects/api', patchProject('/api/w/ws1/projects/api', { url: newUrl }))).json();
    expect(body.releaseSource).toBeUndefined();
  });

  it('never changes the release source by itself', async () => {
    const { h, fetch } = app({ daemon: { upgrade: { source: oldUrl, ref: 'main' } } });
    seedProject(h, { id: 'api', gitUrl: oldUrl });
    h.impls['projects']!['update'] = async (_a: unknown, id: string, patch: { url?: string }) => ({ ...h.db.get<Record<string, unknown>>('SELECT * FROM projects WHERE id = ?', [id])!, gitUrl: patch.url });
    await fetch('/api/w/ws1/projects/api', patchProject('/api/w/ws1/projects/api', { url: newUrl }));
    expect(h.deps.daemon.upgrade.source).toBe(oldUrl);
  });

  it('reports nothing when the URL did not change', async () => {
    const { h, fetch } = app({ daemon: { upgrade: { source: oldUrl, ref: 'main' } } });
    seedProject(h, { id: 'api', gitUrl: newUrl });
    h.impls['projects']!['update'] = async (_a: unknown, id: string) => h.db.get<Record<string, unknown>>('SELECT * FROM projects WHERE id = ?', [id]);
    const body = await (await fetch('/api/w/ws1/projects/api', patchProject('/api/w/ws1/projects/api', { maxWorkers: 4 }))).json();
    expect(body.releaseSource).toBeUndefined();
  });
});
