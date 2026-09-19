/** HTTP promotion surface (`/projects/:id/promotion`) — session auth and the VS-584 content/in-flight shape. */
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { authed, makeHarness, type Harness } from './fakes.js';

let harness: Harness | null = null;
afterEach(async () => { await harness?.close(); harness = null; });

describe('promotion HTTP (VS-584)', () => {
  it('serves the honest content, the resolved strategy and the in-flight record', async () => {
    harness = makeHarness();
    harness.db.run("INSERT INTO projects (id, workspace_id, slug, name, git_url, default_branch, landing_branch, clone_path, max_workers, worktree_provider, openspec_enabled, policies_json, status, created_at, updated_at) VALUES ('proj1','ws1','api','API','git@example.com:acme/api.git','main','edge','/tmp/ac-nonexistent',4,'git',1,'{}','ready','t0','t0')");
    const app = createApp(harness.deps);

    const res = await app.fetch(new Request('http://127.0.0.1/api/w/ws1/projects/proj1/promotion', { headers: authed() }));
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body).toMatchObject({ applicable: true, landing: 'edge', defaultBranch: 'main', strategy: 'direct-push', changedFiles: 0, canPromote: false, promotion: null });
    expect(body['heldReason']).toBe('the project has no local clone');
  });

  it('is not applicable when landing is the default branch', async () => {
    harness = makeHarness();
    harness.db.run("INSERT INTO projects (id, workspace_id, slug, name, git_url, default_branch, clone_path, max_workers, worktree_provider, openspec_enabled, policies_json, status, created_at, updated_at) VALUES ('proj1','ws1','api','API','git@example.com:acme/api.git','main','/tmp/ac-nonexistent',4,'git',1,'{}','ready','t0','t0')");
    const app = createApp(harness.deps);
    const res = await app.fetch(new Request('http://127.0.0.1/api/w/ws1/projects/proj1/promotion', { headers: authed() }));
    const body = await res.json() as Record<string, unknown>;
    expect(body).toMatchObject({ applicable: false, strategy: 'direct-push', promotion: null });
  });
});
