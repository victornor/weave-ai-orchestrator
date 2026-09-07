/**
 * The changelog routes (PLAN §13.6). The harness's changelog service is the real one over the
 * harness's real db, so these assert on what the route actually serves rather than on a double.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { newId } from '@agent-conductor/db';
import type { ChangelogEntry, ChangelogHeatmap, ChangelogPage } from '@agent-conductor/shared';
import { createApp } from '../src/app.js';
import { authed, makeHarness, type Harness } from './fakes.js';

let harness: Harness | null = null;
afterEach(() => { harness?.close(); harness = null; });

describe('the changelog routes', () => {
  let h: Harness;
  let fetch: (path: string, init?: RequestInit) => Promise<Response>;

  beforeEach(() => {
    harness = makeHarness();
    h = harness;
    fetch = (path, init) => createApp(h.deps).fetch(new Request(`http://127.0.0.1:7433${path}`, init));
    h.db.run("INSERT INTO projects (id, workspace_id, slug, name, git_url, clone_path, created_at, updated_at) VALUES ('p1','ws1','api','API','git@x:a/b.git','/tmp/api','t0','t0')");
    h.db.run("INSERT INTO projects (id, workspace_id, slug, name, git_url, clone_path, created_at, updated_at) VALUES ('p2','ws1','web','Web','git@x:a/w.git','/tmp/web','t0','t0')");
  });

  let n = 0;
  const ticketRow = (projectId: string | null): string => {
    const id = newId();
    n += 1;
    h.db.run(
      'INSERT INTO tickets (id, workspace_id, project_id, number, identifier, kind, title, created_by_kind, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
      [id, 'ws1', projectId, 100 + n, `ACME-${100 + n}`, 'change', `Ticket ${n}`, 'human', 't0', 't0']);
    return id;
  };

  const act = (action: string, at: string, over: { ticketId?: string | null; projectId?: string | null; details?: Record<string, unknown> } = {}): void => {
    h.db.run(
      'INSERT INTO activity (id, workspace_id, actor_kind, actor_id, action, entity_type, entity_id, ticket_id, project_id, details_json, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
      [newId(), 'ws1', 'human', 'victor', action, 'ticket', over.ticketId ?? 'e', over.ticketId ?? null, over.projectId ?? null, JSON.stringify(over.details ?? {}), at]);
  };

  const page = async (path: string): Promise<ChangelogPage> => {
    const res = await fetch(path, { headers: authed() });
    expect(res.status).toBe(200);
    return res.json() as Promise<ChangelogPage>;
  };

  it('serves the workspace changelog newest first', async () => {
    const t = ticketRow('p1');
    act('ticket.create', '2026-09-05T01:00:00.000Z', { ticketId: t, projectId: 'p1', details: { kind: 'change' } });
    act('ticket.delivery_landed', '2026-09-05T03:00:00.000Z', { ticketId: t, projectId: 'p1', details: { mode: 'ff' } });
    act('ticket.checkout', '2026-09-05T02:00:00.000Z', { ticketId: t, projectId: 'p1' });

    const body = await page('/api/w/ws1/changelog');
    expect(body.entries.map((e: ChangelogEntry) => e.kind)).toEqual(['landed', 'filed']);
    expect(body.entries[0]).toMatchObject({ ticketIdentifier: 'ACME-101', link: { kind: 'ticket', target: t } });
    expect(body.nextCursor).toBeNull();
  });

  it('filters to one project', async () => {
    const mine = ticketRow('p1');
    const theirs = ticketRow('p2');
    act('ticket.create', '2026-09-05T01:00:00.000Z', { ticketId: mine, projectId: 'p1' });
    act('ticket.create', '2026-09-05T02:00:00.000Z', { ticketId: theirs, projectId: 'p2' });

    expect((await page('/api/w/ws1/changelog?project=p1')).entries.map((e) => e.ticketId)).toEqual([mine]);
    expect((await page('/api/w/ws1/changelog?project=p2')).entries.map((e) => e.ticketId)).toEqual([theirs]);
    expect((await page('/api/w/ws1/changelog')).entries).toHaveLength(2);
  });

  it('pages through nextCursor without repeating or skipping', async () => {
    const t = ticketRow('p1');
    for (let i = 1; i <= 5; i += 1) act('ticket.create', `2026-09-05T0${i}:00:00.000Z`, { ticketId: t, projectId: 'p1' });

    const seen: string[] = [];
    let path = '/api/w/ws1/changelog?limit=2';
    for (let i = 0; i < 5; i += 1) {
      const body = await page(path);
      seen.push(...body.entries.map((e) => e.id));
      if (!body.nextCursor) break;
      path = `/api/w/ws1/changelog?limit=2&before=${encodeURIComponent(body.nextCursor)}`;
    }
    expect(seen).toHaveLength(5);
    expect(new Set(seen).size).toBe(5);
  });

  it('serves a dense heatmap with the measure it shades', async () => {
    const t = ticketRow('p1');
    act('ticket.delivery_landed', '2026-09-04T09:00:00.000Z', { ticketId: t, projectId: 'p1' });
    act('ticket.delivery_landed', '2026-09-04T15:00:00.000Z', { ticketId: t, projectId: 'p1' });

    const res = await fetch('/api/w/ws1/changelog/heatmap?from=2026-09-03&to=2026-09-05&tz=UTC', { headers: authed() });
    expect(res.status).toBe(200);
    const body = (await res.json()) as ChangelogHeatmap;
    expect(body.days.map((d) => [d.date, d.landed])).toEqual([['2026-09-03', 0], ['2026-09-04', 2], ['2026-09-05', 0]]);
    expect(body.measure).toMatchObject({ kind: 'landed', label: 'Tickets landed' });
    expect(body.timezone).toBe('UTC');
  });

  it('rejects an inverted range and an unknown timezone', async () => {
    const bad = await fetch('/api/w/ws1/changelog/heatmap?from=2026-09-05&to=2026-09-01&tz=UTC', { headers: authed() });
    expect(bad.status).toBe(400);
    expect((await bad.json()).error.code).toBe('validation');

    const tz = await fetch('/api/w/ws1/changelog/heatmap?tz=Mars/Olympus', { headers: authed() });
    expect(tz.status).toBe(400);
  });

  // The record is append-only: the guarantee is that there is nothing to call.
  it('routes no method that could change an entry', async () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      for (const path of ['/api/w/ws1/changelog', '/api/w/ws1/changelog/heatmap']) {
        const res = await fetch(path, { method, headers: { ...authed(), origin: 'http://127.0.0.1:7433', 'content-type': 'application/json' }, body: '{}' });
        expect(res.status, `${method} ${path}`).toBe(404);
      }
    }
  });

  it('404s a project the workspace does not have, rather than serving an empty changelog', async () => {
    const res = await fetch('/api/w/ws1/changelog?project=nope', { headers: authed() });
    expect(res.status).toBe(404);
    const err = (await res.json()).error;
    expect(err.code).toBe('not_found');
    expect(err.message).toContain('nope');
  });

  it('needs authentication like every other workspace route', async () => {
    expect((await fetch('/api/w/ws1/changelog')).status).toBe(401);
  });
});
