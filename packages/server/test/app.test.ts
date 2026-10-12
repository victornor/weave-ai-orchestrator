import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, afterEach } from 'vitest';
import { OcError, type Agent } from '@weave-ai/shared';
import { clearHostToolCache } from '@weave-ai/core';
import { FakeRuntime } from '@weave-ai/runtime-sdk';
import { createApp } from '../src/app.js';
import { runTokenSecret, signRunToken } from '../src/runtoken.js';
import { authed, makeHarness, ticket, type Harness } from './fakes.js';

let harness: Harness | null = null;
afterEach(async () => { await harness?.close(); harness = null; });

const app = (opts?: Parameters<typeof makeHarness>[0]) => {
  harness = makeHarness(opts);
  return { h: harness, fetch: (path: string, init?: RequestInit) => createApp(harness!.deps).fetch(new Request(`http://127.0.0.1:7433${path}`, init)) };
};

describe('auth gating', () => {
  it('lets health through unauthenticated', async () => {
    const { fetch } = app();
    const res = await fetch('/api/health');
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ ok: true, operatorConfigured: true, tlsMode: 'none' });
  });

  it('401s an unauthenticated API call', async () => {
    const { fetch } = app();
    const res = await fetch('/api/w/ws1/tickets');
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe('unauthorized');
  });

  it('accepts a bearer session token', async () => {
    const { fetch } = app();
    const res = await fetch('/api/w/ws1/tickets', { headers: authed() });
    expect(res.status).toBe(200);
    expect((await res.json()).items).toHaveLength(1);
  });

  it('accepts the ac_session cookie and enforces the Origin on mutations', async () => {
    const { fetch } = app();
    const ok = await fetch('/api/w/ws1/tickets', { headers: { cookie: 'ac_session=sess-token' } });
    expect(ok.status).toBe(200);

    const forged = await fetch('/api/w/ws1/tickets', {
      method: 'POST', headers: { cookie: 'ac_session=sess-token', origin: 'https://evil.example', 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'task', title: 'x' }),
    });
    expect(forged.status).toBe(403);
    expect((await forged.json()).error.code).toBe('forbidden');
  });

  it('re-sets the ac_session cookie to the slid expiry on every web-session request', async () => {
    const { fetch } = app();
    const viaCookie = await fetch('/api/w/ws1/tickets', { headers: { cookie: 'ac_session=web-token' } });
    expect(viaCookie.headers.get('set-cookie')).toMatch(/^ac_session=web-token;.*Expires=.*HttpOnly/);
    // A browser whose cookie already expired gets it back from its bearer copy, so its event stream recovers.
    const viaBearer = await fetch('/api/w/ws1/tickets', { headers: { authorization: 'Bearer web-token' } });
    expect(viaBearer.headers.get('set-cookie')).toMatch(/^ac_session=web-token;/);
    const cli = await fetch('/api/w/ws1/tickets', { headers: authed() });
    expect(cli.headers.get('set-cookie')).toBeNull();
  });

  it('bypasses auth for loopback peers when loopbackTrusted is set', async () => {
    harness = makeHarness();
    harness.deps.daemon.auth.loopbackTrusted = true;
    harness.deps.listener = 'loopback';
    const res = await createApp(harness.deps).fetch(new Request('http://127.0.0.1/api/w/ws1/tickets'));
    expect(res.status).toBe(200);
  });
});

describe('run tokens', () => {
  const token = async (h: Harness, over: Record<string, unknown> = {}) =>
    signRunToken(runTokenSecret(h.runtime.ctx.db), {
      workspaceId: 'ws1', runId: 'run_1', agentId: 'ag_1', agentKind: 'worker', projectId: 'proj1', ticketId: 'tk_1', roleId: 'role_1', ...over,
    } as never);

  it('are refused on the public listener', async () => {
    const { h, fetch } = app({ listener: 'public' });
    const res = await fetch('/api/w/ws1/agent/inbox', { headers: { authorization: `Bearer ${await token(h)}` } });
    expect(res.status).toBe(401);
  });

  it('are refused outside the agent surface', async () => {
    const { h, fetch } = app({ listener: 'loopback' });
    const res = await fetch('/api/w/ws1/tickets', { headers: { authorization: `Bearer ${await token(h)}` } });
    expect(res.status).toBe(403);
  });

  it('reach the agent surface on the loopback listener', async () => {
    const { h, fetch } = app({ listener: 'loopback' });
    const res = await fetch('/api/w/ws1/agent/inbox', { headers: { authorization: `Bearer ${await token(h)}` } });
    expect(res.status).toBe(200);
    const payload = await res.json();
    expect(payload.ok).toBe(true);
    expect(payload.data.messages).toHaveLength(1);
    expect(payload.data.messages[0].source).toBe('human_message');
  });

  it('reject a tampered signature', async () => {
    const { h, fetch } = app({ listener: 'loopback' });
    const bad = (await token(h)).slice(0, -3) + 'aaa';
    const res = await fetch('/api/w/ws1/agent/inbox', { headers: { authorization: `Bearer ${bad}` } });
    expect(res.status).toBe(401);
  });
});

describe('error mapping', () => {
  it('maps OcError codes onto their status and envelope', async () => {
    const { fetch } = app();
    const res = await fetch('/api/w/ws1/tickets/nope', { headers: authed() });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: { code: 'not_found', message: 'ticket nope not found', details: undefined, retryable: false } });
  });

  it('maps zod failures onto 400 validation with issues', async () => {
    const { fetch } = app();
    const res = await fetch('/api/w/ws1/tickets', { method: 'POST', headers: authed({ 'content-type': 'application/json' }), body: JSON.stringify({ title: 'no kind' }) });
    expect(res.status).toBe(400);
    const err = (await res.json()).error;
    expect(err.code).toBe('validation');
    expect(err.details.issues[0].path).toBe('kind');
  });

  it('404s an unknown API path instead of serving the SPA', async () => {
    const { fetch } = app();
    const res = await fetch('/api/w/ws1/nothing-here', { headers: authed() });
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toContain('application/json');
  });

  it('404s an unknown workspace', async () => {
    const { fetch } = app();
    const res = await fetch('/api/w/other/tickets', { headers: authed() });
    expect(res.status).toBe(404);
  });
});

describe('routes', () => {
  it('creates a ticket and emits an event', async () => {
    const { h, fetch } = app();
    const res = await fetch('/api/w/ws1/tickets', { method: 'POST', headers: authed({ 'content-type': 'application/json' }), body: JSON.stringify({ kind: 'task', title: 'Write tests' }) });
    expect(res.status).toBe(201);
    expect((await res.json()).title).toBe('Write tests');
    expect(h.bus.since(0).map((e) => e.type)).toContain('ticket.created');
  });

  it('reads a ticket document by id, at HEAD or an earlier revision (VS-224)', async () => {
    const { h, fetch } = app();
    h.documents.set('tk_1\0action', ['v1', 'v2']);
    const docId = encodeURIComponent('tk_1\0action');

    const head = await fetch(`/api/w/ws1/tickets/tk_1/documents/by-id/${docId}`, { headers: authed() });
    expect(head.status).toBe(200);
    await expect(head.json()).resolves.toMatchObject({ key: 'action', documentId: 'tk_1\0action', revision: 2, currentRevision: 2, body: 'v2' });

    const old = await fetch(`/api/w/ws1/tickets/tk_1/documents/by-id/${docId}?revision=1`, { headers: authed() });
    expect(old.status).toBe(200);
    await expect(old.json()).resolves.toMatchObject({ revision: 1, currentRevision: 2, body: 'v1' });
  });

  it('refuses by-id reads that name another ticket\'s document or an unknown id (VS-224)', async () => {
    const { h, fetch } = app();
    h.documents.set('tk_1\0action', ['v1']);
    const docId = encodeURIComponent('tk_1\0action');

    const other = await fetch(`/api/w/ws1/tickets/tk_2/documents/by-id/${docId}`, { headers: authed() });
    expect(other.status).toBe(404);
    expect((await other.json()).error.code).toBe('not_found');

    const missing = await fetch(`/api/w/ws1/tickets/tk_1/documents/by-id/doc_nope`, { headers: authed() });
    expect(missing.status).toBe(404);

    // The plain key route still answers for ordinary keys.
    h.documents.set('tk_1\0plan', ['the digest']);
    const byKey = await fetch('/api/w/ws1/tickets/tk_1/documents/plan', { headers: authed() });
    expect(byKey.status).toBe(200);
    await expect(byKey.json()).resolves.toMatchObject({ body: 'the digest' });
  });

  it('opens a nested capability whether the client encodes the slash or not', async () => {
    const { h, fetch } = app();
    const seen: string[] = [];
    h.impls.specs!.getCapability = (_project: string, capability: string) => { seen.push(capability); return { capability, requirements: [], pending: [], history: [] }; };

    for (const path of ['/api/w/ws1/specs/proj1/capabilities/conductor-chat%2Fdispatch-labels', '/api/w/ws1/specs/proj1/capabilities/conductor-chat/dispatch-labels']) {
      const res = await fetch(path, { headers: authed() });
      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toMatchObject({ capability: 'conductor-chat/dispatch-labels' });
    }
    expect(seen).toEqual(['conductor-chat/dispatch-labels', 'conductor-chat/dispatch-labels']);
  });

  it('patches one nested workspace default and leaves its siblings alone', async () => {
    const { h, fetch } = app();
    const saved: unknown[] = [];
    h.runtime.ctx.saveConfig = async (next) => { saved.push(next); h.runtime.ctx.config = next; };
    h.runtime.ctx.config.defaults.turnTimeoutSec = 900;

    const res = await fetch('/api/w/ws1/config', {
      method: 'PATCH', headers: authed({ 'content-type': 'application/json' }),
      body: JSON.stringify({ defaults: { knowledgeBudgetTokens: { project: 25000 } } }),
    });
    expect(res.status).toBe(200);
    const config = await res.json();
    expect(config.defaults.knowledgeBudgetTokens).toMatchObject({ project: 25000, document: 10000, shared: 2000 });
    expect(config.defaults.turnTimeoutSec).toBe(900);
    expect(config.name).toBe('Test workspace');
    expect(saved).toHaveLength(1);
  });

  it('rejects a knowledge budget that is not a sane token count and saves nothing', async () => {
    const { h, fetch } = app();
    const saved: unknown[] = [];
    h.runtime.ctx.saveConfig = async (next) => { saved.push(next); };

    const res = await fetch('/api/w/ws1/config', {
      method: 'PATCH', headers: authed({ 'content-type': 'application/json' }),
      body: JSON.stringify({ defaults: { knowledgeBudgetTokens: { project: 0 } } }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('validation');
    expect(saved).toHaveLength(0);
    expect(h.runtime.ctx.config.defaults.knowledgeBudgetTokens.project).toBe(10000);
  });

  it('refuses the deprecated workspace-wide YOLO key and saves nothing (VS-382)', async () => {
    const { h, fetch } = app();
    const saved: unknown[] = [];
    h.runtime.ctx.saveConfig = async (next) => { saved.push(next); };

    const res = await fetch('/api/w/ws1/config', {
      method: 'PATCH', headers: authed({ 'content-type': 'application/json' }),
      body: JSON.stringify({ defaults: { yolo: true } }),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: { code: string; message: string } };
    expect(body.error.code).toBe('validation');
    expect(body.error.message).toMatch(/per project/i);
    expect(saved).toHaveLength(0);
  });

  it("serves a project's merge queue with active and waiting tickets in order", async () => {
    const { h, fetch } = app();
    h.tickets.set('tk_1', ticket({ status: 'merging', mergeQueuedAt: '2026-09-01T10:00:00.000Z', mergeStartedAt: '2026-09-01T10:00:01.000Z' }));
    h.tickets.set('tk_2', ticket({ id: 'tk_2', identifier: 'ACME-43', title: 'Behind it', status: 'merging', mergeQueuedAt: '2026-09-01T11:00:00.000Z' }));

    const res = await fetch('/api/w/ws1/projects/proj1/merge-queue', { headers: authed() });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ projectId: 'proj1', concurrency: 1 });
    expect(body.active.map((e: { ticketId: string }) => e.ticketId)).toEqual(['tk_1']);
    expect(body.waiting).toEqual([expect.objectContaining({ ticketId: 'tk_2', identifier: 'ACME-43', position: 1 })]);
  });

  it('serves an empty merge queue for a project with nothing merging', async () => {
    const { fetch } = app();
    const res = await fetch('/api/w/ws1/projects/proj1/merge-queue', { headers: authed() });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ projectId: 'proj1', concurrency: 1, active: [], waiting: [], recent: [] });
  });

  it("serves what recently left a project's queue alongside it", async () => {
    const { h, fetch } = app();
    h.mergeOutcomes.push({ ticketId: 'tk_9', identifier: 'ACME-9', title: 'Landed earlier', outcome: 'landed', at: '2026-09-01T09:00:00.000Z', mergeCommit: 'abc1234' });

    const res = await fetch('/api/w/ws1/projects/proj1/merge-queue', { headers: authed() });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.recent).toEqual([expect.objectContaining({ identifier: 'ACME-9', outcome: 'landed', mergeCommit: 'abc1234' })]);
  });

  it('serves a project\'s pull requests joined to their tickets and changes', async () => {
    const { h, fetch } = app();
    h.tickets.set('tk_1', ticket({ openspecChangeName: 'acme-42-dark-mode' }));
    h.runtime.ctx.registries.forges.set('github', {
      id: 'github',
      detect: async () => true,
      prState: async () => ({ state: 'open' as const }),
      mergePr: async () => ({}),
      listPullRequests: async () => [{
        number: 12, title: 'Add dark mode', url: 'https://github.com/acme/api/pull/12', author: 'victornor',
        state: 'open' as const, isDraft: false, headRefName: 'ac/acme-42-add-dark-mode', baseRefName: 'main',
        createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T01:00:00.000Z', mergedAt: null, closedAt: null,
        additions: 5, deletions: 1, changedFiles: 1, checks: 'success' as const, reviewDecision: 'approved', mergeCommit: null,
      }],
      pullRequest: async () => null,
    });
    // The join reads real rows: this fake's db is migrated sqlite, so the ticket needs its project.
    h.db.run("INSERT INTO projects (id, workspace_id, slug, name, git_url, default_branch, clone_path, max_workers, worktree_provider, openspec_enabled, policies_json, status, created_at, updated_at) VALUES ('proj1','ws1','api','API','git@example.com:acme/api.git','main','/tmp',4,'git',1,'{}','ready','t0','t0')");
    h.db.run("INSERT INTO tickets (id, workspace_id, project_id, number, identifier, kind, title, description, status, priority, created_by_kind, openspec_change_name, created_at, updated_at) VALUES ('tk_1','ws1','proj1',42,'ACME-42','change','Add dark mode','','in_review','medium','agent','acme-42-dark-mode','t0','t0')");

    const res = await fetch('/api/w/ws1/projects/proj1/pull-requests', { headers: authed() });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ projectId: 'proj1', available: true, windowDays: 30 });
    expect(body.open[0]).toMatchObject({ number: 12, title: 'Add dark mode', changeName: 'acme-42-dark-mode' });
    expect(body.open[0].ticket).toMatchObject({ identifier: 'ACME-42' });
  });

  it('answers 200 with a reason, not an error, for a project with no forge', async () => {
    const { fetch } = app();
    const res = await fetch('/api/w/ws1/projects/proj1/pull-requests', { headers: authed() });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ available: false, reason: 'no_forge', open: [], recent: [] });
  });

  it('rejects a pull request number that is not one', async () => {
    const { fetch } = app();
    const res = await fetch('/api/w/ws1/projects/proj1/pull-requests/nope', { headers: authed() });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('validation');
  });

  it('reports repo visibility for a project and for a not-yet-created URL (VS-359)', async () => {
    const { h, fetch } = app();
    h.impls.projects!['repoInfo'] = async () => ({ private: false });
    h.impls.projects!['repoInfoForUrl'] = async () => ({ private: true });

    const byId = await fetch('/api/w/ws1/projects/proj1/repo-info', { headers: authed() });
    expect(byId.status).toBe(200);
    await expect(byId.json()).resolves.toEqual({ private: false });

    const byUrl = await fetch('/api/w/ws1/projects/repo-info?url=git%40github.com%3Aacme%2Fapi.git', { headers: authed() });
    expect(byUrl.status).toBe(200);
    await expect(byUrl.json()).resolves.toEqual({ private: true });
  });

  it('rejects repo-info without a url', async () => {
    const { fetch } = app();
    const res = await fetch('/api/w/ws1/projects/repo-info', { headers: authed() });
    expect(res.status).toBe(400);
  });

  it('accepts the knowledge-repo creation checkbox (VS-358/VS-359)', async () => {
    const { h, fetch } = app();
    let seen: { knowledgeRepo?: { enabled: boolean } } | null = null;
    h.impls.projects!['startAdd'] = (_actor: unknown, cfg: { knowledgeRepo?: { enabled: boolean } }) => {
      seen = cfg;
      return { project: { id: 'p_new', slug: 'new' }, jobId: 'job1' };
    };
    const res = await fetch('/api/w/ws1/projects', {
      method: 'POST', headers: authed({ 'content-type': 'application/json' }),
      body: JSON.stringify({ url: 'git@github.com:acme/new.git', knowledgeRepo: { enabled: true } }),
    });
    expect(res.status).toBe(202);
    expect(seen!.knowledgeRepo).toEqual({ enabled: true });
  });

  it('accepts the OpenSpec choice when adding a project (VS-578)', async () => {
    const { h, fetch } = app();
    let seen: { openspec?: { enabled: boolean } } | null = null;
    h.impls.projects!['startAdd'] = (_actor: unknown, cfg: { openspec?: { enabled: boolean } }) => {
      seen = cfg;
      return { project: { id: 'p_new', slug: 'new' }, jobId: 'job1' };
    };
    const res = await fetch('/api/w/ws1/projects', {
      method: 'POST', headers: authed({ 'content-type': 'application/json' }),
      body: JSON.stringify({ url: 'git@github.com:acme/new.git', openspec: { enabled: false } }),
    });
    expect(res.status).toBe(202);
    expect(seen!.openspec).toEqual({ enabled: false });
  });

  it("carries a waiting ticket's own merge queue position on its detail payload", async () => {
    const { h, fetch } = app();
    h.tickets.set('tk_1', ticket({ status: 'merging', mergeQueuedAt: '2026-09-01T11:00:00.000Z' }));

    const res = await fetch('/api/w/ws1/tickets/tk_1', { headers: authed() });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ mergeQueue: { position: 1, concurrency: 1 } });
  });

  it('reports no merge queue position for a ticket that is not waiting', async () => {
    const { fetch } = app();
    const res = await fetch('/api/w/ws1/tickets/tk_1', { headers: authed() });
    await expect(res.json()).resolves.toMatchObject({ mergeQueue: { position: null } });
  });

  it('serves ticket attachment bytes only through the authenticated, ticket-scoped route', async () => {
    const { h, fetch } = app();
    const root = mkdtempSync(join(tmpdir(), 'ac-ticket-attachment-route-'));
    try {
      const attachmentsDir = join(root, 'attachments');
      const storageKey = 'stored-image.png';
      const bytes = Buffer.from('ticket image bytes');
      mkdirSync(attachmentsDir, { recursive: true });
      writeFileSync(join(attachmentsDir, storageKey), bytes);
      (h.runtime.ctx.paths as { attachments: string }).attachments = attachmentsDir;

      const attachment = {
        id: 'att_1', ticketId: 'tk_1', label: 'screenshot.png', mediaType: 'image/png',
        byteSize: bytes.byteLength, sha256: createHash('sha256').update(bytes).digest('hex'),
        storageKey, createdAt: '2026-09-17T00:00:00.000Z',
      };
      h.impls.tickets!['attachment'] = (ticketId: string, attachmentId: string) => {
        if (ticketId !== attachment.ticketId || attachmentId !== attachment.id) throw new OcError('not_found', 'attachment not found');
        return attachment;
      };

      const ok = await fetch('/api/w/ws1/tickets/tk_1/attachments/att_1', { headers: authed() });
      expect(ok.status).toBe(200);
      expect(ok.headers.get('content-type')).toBe('image/png');
      expect(ok.headers.get('content-length')).toBe(String(bytes.byteLength));
      expect(ok.headers.get('content-disposition')).toBe('inline');
      expect(Buffer.from(await ok.arrayBuffer())).toEqual(bytes);

      const crossTicket = await fetch('/api/w/ws1/tickets/tk_2/attachments/att_1', { headers: authed() });
      expect(crossTicket.status).toBe(404);
      const unauthenticated = await fetch('/api/w/ws1/tickets/tk_1/attachments/att_1');
      expect(unauthenticated.status).toBe(401);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("names a ticket's last worker even after it has retired (VS-106)", async () => {
    const { h, fetch } = app();
    h.tickets.set('tk_1', ticket({ workerId: null }));
    h.impls.tickets!['lastWorker'] = () => ({ id: 'ag_1', status: 'retired', name: 'Backend Engineer #1' } as unknown as Agent);
    h.impls.workers!['get'] = (id: string) => (id === 'ag_1' ? ({ id: 'ag_1', status: 'retired', name: 'Backend Engineer #1' } as unknown as Agent) : null);

    const res = await fetch('/api/w/ws1/tickets/tk_1', { headers: authed() });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ worker: { id: 'ag_1', status: 'retired' } });
  });

  it('names no worker for a ticket that never had one', async () => {
    const { h, fetch } = app();
    h.tickets.set('tk_1', ticket({ workerId: null }));
    h.impls.tickets!['lastWorker'] = () => null;

    const res = await fetch('/api/w/ws1/tickets/tk_1', { headers: authed() });
    await expect(res.json()).resolves.toMatchObject({ worker: null });
  });

  it('reports no openspecState for a ticket whose project has OpenSpec off (VS-578)', async () => {
    const { h, fetch } = app();
    h.impls.openspec!['statusFor'] = async () => ({ enabled: false, changeName: '', planningComplete: false, artifacts: [], tasks: null, applyState: null, validation: null, archived: false });
    const res = await fetch('/api/w/ws1/tickets/tk_1', { headers: authed() });
    await expect(res.json()).resolves.toMatchObject({ openspecState: null });
  });

  it('still reports openspecState for a ticket on the OpenSpec path (VS-578)', async () => {
    const { h, fetch } = app();
    const status = { enabled: true, changeName: 'acme-42-dark-mode', planningComplete: true, artifacts: [], tasks: null, applyState: null, validation: null, archived: false };
    h.impls.openspec!['statusFor'] = async () => status;
    const res = await fetch('/api/w/ws1/tickets/tk_1', { headers: authed() });
    await expect(res.json()).resolves.toMatchObject({ openspecState: status });
  });

  it('serves the briefing snapshot', async () => {
    const { fetch } = app();
    const res = await fetch('/api/w/ws1/briefing', { headers: authed() });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ warnings: [], needsYou: [] });
  });

  it('serves openapi.json and llms/api.txt without auth', async () => {
    const { fetch } = app();
    const doc = await (await fetch('/api/openapi.json')).json();
    expect(doc.openapi).toBe('3.1.0');
    expect(Object.keys(doc.paths)).toContain('/api/w/{ws}/tickets');
    const txt = await (await fetch('/llms/api.txt')).text();
    expect(txt).toContain('weave_inbox');
    expect(txt).toContain('/api/w/{ws}/events');
  });

  it('falls back to the placeholder page when the UI is not built', async () => {
    const { fetch } = app();
    const res = await fetch('/some/spa/route');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('UI has not been built');
  });

  it('501s transcription when no provider is configured', async () => {
    const { fetch } = app();
    const res = await fetch('/api/w/ws1/transcribe', { method: 'POST', headers: authed(), body: 'audio' });
    expect(res.status).toBe(501);
  });

  it('reports chrome dictation and not-configured on a default daemon', async () => {
    const { fetch } = app();
    const res = await fetch('/api/health');
    expect(res.status).toBe(200);
    const body = await res.json() as { transcription: { backend: string; configured: boolean } };
    expect(body.transcription).toEqual({ backend: 'chrome', configured: false });
  });

  // The chat finds the run to stream from this one request, so the envelope is part of the contract.
  it('serves the conductor as a detail envelope carrying its latest run', async () => {
    const { h, fetch } = app();
    const run = { id: 'run_live', agentId: 'ag_conductor', status: 'running' };
    h.impls['runs']!['list'] = () => ({ items: [run], total: 1 });

    const res = await fetch('/api/w/ws1/weaver', { headers: authed() });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.worker).toMatchObject({ id: 'ag_conductor', kind: 'weaver' });
    expect(body.lastRun).toMatchObject({ id: 'run_live', status: 'running' });
    expect(h.calls.some((c) => c.service === 'runs' && c.method === 'list' && (c.args[0] as { agentId?: string })?.agentId === 'ag_conductor')).toBe(true);
  });

  it('serves a null lastRun when the conductor has never run', async () => {
    const { fetch } = app();
    const res = await fetch('/api/w/ws1/weaver', { headers: authed() });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.worker).toMatchObject({ id: 'ag_conductor' });
    expect(body.lastRun).toBeNull();
  });

  // The project the human picked beside the chat input rides on the message; the route only has to
  // forward it, and to let the service's rejection surface as the error it is.
  it('forwards the project a chat message was sent with', async () => {
    const { h, fetch } = app();
    const seen: Array<Record<string, unknown> | undefined> = [];
    h.impls['threads']!['inbound'] = (_a: unknown, _t: unknown, body: string, opts?: Record<string, unknown>) => {
      seen.push(opts);
      return { id: 'tm_1', body, projectId: opts?.['projectId'] ?? null };
    };

    const withProject = await fetch('/api/w/ws1/threads/th_1/messages', {
      method: 'POST', headers: authed({ 'content-type': 'application/json' }), body: JSON.stringify({ body: 'ship it', projectId: 'p_api' }),
    });
    expect(withProject.status).toBe(201);
    expect((await withProject.json()).projectId).toBe('p_api');

    const without = await fetch('/api/w/ws1/threads/th_1/messages', {
      method: 'POST', headers: authed({ 'content-type': 'application/json' }), body: JSON.stringify({ body: 'no project' }),
    });
    expect(without.status).toBe(201);

    expect(seen.map((o) => o?.['projectId'])).toEqual(['p_api', undefined]);
  });

  it('forwards whether a chat message was dictated (VS-657)', async () => {
    const { h, fetch } = app();
    const seen: Array<Record<string, unknown> | undefined> = [];
    h.impls['threads']!['inbound'] = (_a: unknown, _t: unknown, body: string, opts?: Record<string, unknown>) => {
      seen.push(opts);
      return { id: 'tm_1', body };
    };

    const res = await fetch('/api/w/ws1/threads/th_1/messages', {
      method: 'POST', headers: authed({ 'content-type': 'application/json' }), body: JSON.stringify({ body: 'ship it', dictated: true }),
    });
    expect(res.status).toBe(201);
    expect(seen[0]?.['dictated']).toBe(true);
  });

  it('surfaces an unknown project on a chat message as not_found', async () => {
    const { h, fetch } = app();
    h.impls['threads']!['inbound'] = () => { throw new OcError('not_found', 'project nope not found'); };

    const res = await fetch('/api/w/ws1/threads/th_1/messages', {
      method: 'POST', headers: authed({ 'content-type': 'application/json' }), body: JSON.stringify({ body: 'wrong project', projectId: 'nope' }),
    });
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe('not_found');
  });

  // Same shape for the message a reply answers: forwarded verbatim, and the service's thread-scoped
  // rejection is what turns a reference to another thread's message into a 404.
  it('forwards the message a chat reply answers', async () => {
    const { h, fetch } = app();
    const seen: Array<Record<string, unknown> | undefined> = [];
    h.impls['threads']!['inbound'] = (_a: unknown, _t: unknown, body: string, opts?: Record<string, unknown>) => {
      seen.push(opts);
      return { id: 'tm_2', body, replyToMessageId: opts?.['replyToMessageId'] ?? null, replyToExcerpt: opts?.['replyToMessageId'] ? 'the question' : null };
    };

    const asReply = await fetch('/api/w/ws1/threads/th_1/messages', {
      method: 'POST', headers: authed({ 'content-type': 'application/json' }), body: JSON.stringify({ body: 'yes, do it', replyToMessageId: 'tm_asked' }),
    });
    expect(asReply.status).toBe(201);
    await expect(asReply.json()).resolves.toMatchObject({ replyToMessageId: 'tm_asked', replyToExcerpt: 'the question' });

    const plain = await fetch('/api/w/ws1/threads/th_1/messages', {
      method: 'POST', headers: authed({ 'content-type': 'application/json' }), body: JSON.stringify({ body: 'unprompted' }),
    });
    expect(plain.status).toBe(201);

    expect(seen.map((o) => o?.['replyToMessageId'])).toEqual(['tm_asked', undefined]);
  });

  it('surfaces a reply to a message outside the thread as not_found', async () => {
    const { h, fetch } = app();
    h.impls['threads']!['inbound'] = () => { throw new OcError('not_found', 'message tm_elsewhere not found in thread th_1'); };

    const res = await fetch('/api/w/ws1/threads/th_1/messages', {
      method: 'POST', headers: authed({ 'content-type': 'application/json' }), body: JSON.stringify({ body: 'crossing over', replyToMessageId: 'tm_elsewhere' }),
    });
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe('not_found');
  });
});

describe('usage accounts', () => {
  const snapshot = {
    workspaceId: 'ws1', runtimeId: 'claude', billingType: 'subscription_included' as const, planLabel: 'max',
    limitsAvailable: true,
    limits: [{ kind: 'session' as const, label: 'Session', utilization: 42, resetsAt: '2026-09-05T18:09:59.000Z', scopeLabel: null }],
    note: null, capturedAt: '2026-09-05T17:00:00.000Z',
  };

  it('serves the snapshots with their windows and capture time', async () => {
    const { fetch } = app({ accounts: [snapshot] });
    const res = await fetch('/api/w/ws1/usage/accounts', { headers: authed() });
    expect(res.status).toBe(200);
    const body = await res.json() as Array<Record<string, unknown>>;
    expect(body).toHaveLength(1);
    expect(body[0]).toMatchObject({ runtimeId: 'claude', billingType: 'subscription_included', planLabel: 'max', limitsAvailable: true, capturedAt: '2026-09-05T17:00:00.000Z' });
    expect(body[0]?.['limits']).toEqual(snapshot.limits);
  });

  it('falls back to the runtime id when no adapter is registered for a display name', async () => {
    const { fetch } = app({ accounts: [snapshot] });
    const body = await (await fetch('/api/w/ws1/usage/accounts', { headers: authed() })).json() as Array<Record<string, unknown>>;
    expect(body[0]?.['displayName']).toBe('claude');
  });

  it('returns an empty list when nothing has been probed yet', async () => {
    const { fetch } = app();
    expect(await (await fetch('/api/w/ws1/usage/accounts', { headers: authed() })).json()).toEqual([]);
  });

  it('is session-gated like the rest of the usage routes', async () => {
    const { fetch } = app({ accounts: [snapshot] });
    expect((await fetch('/api/w/ws1/usage/accounts')).status).toBe(401);
  });

  /** The on-demand sync (VS-84). The window itself is the accounts service's; this is the surface. */
  describe('syncing on demand', () => {
    const sync = (fetch: (p: string, i?: RequestInit) => Promise<Response>, body?: Record<string, unknown>) =>
      fetch('/api/w/ws1/usage/accounts/refresh', {
        method: 'POST', headers: authed({ 'content-type': 'application/json' }), body: JSON.stringify(body ?? {}),
      });

    it('syncs the named runtime and answers with its snapshot and what happened', async () => {
      const { h, fetch } = app({ accounts: [snapshot] });
      const res = await sync(fetch, { runtimeId: 'claude' });
      expect(res.status).toBe(200);

      const out = await res.json() as Record<string, unknown>;
      expect(out['synced']).toEqual(['claude']);
      expect(out['throttled']).toEqual([]);
      expect(out['failed']).toEqual([]);
      expect(out['accounts']).toHaveLength(1);
      expect((out['accounts'] as Array<Record<string, unknown>>)[0]).toMatchObject({ runtimeId: 'claude', displayName: 'claude', capturedAt: '2026-09-05T17:00:00.000Z' });
      expect(h.calls.filter((c) => c.method === 'sync').map((c) => c.args)).toEqual([[['claude']]]);
    });

    it('syncs every runtime the workspace spends on when the body names none', async () => {
      const { h, fetch } = app({ accounts: [snapshot] });
      await sync(fetch);
      expect(h.calls.filter((c) => c.method === 'sync').map((c) => c.args)).toEqual([[undefined]]);
    });

    // The point of the rate limit's shape: too soon is a fact the caller has to render, not a
    // failure. The snapshot still comes back so the block on screen keeps its numbers.
    it('answers a sync inside the rate limit window with the snapshot and the wait, not an error', async () => {
      const { fetch } = app({ accounts: [snapshot] });
      await sync(fetch, { runtimeId: 'claude' });

      const res = await sync(fetch, { runtimeId: 'claude' });
      expect(res.status).toBe(200);
      const out = await res.json() as Record<string, unknown>;
      expect(out['synced']).toEqual([]);
      expect(out['throttled']).toEqual([{ runtimeId: 'claude', nextSyncAt: '2026-09-07T10:00:30.000Z', retryAfterMs: 30_000 }]);
      expect(out['accounts']).toHaveLength(1);
    });

    it('reports a probe that failed rather than letting the old numbers read as fresh', async () => {
      const { fetch } = app({ accounts: [snapshot], syncFailed: [{ runtimeId: 'claude', message: 'the CLI is not logged in' }] });
      const out = await (await sync(fetch, { runtimeId: 'claude' })).json() as Record<string, unknown>;
      expect(out['failed']).toEqual([{ runtimeId: 'claude', message: 'the CLI is not logged in' }]);
    });

    it('is session-gated', async () => {
      const { fetch } = app({ accounts: [snapshot] });
      expect((await fetch('/api/w/ws1/usage/accounts/refresh', { method: 'POST' })).status).toBe(401);
    });
  });
});

/**
 * The credential state surface (VS-75, runtime-credentials/credential-visibility). The hard rule
 * this pins: the response says everything about the credential except what it is.
 */
describe('usage credentials', () => {
  const valid = {
    workspaceId: 'ws1', runtimeId: 'claude', present: true, expiresAt: '2026-09-08T10:00:00.000Z',
    lastVerifiedAt: '2026-09-07T09:00:00.000Z', refreshFailedAt: null, needsLogin: false, detail: null,
    updatedAt: '2026-09-07T09:00:00.000Z',
  };
  const expired = {
    ...valid, needsLogin: true, refreshFailedAt: '2026-09-07T09:07:00.000Z',
    detail: 'OAuth session expired and could not be refreshed', lastVerifiedAt: '2026-09-07T08:00:00.000Z',
  };

  it('serves a valid credential with its expiry and last verification', async () => {
    const { fetch } = app({ credentials: [valid] });
    const res = await fetch('/api/w/ws1/usage/credentials', { headers: authed() });
    expect(res.status).toBe(200);
    const body = await res.json() as Array<Record<string, unknown>>;
    expect(body).toHaveLength(1);
    expect(body[0]).toMatchObject({
      runtimeId: 'claude', present: true, expiresAt: '2026-09-08T10:00:00.000Z',
      lastVerifiedAt: '2026-09-07T09:00:00.000Z', refreshFailedAt: null, needsLogin: false,
    });
  });

  it('serves an expired login with when the refresh failed', async () => {
    const { fetch } = app({ credentials: [expired] });
    const body = await (await fetch('/api/w/ws1/usage/credentials', { headers: authed() })).json() as Array<Record<string, unknown>>;
    expect(body[0]).toMatchObject({ needsLogin: true, refreshFailedAt: '2026-09-07T09:07:00.000Z' });
    expect(body[0]?.['detail']).toContain('expired');
  });

  it('carries no token-shaped field at all', async () => {
    const { fetch } = app({ credentials: [expired] });
    const raw = await (await fetch('/api/w/ws1/usage/credentials', { headers: authed() })).text();
    for (const forbidden of ['accessToken', 'refreshToken', 'sk-ant', 'claudeAiOauth', 'token']) {
      expect(raw).not.toContain(forbidden);
    }
  });

  it('returns an empty list when nothing is recorded', async () => {
    const { fetch } = app();
    expect(await (await fetch('/api/w/ws1/usage/credentials', { headers: authed() })).json()).toEqual([]);
  });

  it('is session-gated like the rest of the usage routes', async () => {
    const { fetch } = app({ credentials: [valid] });
    expect((await fetch('/api/w/ws1/usage/credentials')).status).toBe(401);
  });
});

describe('presentation', () => {
  it('returns the stored config, not a surface pick-list (VS-50)', async () => {
    const { fetch } = app();
    const res = await fetch('/api/w/ws1/presentation', { headers: authed() });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ default: 'headless' });
  });

  it('lists the surface kinds this daemon has adapters for, without a detection flag', async () => {
    const { h, fetch } = app();
    for (const kind of ['headless', 'tmux']) {
      h.deps.registries.surfaces.set(kind, { kind } as never);
    }
    const res = await fetch('/api/w/ws1/presentation/surfaces', { headers: authed() });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ surfaces: ['headless', 'tmux'] });
  });

  it('replaces the config on PUT and announces it', async () => {
    const { h, fetch } = app();
    const res = await fetch('/api/w/ws1/presentation', {
      method: 'PUT', headers: authed({ 'content-type': 'application/json' }),
      body: JSON.stringify({ default: 'tmux', workers: { surface: 'tmux', session: 'ac' } }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ default: 'tmux', workers: { surface: 'tmux', session: 'ac' } });
    expect(h.bus.since(0).filter((e) => e.type === 'presentation.updated')).toHaveLength(1);
  });

  it('is session-gated', async () => {
    const { fetch } = app();
    expect((await fetch('/api/w/ws1/presentation')).status).toBe(401);
    expect((await fetch('/api/w/ws1/presentation/surfaces')).status).toBe(401);
  });
});

describe('the workspace list', () => {
  /** The sidebar shows every workspace at once, so the count travels with the list. */
  const addDecision = (h: Harness, id: string, over: { owner?: string; status?: string } = {}): void => {
    h.db.run(
      "INSERT INTO decisions (id, workspace_id, ticket_id, kind, owner, title, status, created_at) VALUES (?,?,?,?,?,?,?,?)",
      [id, 'ws1', null, 'question', over.owner ?? 'human', 'Needs a decision', over.status ?? 'open', '2026-09-01T00:00:00.000Z'],
    );
  };

  it('reports how many open decisions are waiting on the human', async () => {
    const { h, fetch } = app();
    addDecision(h, 'd_1');
    addDecision(h, 'd_2');
    addDecision(h, 'd_3', { status: 'answered' });
    addDecision(h, 'd_4', { owner: 'weaver' });

    const body = await (await fetch('/api/workspaces', { headers: authed() })).json() as Array<Record<string, unknown>>;
    expect(body).toHaveLength(1);
    expect(body[0]).toMatchObject({ id: 'ws1', name: 'Test workspace', ticketPrefix: 'ACME', needsYou: 2 });
  });

  it('reports zero rather than omitting the count', async () => {
    const { fetch } = app();
    const body = await (await fetch('/api/workspaces', { headers: authed() })).json() as Array<Record<string, unknown>>;
    expect(body[0]).toHaveProperty('needsYou', 0);
  });
});

describe("a project's commit history (VS-96)", () => {
  const repos: string[] = [];
  afterEach(() => { while (repos.length) rmSync(repos.pop()!, { recursive: true, force: true }); });

  function repo(): string {
    const dir = mkdtempSync(join(tmpdir(), 'ac-history-'));
    repos.push(dir);
    execFileSync('git', ['init', '-b', 'main'], { cwd: dir });
    execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir });
    return dir;
  }
  function commit(dir: string, file: string, content: string, message: string): string {
    writeFileSync(join(dir, file), content, 'utf8');
    execFileSync('git', ['add', '.'], { cwd: dir });
    execFileSync('git', ['commit', '-m', message], { cwd: dir });
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir }).toString().trim();
  }
  function insertProject(h: Harness, clonePath: string, gitUrl = 'https://github.com/acme/api.git'): void {
    h.db.run(
      "INSERT INTO projects (id, workspace_id, slug, name, git_url, default_branch, clone_path, max_workers, worktree_provider, openspec_enabled, policies_json, status, created_at, updated_at) VALUES ('proj1','ws1','api','API',?,'main',?,4,'git',1,'{}','ready','t0','t0')",
      [gitUrl, clonePath],
    );
  }

  it('serves a first page newest-first and pages on with a cursor', async () => {
    const { h, fetch } = app();
    const dir = repo();
    commit(dir, 'a.txt', '1', 'first');
    commit(dir, 'a.txt', '2', 'second');
    commit(dir, 'a.txt', '3', 'third');
    insertProject(h, dir);

    const res1 = await fetch('/api/w/ws1/projects/proj1/history?limit=2', { headers: authed() });
    expect(res1.status).toBe(200);
    const page1 = await res1.json();
    expect(page1.commits.map((c: { subject: string }) => c.subject)).toEqual(['third', 'second']);
    expect(page1.cursor).toBeTruthy();
    expect(page1.refs).toEqual([expect.objectContaining({ name: 'main', isDefault: true })]);

    const res2 = await fetch(`/api/w/ws1/projects/proj1/history?limit=2&cursor=${encodeURIComponent(page1.cursor)}`, { headers: authed() });
    const page2 = await res2.json();
    expect(page2.commits.map((c: { subject: string }) => c.subject)).toEqual(['first']);
    expect(page2.cursor).toBeNull();
  });

  it('clamps a non-positive or non-integer limit to a validation error', async () => {
    const { h, fetch } = app();
    insertProject(h, repo());
    const res = await fetch('/api/w/ws1/projects/proj1/history?limit=0', { headers: authed() });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('validation');
  });

  it('404s an unknown project', async () => {
    const { fetch } = app();
    const res = await fetch('/api/w/ws1/projects/nope/history', { headers: authed() });
    expect(res.status).toBe(404);
  });

  it('refuses a commit id that is not a plain object name', async () => {
    const { h, fetch } = app();
    insertProject(h, repo());
    const res = await fetch('/api/w/ws1/projects/proj1/commits/not-a-sha!!', { headers: authed() });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('validation');
  });

  it("serves a commit's full detail with its changed files", async () => {
    const { h, fetch } = app();
    const dir = repo();
    commit(dir, 'a.txt', '1', 'first');
    const sha = commit(dir, 'a.txt', '2', 'second commit');
    insertProject(h, dir);

    const res = await fetch(`/api/w/ws1/projects/proj1/commits/${sha}`, { headers: authed() });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.message).toContain('second commit');
    expect(body.files).toEqual([expect.objectContaining({ path: 'a.txt', status: 'modified' })]);
    expect(body.forgeUrl).toBe(`https://github.com/acme/api/commit/${sha}`);
  });

  it('answers not found for an unknown commit', async () => {
    const { h, fetch } = app();
    const dir = repo();
    commit(dir, 'a.txt', '1', 'first');
    insertProject(h, dir);
    const res = await fetch('/api/w/ws1/projects/proj1/commits/deadbeef1234', { headers: authed() });
    expect(res.status).toBe(404);
  });
});

describe("a pull request's diff (VS-107)", () => {
  const repos: string[] = [];
  afterEach(() => { while (repos.length) rmSync(repos.pop()!, { recursive: true, force: true }); });

  function repo(): string {
    const dir = mkdtempSync(join(tmpdir(), 'ac-diff-'));
    repos.push(dir);
    execFileSync('git', ['init', '-b', 'main'], { cwd: dir });
    execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir });
    return dir;
  }
  function commit(dir: string, file: string, content: string, message: string): void {
    writeFileSync(join(dir, file), content, 'utf8');
    execFileSync('git', ['add', '.'], { cwd: dir });
    execFileSync('git', ['commit', '-m', message], { cwd: dir });
  }
  function insertProject(h: Harness, clonePath: string): void {
    h.db.run(
      "INSERT INTO projects (id, workspace_id, slug, name, git_url, default_branch, clone_path, max_workers, worktree_provider, openspec_enabled, policies_json, status, created_at, updated_at) VALUES ('proj1','ws1','api','API','https://github.com/acme/api.git','main',?,4,'git',1,'{}','ready','t0','t0')",
      [clonePath],
    );
  }
  const PR = {
    number: 12, title: 'Add dark mode', url: 'https://github.com/acme/api/pull/12', author: 'victornor',
    state: 'open' as const, isDraft: false, headRefName: 'ac/acme-42-add-dark-mode', baseRefName: 'main',
    createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T01:00:00.000Z', mergedAt: null, closedAt: null,
    additions: 1, deletions: 1, changedFiles: 1, checks: 'success' as const, reviewDecision: null, mergeCommit: null,
  };
  const DIFF = 'diff --git a/a.ts b/a.ts\nindex 1..2 100644\n--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-old\n+new';

  it('serves the manifest and one file from a fixture forge', async () => {
    const { h, fetch } = app();
    insertProject(h, repo());
    h.runtime.ctx.registries.forges.set('github', {
      id: 'github', detect: async () => true, prState: async () => ({ state: 'open' as const }), mergePr: async () => ({}),
      listPullRequests: async () => [PR], pullRequest: async () => null,
      pullRequestDiff: async () => DIFF,
    });

    const manifest = await fetch('/api/w/ws1/projects/proj1/pull-requests/12/diff', { headers: authed() });
    expect(manifest.status).toBe(200);
    await expect(manifest.json()).resolves.toMatchObject({ available: true, files: [{ path: 'a.ts', status: 'modified' }] });

    const file = await fetch('/api/w/ws1/projects/proj1/pull-requests/12/diff/file?path=a.ts', { headers: authed() });
    expect(file.status).toBe(200);
    const body = await file.json();
    expect(body.file.hunks).toHaveLength(1);
  });

  it('falls back to the clone when there is no forge, for a pull request from a local branch', async () => {
    const { h, fetch } = app();
    const dir = repo();
    commit(dir, 'a.ts', 'one\n', 'first');
    execFileSync('git', ['checkout', '-b', 'ac/acme-42-add-dark-mode'], { cwd: dir });
    commit(dir, 'a.ts', 'two\n', 'change');
    execFileSync('git', ['checkout', 'main'], { cwd: dir });
    insertProject(h, dir);
    h.runtime.ctx.registries.forges.set('github', {
      id: 'github', detect: async () => true, prState: async () => ({ state: 'open' as const }), mergePr: async () => ({}),
      listPullRequests: async () => [PR], pullRequest: async () => null,
    });

    const res = await fetch('/api/w/ws1/projects/proj1/pull-requests/12/diff', { headers: authed() });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ available: true, files: [{ path: 'a.ts' }] });
  });

  it('answers 200 with no_local_branch when neither the forge nor the clone can answer', async () => {
    const { h, fetch } = app();
    insertProject(h, repo());
    h.runtime.ctx.registries.forges.set('github', {
      id: 'github', detect: async () => true, prState: async () => ({ state: 'open' as const }), mergePr: async () => ({}),
      listPullRequests: async () => [PR], pullRequest: async () => null,
    });

    const res = await fetch('/api/w/ws1/projects/proj1/pull-requests/12/diff', { headers: authed() });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ available: false, reason: 'no_local_branch' });
  });

  it('reads a collapsed region from the base revision', async () => {
    const { h, fetch } = app();
    const dir = repo();
    commit(dir, 'a.ts', ['one', 'two', 'three', ''].join('\n'), 'first');
    insertProject(h, dir);
    h.runtime.ctx.registries.forges.set('github', {
      id: 'github', detect: async () => true, prState: async () => ({ state: 'open' as const }), mergePr: async () => ({}),
      listPullRequests: async () => [PR], pullRequest: async () => null, pullRequestDiff: async () => DIFF,
    });

    const res = await fetch('/api/w/ws1/projects/proj1/pull-requests/12/diff/file/context?path=a.ts&start=1&end=2', { headers: authed() });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ available: true, lines: ['one', 'two'] });
  });

  it('rejects a diff/file request with no path', async () => {
    const { h, fetch } = app();
    insertProject(h, repo());
    const res = await fetch('/api/w/ws1/projects/proj1/pull-requests/12/diff/file', { headers: authed() });
    expect(res.status).toBe(400);
  });
});

describe("a project's sync state (VS-131)", () => {
  it('answers the read-only check without touching the mutating fetch path', async () => {
    const { h, fetch } = app();
    h.impls.projects!.checkSync = async (id: string) => { expect(id).toBe('proj1'); return { syncState: 'behind' as const, behindBy: 3 }; };
    h.impls.projects!.fetch = async () => { throw new Error('GET /sync must never call the mutating fetch'); };

    const res = await fetch('/api/w/ws1/projects/proj1/sync', { headers: authed() });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ syncState: 'behind', behindBy: 3 });
  });

  it('reports diverged the same way, with no behindBy count', async () => {
    const { fetch } = app();
    const res = await fetch('/api/w/ws1/projects/proj1/sync', { headers: authed() });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ syncState: 'in_sync', behindBy: null });
  });

  it('still runs the mutating fetch through POST /projects/:id/fetch', async () => {
    const { h, fetch } = app();
    let called = false;
    h.impls.projects!.fetch = async (id: string) => { called = true; expect(id).toBe('proj1'); return { head: 'abc123', fastForwarded: true }; };

    const res = await fetch('/api/w/ws1/projects/proj1/fetch', { method: 'POST', headers: authed() });
    expect(res.status).toBe(200);
    expect(called).toBe(true);
    await expect(res.json()).resolves.toEqual({ head: 'abc123', fastForwarded: true });
  });
});

describe('daemon transcription (VS-179)', () => {
  const installed = {
    installed: true,
    models: [
      { id: 'tiny.en', engine: 'whisper', installed: true },
      { id: 'base.en', engine: 'whisper', installed: true },
    ],
  };
  const probe = (over: { installed?: boolean; text?: string; error?: string } = {}) => ({
    status: async () => ({
      installed: over.installed ?? true,
      models: over.installed === false ? [] : installed.models,
      error: over.error,
    }),
    transcribe: async (_audio: Buffer, model: string | undefined) => over.text ?? `said:${model ?? ''}`,
  });

  it('GETs chrome by default', async () => {
    const { fetch } = app({ voxtype: probe({ installed: false }) });
    const res = await fetch('/api/daemon/transcription', { headers: authed() });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ backend: 'chrome', model: null, voxtype: { installed: false } });
  });

  it('PUTs voxtype + model, persists, and transcribe uses it without rebuilding deps', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ac-tx-'));
    writeFileSync(join(dir, 'daemon.yaml'), 'version: 1\n');
    const { h, fetch } = app({ voxtype: probe({ text: 'hello host' }), daemonConfigDir: dir });
    const put = await fetch('/api/daemon/transcription', {
      method: 'PUT', headers: { ...authed(), 'content-type': 'application/json' },
      body: JSON.stringify({ backend: 'voxtype', model: 'base.en' }),
    });
    expect(put.status).toBe(200);
    await expect(put.json()).resolves.toMatchObject({ backend: 'voxtype', model: 'base.en' });
    expect(h.deps.daemon.transcription.backend).toBe('voxtype');

    const got = await fetch('/api/daemon/transcription', { headers: authed() });
    await expect(got.json()).resolves.toMatchObject({ backend: 'voxtype', model: 'base.en' });

    const tx = await fetch('/api/transcribe', { method: 'POST', headers: authed(), body: 'RIFF' });
    expect(tx.status).toBe(200);
    await expect(tx.json()).resolves.toEqual({ text: 'hello host' });
    rmSync(dir, { recursive: true, force: true });
  });

  it('rejects PUT voxtype when the binary is missing', async () => {
    const { fetch } = app({ voxtype: probe({ installed: false, error: 'voxtype is not installed' }) });
    const res = await fetch('/api/daemon/transcription', {
      method: 'PUT', headers: { ...authed(), 'content-type': 'application/json' },
      body: JSON.stringify({ backend: 'voxtype' }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('validation');
  });

  it('rejects an uninstalled model', async () => {
    const { fetch } = app({ voxtype: probe() });
    const res = await fetch('/api/daemon/transcription', {
      method: 'PUT', headers: { ...authed(), 'content-type': 'application/json' },
      body: JSON.stringify({ backend: 'voxtype', model: 'large-v3' }),
    });
    expect(res.status).toBe(400);
  });

  it('allows PUT chrome when Voxtype is missing', async () => {
    const { fetch } = app({ voxtype: probe({ installed: false }) });
    const res = await fetch('/api/daemon/transcription', {
      method: 'PUT', headers: { ...authed(), 'content-type': 'application/json' },
      body: JSON.stringify({ backend: 'chrome' }),
    });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ backend: 'chrome' });
  });

  it('errors when Voxtype transcription throws', async () => {
    const { fetch } = app({
      daemon: { transcription: { backend: 'voxtype' } },
      voxtype: {
        status: async () => ({ installed: true, models: [{ id: 'base.en', engine: 'whisper', installed: true }] }),
        transcribe: async () => { throw new OcError('internal', 'voxtype timed out after 200ms'); },
      },
    });
    const res = await fetch('/api/transcribe', { method: 'POST', headers: authed(), body: 'RIFF' });
    expect(res.status).toBe(500);
    expect((await res.json()).error.message).toMatch(/timed out/);
  });

  it('still transcribes through the yaml command provider', async () => {
    const { fetch } = app({ daemon: { transcription: { provider: 'command', command: 'printf transcribed' } } });
    const res = await fetch('/api/transcribe', { method: 'POST', headers: authed(), body: 'audio' });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ text: 'transcribed' });
  });

  it('survives a provider that exits without reading stdin (VS-329)', async () => {
    // `true` never drains its stdin, so the large write below closes against a dead pipe and
    // raises EPIPE. It must be absorbed, not surface as an unhandled stream error that fails
    // the whole suite (which is how GitHub's runner caught this).
    const { fetch } = app({ daemon: { transcription: { provider: 'command', command: 'true' } } });
    const res = await fetch('/api/transcribe', { method: 'POST', headers: authed(), body: new Uint8Array(1024 * 1024) });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ text: '' });
  });
});

describe('daemon model overlays (VS-185)', () => {
  it('GETs empty overlays by default', async () => {
    const { fetch } = app();
    const res = await fetch('/api/daemon/models', { headers: authed() });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ weaver: null, workers: null, workerOptions: null });
  });

  it('PUTs conductor, persists, and GET /models reflects it as the workspace default (VS-284)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ac-dm-'));
    writeFileSync(join(dir, 'daemon.yaml'), 'version: 1\n');
    const { h, fetch } = app({ daemonConfigDir: dir });
    const setting = { runtime: 'claude', model: 'claude-fable-5-1' };
    const put = await fetch('/api/daemon/models', {
      method: 'PUT', headers: { ...authed(), 'content-type': 'application/json' },
      body: JSON.stringify({ weaver: setting }),
    });
    expect(put.status).toBe(200);
    await expect(put.json()).resolves.toEqual({ weaver: setting, workers: null, workerOptions: null });
    expect(h.deps.daemon.models.weaver).toEqual(setting);

    const got = await fetch('/api/daemon/models', { headers: authed() });
    await expect(got.json()).resolves.toEqual({ weaver: setting, workers: null, workerOptions: null });

    const ws = await fetch('/api/w/ws1/models', { headers: authed() });
    // The workspace has not configured its own conductor, so the daemon overlay governs.
    await expect(ws.json()).resolves.toMatchObject({ weaver: setting });
    rmSync(dir, { recursive: true, force: true });
  });

  it('omitted keys leave the other overlay; null clears', async () => {
    const { fetch } = app();
    await fetch('/api/daemon/models', {
      method: 'PUT', headers: { ...authed(), 'content-type': 'application/json' },
      body: JSON.stringify({ weaver: { runtime: 'claude', model: 'a' }, workers: { runtime: 'codex', model: 'b' } }),
    });
    const left = await fetch('/api/daemon/models', {
      method: 'PUT', headers: { ...authed(), 'content-type': 'application/json' },
      body: JSON.stringify({ weaver: null }),
    });
    await expect(left.json()).resolves.toEqual({
      weaver: null,
      workers: { runtime: 'codex', model: 'b' },
      workerOptions: null,
    });
  });

  it('treats workerOptions [] as no overlay and rejects a duplicate id', async () => {
    const { fetch } = app();
    const cheap = { id: 'cheap', description: 'Scouts.', runtime: 'opencode', model: 'glm-4.6' };
    await fetch('/api/daemon/models', {
      method: 'PUT', headers: { ...authed(), 'content-type': 'application/json' },
      body: JSON.stringify({ workerOptions: [cheap] }),
    });
    const cleared = await fetch('/api/daemon/models', {
      method: 'PUT', headers: { ...authed(), 'content-type': 'application/json' },
      body: JSON.stringify({ workerOptions: [] }),
    });
    await expect(cleared.json()).resolves.toMatchObject({ workerOptions: null });
    const dup = await fetch('/api/daemon/models', {
      method: 'PUT', headers: { ...authed(), 'content-type': 'application/json' },
      body: JSON.stringify({ workerOptions: [cheap, { ...cheap, description: 'b' }] }),
    });
    expect(dup.status).toBe(400);
  });

  it('round-trips worker options with runtime null and persists a later adapter (VS-236)', async () => {
    const { h, fetch } = app();
    h.deps.registries.runtimes.set('claude', Object.assign(new FakeRuntime(), { id: 'claude' }));
    const tiers = [
      { id: 'quick', description: 'Fastest.', runtime: null, model: null },
      { id: 'standard', description: 'Default for specified work.', runtime: null, model: null },
      { id: 'deep', description: 'Cause unknown.', runtime: null, model: null },
    ];
    const put = await fetch('/api/daemon/models', {
      method: 'PUT', headers: { ...authed(), 'content-type': 'application/json' },
      body: JSON.stringify({ workerOptions: tiers }),
    });
    expect(put.status).toBe(200);
    await expect(put.json()).resolves.toMatchObject({ workerOptions: tiers });
    const got = await fetch('/api/daemon/models', { headers: authed() });
    await expect(got.json()).resolves.toMatchObject({ workerOptions: tiers });

    const configured = { id: 'quick', description: 'Fastest.', runtime: 'claude', model: null };
    const next = await fetch('/api/daemon/models', {
      method: 'PUT', headers: { ...authed(), 'content-type': 'application/json' },
      body: JSON.stringify({ workerOptions: [configured, tiers[1], tiers[2]] }),
    });
    expect(next.status).toBe(200);
    await expect(next.json()).resolves.toMatchObject({
      workerOptions: [configured, tiers[1], tiers[2]],
    });
  });

  it('rejects an unknown option runtime and keeps the previous overlay', async () => {
    const { h, fetch } = app();
    h.deps.registries.runtimes.set('claude', Object.assign(new FakeRuntime(), { id: 'claude' }));
    const original = { id: 'deep', description: 'Hard tickets.', runtime: 'claude', model: 'opus' };
    const first = await fetch('/api/daemon/models', {
      method: 'PUT', headers: { ...authed(), 'content-type': 'application/json' },
      body: JSON.stringify({ workerOptions: [original] }),
    });
    expect(first.status).toBe(200);
    const rejected = await fetch('/api/daemon/models', {
      method: 'PUT', headers: { ...authed(), 'content-type': 'application/json' },
      body: JSON.stringify({ workerOptions: [{ ...original, runtime: 'missing', model: 'new-model' }] }),
    });
    expect(rejected.status).toBe(400);
    await expect(rejected.json()).resolves.toMatchObject({ error: { code: 'validation', message: expect.stringContaining("runtime 'missing'") } });
    const got = await fetch('/api/daemon/models', { headers: authed() });
    await expect(got.json()).resolves.toMatchObject({ workerOptions: [original] });
  });
});

describe('daemon host tools (VS-318)', () => {
  it('GETs the detected tools and the configured directories', async () => {
    const { fetch } = app();
    const res = await fetch('/api/daemon/host-tools', { headers: authed() });
    expect(res.status).toBe(200);
    const body = await res.json() as { paths: string[]; tools: Array<{ id: string; available: boolean; path: string | null }> };
    expect(body.paths).toEqual([]);
    expect(body.tools.map((t) => t.id).sort()).toEqual(['gh', 'git', 'openspec', 'wt']);
    expect(body.tools.every((t) => typeof t.available === 'boolean')).toBe(true);
  });

  it('persists a host tool directory and detects a tool found only there, without a restart', async () => {
    const configDir = mkdtempSync(join(tmpdir(), 'ac-ht-cfg-'));
    const toolDir = mkdtempSync(join(tmpdir(), 'ac-ht-bin-'));
    writeFileSync(join(configDir, 'daemon.yaml'), 'version: 1\n');
    writeFileSync(join(toolDir, 'openspec'), '#!/bin/sh\necho 1.12.0\n', { mode: 0o755 });
    const { h, fetch } = app({ daemonConfigDir: configDir });
    const original = process.env['PATH'];
    process.env['PATH'] = '/nonexistent-a:/nonexistent-b';
    try {
      const put = await fetch('/api/daemon/host-tools', {
        method: 'PUT', headers: { ...authed(), 'content-type': 'application/json' },
        body: JSON.stringify({ paths: [toolDir] }),
      });
      expect(put.status).toBe(200);
      expect(h.deps.daemon.hostToolPaths).toEqual([toolDir]);
      const body = await put.json() as { paths: string[]; tools: Array<{ id: string; available: boolean; path: string | null }> };
      expect(body.paths).toEqual([toolDir]);
      const openspec = body.tools.find((t) => t.id === 'openspec');
      expect(openspec?.available).toBe(true);
      expect(openspec?.path).toBe(join(toolDir, 'openspec'));
    } finally {
      process.env['PATH'] = original;
      clearHostToolCache();
      rmSync(configDir, { recursive: true, force: true });
      rmSync(toolDir, { recursive: true, force: true });
    }
  });

  it('rejects a relative host tool path and accepts an absolute one', async () => {
    const { h, fetch } = app();
    const original = process.env['PATH'];
    try {
      const bad = await fetch('/api/daemon/host-tools', {
        method: 'PUT', headers: { ...authed(), 'content-type': 'application/json' },
        body: JSON.stringify({ paths: ['bin'] }),
      });
      expect(bad.status).toBe(400);
      const badBody = await bad.json() as { error: { code: string } };
      expect(badBody.error.code).toBe('validation');

      const good = await fetch('/api/daemon/host-tools', {
        method: 'PUT', headers: { ...authed(), 'content-type': 'application/json' },
        body: JSON.stringify({ paths: ['/opt/tools/bin'] }),
      });
      expect(good.status).toBe(200);
      expect(h.deps.daemon.hostToolPaths).toEqual(['/opt/tools/bin']);
    } finally {
      process.env['PATH'] = original;
      clearHostToolCache();
    }
  });
});

describe('a run\'s events (VS-332)', () => {
  it('serves the newest window for tail and the head page for after/limit', async () => {
    const { h, fetch } = app();
    const calls: Array<{ method: string; arg: number | undefined }> = [];
    h.impls.runs.events = (_id: string, after?: number) => { calls.push({ method: 'events', arg: after }); return [{ seq: 1 }]; };
    h.impls.runs.tail = (_id: string, limit?: number) => { calls.push({ method: 'tail', arg: limit }); return [{ seq: 900 }, { seq: 901 }]; };

    const tailed = await fetch('/api/w/ws1/runs/run_1/events?tail=500', { headers: authed() });
    expect(tailed.status).toBe(200);
    await expect(tailed.json()).resolves.toEqual([{ seq: 900 }, { seq: 901 }]);

    const head = await fetch('/api/w/ws1/runs/run_1/events?after=0&limit=10', { headers: authed() });
    expect(head.status).toBe(200);
    await expect(head.json()).resolves.toEqual([{ seq: 1 }]);

    expect(calls).toEqual([{ method: 'tail', arg: 500 }, { method: 'events', arg: 0 }]);
  });
});
