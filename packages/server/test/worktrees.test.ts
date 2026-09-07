import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { authed, makeHarness, type Harness } from './fakes.js';

let harness: Harness | null = null;
afterEach(async () => { await harness?.close(); harness = null; });

const app = (opts?: Parameters<typeof makeHarness>[0]) => {
  harness = makeHarness(opts);
  return { h: harness, fetch: (path: string, init?: RequestInit) => createApp(harness!.deps).fetch(new Request(`http://127.0.0.1:7433${path}`, init)) };
};

// VS-101: discarding an interactive session's worktree needs no special-casing — the existing
// force-flag confirmation already covers it, exactly as for any worker's worktree.
describe('POST /worktrees/:id/discard against an interactive session', () => {
  function seedSessionWorktree(h: Harness): void {
    h.db.run(
      "INSERT INTO projects (id, workspace_id, slug, name, git_url, default_branch, clone_path, max_workers, worktree_provider, openspec_enabled, policies_json, status, created_at, updated_at) VALUES ('proj1','ws1','api','API','git@example.com:acme/api.git','main','/tmp',4,'git',1,'{}','ready','t0','t0')",
    );
    h.db.run(
      "INSERT INTO tickets (id, workspace_id, project_id, number, identifier, kind, title, status, interactive_session, created_by_kind, created_at, updated_at) VALUES ('tk_1','ws1','proj1',1,'ACME-1','task','Debug it','in_progress',1,'human','t0','t0')",
    );
    h.db.run(
      "INSERT INTO agents (id, workspace_id, kind, project_id, ticket_id, name, runtime_id, status, home_path, turn_epoch, turn_count, spawned_by, brief_revision, created_at, updated_at) VALUES ('ag_1','ws1','worker','proj1','tk_1','Session','fake','active','/tmp/home',0,0,'human',1,'t0','t0')",
    );
    h.db.run(
      "INSERT INTO worktrees (id, project_id, ticket_id, agent_id, provider, path, branch, status, created_at) VALUES ('wt_1','proj1','tk_1','ag_1','git','/tmp/does-not-exist','ac/session-ag1','active','t0')",
    );
  }

  it('refuses without force: true, exactly as any worktree discard does', async () => {
    const { h, fetch } = app();
    seedSessionWorktree(h);
    const res = await fetch('/api/w/ws1/worktrees/wt_1/discard', {
      method: 'POST', headers: { ...authed(), 'content-type': 'application/json' }, body: JSON.stringify({}),
    });
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error.code).toBe('worktree_not_landed');
    expect(h.db.get('SELECT status FROM worktrees WHERE id = ?', ['wt_1'])).toMatchObject({ status: 'active' });
  });

  it('proceeds with force: true, the human\'s explicit word', async () => {
    const { h, fetch } = app();
    seedSessionWorktree(h);
    h.impls.workers!['cancel'] = async () => ({ id: 'ag_1' });
    const res = await fetch('/api/w/ws1/worktrees/wt_1/discard', {
      method: 'POST', headers: { ...authed(), 'content-type': 'application/json' }, body: JSON.stringify({ force: true }),
    });
    expect(res.status).toBe(200);
    expect(h.db.get<{ status: string }>('SELECT status FROM worktrees WHERE id = ?', ['wt_1'])).toMatchObject({ status: 'removed' });
  });
});
