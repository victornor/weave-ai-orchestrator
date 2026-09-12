import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { authed, makeHarness, type Harness } from './fakes.js';

let harness: Harness | null = null;
afterEach(async () => { await harness?.close(); harness = null; });

const app = () => {
  harness = makeHarness();
  return { fetch: (path: string, init?: RequestInit) => createApp(harness!.deps).fetch(new Request(`http://127.0.0.1:7433${path}`, { headers: authed(), ...init })) };
};

describe('GET /knowledge/health', () => {
  it('answers the workspace view with no project named', async () => {
    const { fetch } = app();
    const res = await fetch('/api/w/ws1/knowledge/health');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.hubs[0]).toMatchObject({ scope: 'workspace' });
    expect(body).toMatchObject({ orphans: [], stale: [], unresolvedLinks: [] });
  });

  it('answers one project\'s view when scoped', async () => {
    const { fetch } = app();
    const res = await fetch('/api/w/ws1/knowledge/health?project=proj1');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.hubs[0]).toMatchObject({ scope: 'project', projectId: 'proj1' });
  });

  it('is registered ahead of the /:scope route so "health" is never read as a scope', async () => {
    const { fetch } = app();
    const res = await fetch('/api/w/ws1/knowledge/health');
    expect(res.status).not.toBe(400);
  });
});

describe('GET /knowledge/artifacts (VS-270)', () => {
  it('passes the optional project through to tickets.artifacts and returns its rows', async () => {
    const { fetch } = app();
    let received: string | null | undefined;
    harness!.impls.tickets!['artifacts'] = (projectId: string | null) => {
      received = projectId;
      return [{ id: 'wp_1', ticketId: 'tk_1', ticketIdentifier: 'ACME-42', ticketTitle: 'Add dark mode', key: 'overview', title: 'Overview', metadata: { kind: 'diagram' }, url: '/api/w/ws1/tickets/tk_1/artifacts/overview/raw', updatedAt: '2026-09-12T00:00:00.000Z' }];
    };
    const res = await fetch('/api/w/ws1/knowledge/artifacts?project=proj1');
    expect(res.status).toBe(200);
    expect(received).toBe('proj1');
    const body = await res.json();
    expect(body).toEqual([{ id: 'wp_1', ticketId: 'tk_1', ticketIdentifier: 'ACME-42', ticketTitle: 'Add dark mode', key: 'overview', title: 'Overview', metadata: { kind: 'diagram' }, url: '/api/w/ws1/tickets/tk_1/artifacts/overview/raw', updatedAt: '2026-09-12T00:00:00.000Z' }]);
  });

  it('passes null when no project is named, matching the sibling /docs and /graph routes', async () => {
    const { fetch } = app();
    let received: string | null | undefined = 'not-called';
    harness!.impls.tickets!['artifacts'] = (projectId: string | null) => { received = projectId; return []; };
    const res = await fetch('/api/w/ws1/knowledge/artifacts');
    expect(res.status).toBe(200);
    expect(received).toBeNull();
  });

  it('is registered ahead of the /:scope route so "artifacts" is never read as a scope', async () => {
    const { fetch } = app();
    const res = await fetch('/api/w/ws1/knowledge/artifacts');
    expect(res.status).not.toBe(400);
  });
});

describe('POST /knowledge/:scope/note', () => {
  it('passes an optional doc slug through to the service', async () => {
    const { fetch } = app();
    harness!.impls.knowledge!['note'] = (_actor: unknown, scope: string, section: string, text: string, projectId: string | null, doc?: string) =>
      ({ remainingTokens: 100, revision: 2, received: { scope, section, text, projectId, doc } });
    const res = await fetch('/api/w/ws1/knowledge/project/note?project=proj1', {
      method: 'POST', body: JSON.stringify({ section: 'Landmines', text: 'A fact.', doc: 'run-engine' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.received).toMatchObject({ scope: 'project', section: 'Landmines', text: 'A fact.', projectId: 'proj1', doc: 'run-engine' });
  });

  it('leaves doc undefined when the caller does not send one', async () => {
    const { fetch } = app();
    harness!.impls.knowledge!['note'] = (_actor: unknown, _scope: string, _section: string, _text: string, _projectId: string | null, doc?: string) =>
      ({ remainingTokens: 100, revision: 2, received: { doc } });
    const res = await fetch('/api/w/ws1/knowledge/project/note?project=proj1', {
      method: 'POST', body: JSON.stringify({ section: 'Learnings', text: 'A fact.' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.received.doc).toBeUndefined();
  });
});
