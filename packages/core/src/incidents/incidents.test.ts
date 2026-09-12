import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { newId, openDb, type Db } from '@agent-conductor/db';
import { OcError } from '@agent-conductor/shared';
import { createIncidentsService } from './index.js';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function service() {
  const dir = mkdtempSync(join(tmpdir(), 'ac-incidents-'));
  dirs.push(dir);
  const db = openDb(join(dir, 'daemon.sqlite'));
  return { db, incidents: createIncidentsService(db), close: () => db.close() };
}

const base = {
  title: 'MCP call failed',
  whatFailed: 'ac_ticket_get returned not_found for a ticket that exists',
  tryingToDo: 'read the bound ticket before commenting',
  agentId: 'ag1',
  runId: 'run1',
  workspaceId: 'ws1',
};

describe('IncidentsService', () => {
  it('stores a worker incident and a conductor incident separately', () => {
    const { incidents, close } = service();
    const worker = incidents.create({ ...base, reporterKind: 'worker' });
    const conductor = incidents.create({ ...base, reporterKind: 'weaver', title: 'Cannot spawn' });
    expect(worker.reporterKind).toBe('worker');
    expect(conductor.reporterKind).toBe('weaver');
    expect(incidents.list().items.map((i) => i.id)).toEqual([conductor.id, worker.id]);
    close();
  });

  it('rejects empty title, whatFailed and tryingToDo', () => {
    const { incidents, close } = service();
    expect(() => incidents.create({ ...base, reporterKind: 'worker', title: '  ' })).toThrow(OcError);
    expect(() => incidents.create({ ...base, reporterKind: 'worker', whatFailed: '' })).toThrow(OcError);
    expect(() => incidents.create({ ...base, reporterKind: 'worker', tryingToDo: '' })).toThrow(OcError);
    expect(incidents.list().total).toBe(0);
    close();
  });

  it('two identical files are two rows', () => {
    const { incidents, close } = service();
    const a = incidents.create({ ...base, reporterKind: 'worker' });
    const b = incidents.create({ ...base, reporterKind: 'worker' });
    expect(a.id).not.toBe(b.id);
    expect(incidents.list().total).toBe(2);
    close();
  });

  it('filters by reporter kind', () => {
    const { incidents, close } = service();
    incidents.create({ ...base, reporterKind: 'worker' });
    incidents.create({ ...base, reporterKind: 'weaver', title: 'conductor' });
    expect(incidents.list({ reporterKind: 'weaver' }).items).toHaveLength(1);
    expect(incidents.list({ reporterKind: 'weaver' }).items[0]?.reporterKind).toBe('weaver');
    expect(incidents.list({ reporterKind: 'worker' }).items).toHaveLength(1);
    close();
  });

  it('stores run context', () => {
    const { incidents, close } = service();
    const row = incidents.create({
      ...base, reporterKind: 'worker', projectId: 'p1', ticketId: 't1', roleId: 'r1',
    });
    expect(row).toMatchObject({
      workspaceId: 'ws1', agentId: 'ag1', runId: 'run1', projectId: 'p1', ticketId: 't1', roleId: 'r1',
    });
    close();
  });
});

describe('incident reads (VS-222)', () => {
  const seedBase = {
    reporterKind: 'worker', title: 'seeded', whatFailed: 'broke', tryingToDo: 'fix',
    evidence: null, workspaceId: null, projectId: null, ticketId: null, agentId: 'ag1', runId: 'run1', roleId: null,
  } as const;

  function seedRow(db: Db, over: { id: string; createdAt: string; workspaceId?: string | null }) {
    db.insert('incidents', { ...seedBase, ...over });
  }

  it('returns only incidents created strictly after `since`, normalizing the bound', () => {
    const { db, incidents, close } = service();
    const t1 = { id: 'inc_t1', createdAt: '2026-09-10T10:00:00.000Z' };
    const t2 = { id: 'inc_t2', createdAt: '2026-09-10T10:00:00.500Z' };
    const t3 = { id: 'inc_t3', createdAt: '2026-09-11T09:00:00.000Z' };
    for (const row of [t1, t2, t3]) seedRow(db, row);
    // Strictly after: the bookmark instant itself is never returned again.
    expect(incidents.list({ since: t2.createdAt }).items.map((i) => i.id)).toEqual([t3.id]);
    // A bound without milliseconds is normalized to the exact instant, not compared as a string
    // prefix ('.500Z' sorts before 'Z' lexicographically): t2 is after 10:00:00Z, t1 is not.
    expect(incidents.list({ since: '2026-09-10T10:00:00Z' }).items.map((i) => i.id)).toEqual([t3.id, t2.id]);
    // Composes with the other filters; total counts the same filtered set.
    const page = incidents.list({ since: '2026-09-10T10:00:00Z', limit: 1 });
    expect(page.items.map((i) => i.id)).toEqual([t3.id]);
    expect(page.total).toBe(2);
    close();
  });

  it('same-millisecond incidents list as a stable block and bookmark as a group', () => {
    const { db, incidents, close } = service();
    const at = '2026-09-11T12:00:00.000Z';
    const earlier = newId();
    const later = newId();
    seedRow(db, { id: earlier, createdAt: at });
    seedRow(db, { id: later, createdAt: at });
    expect(later > earlier).toBe(true);
    expect(incidents.list({ limit: 10 }).items.map((i) => i.id)).toEqual([later, earlier]);
    expect(incidents.list({ limit: 10 }).items.map((i) => i.id)).toEqual([later, earlier]);
    expect(incidents.list({ since: at }).items).toEqual([]);
    close();
  });

  it('rejects an unparseable since with validation', () => {
    const { incidents, close } = service();
    expect(() => incidents.list({ since: 'yesterday' })).toThrow(OcError);
    expect(() => incidents.list({ since: '' })).toThrow(OcError);
    close();
  });

  it('scopes the list to the caller workspace plus workspace-less rows', () => {
    const { incidents, close } = service();
    const ws1a = incidents.create({ ...seedBase, reporterKind: 'worker', title: 'ws1 a', workspaceId: 'ws1' });
    const ws2 = incidents.create({ ...seedBase, reporterKind: 'worker', title: 'ws2', workspaceId: 'ws2' });
    const global = incidents.create({ ...seedBase, reporterKind: 'weaver', title: 'daemon-global', workspaceId: null });
    const ws1b = incidents.create({ ...seedBase, reporterKind: 'worker', title: 'ws1 b', workspaceId: 'ws1' });

    const alpha = incidents.list({ workspaceId: 'ws1' });
    expect([...alpha.items.map((i) => i.id)].sort()).toEqual([ws1a.id, ws1b.id, global.id].sort());
    expect(alpha.total).toBe(3);

    const beta = incidents.list({ workspaceId: 'ws2' });
    expect([...beta.items.map((i) => i.id)].sort()).toEqual([ws2.id, global.id].sort());
    expect(beta.total).toBe(2);

    // Unscoped stays daemon-wide (the human's HTTP list).
    expect(incidents.list().total).toBe(4);
    close();
  });

  it('scopes get: own and workspace-less readable, another workspace forbidden', () => {
    const { incidents, close } = service();
    const ws1 = incidents.create({ ...seedBase, reporterKind: 'worker', title: 'ws1', workspaceId: 'ws1' });
    const ws2 = incidents.create({ ...seedBase, reporterKind: 'worker', title: 'ws2', workspaceId: 'ws2' });
    const global = incidents.create({ ...seedBase, reporterKind: 'weaver', title: 'daemon-global', workspaceId: null });

    expect(incidents.get(ws1.id, { workspaceId: 'ws1' }).id).toBe(ws1.id);
    expect(incidents.get(global.id, { workspaceId: 'ws1' }).id).toBe(global.id);
    expect(() => incidents.get(ws2.id, { workspaceId: 'ws1' })).toThrow(OcError);
    try {
      incidents.get(ws2.id, { workspaceId: 'ws1' });
    } catch (e) {
      expect((e as OcError).code).toBe('forbidden');
    }
    // Unscoped (the HTTP route) still reads any row.
    expect(incidents.get(ws2.id).id).toBe(ws2.id);
    close();
  });
});

describe('incident resolution (VS-271)', () => {
  const seedBase = {
    reporterKind: 'worker', title: 'seeded', whatFailed: 'broke', tryingToDo: 'fix',
    evidence: null, workspaceId: null, projectId: null, ticketId: null, agentId: 'ag1', runId: 'run1', roleId: null,
  } as const;

  it('resolves an open incident, recording who, why and the fixing ticket', () => {
    const { incidents, close } = service();
    const row = incidents.create({ ...base, reporterKind: 'worker' });
    const resolved = incidents.resolve(row.id, { resolution: 'fixed by VS-232', resolvedByAgentId: 'weaver1', ticketId: 'VS-232' });
    expect(resolved.resolvedAt).not.toBeNull();
    expect(resolved.resolvedByAgentId).toBe('weaver1');
    expect(resolved.resolution).toBe('fixed by VS-232');
    expect(resolved.resolutionTicketId).toBe('VS-232');
    // Round-trips through get.
    expect(incidents.get(row.id)).toMatchObject({
      resolvedAt: resolved.resolvedAt, resolvedByAgentId: 'weaver1', resolution: 'fixed by VS-232', resolutionTicketId: 'VS-232',
    });
    close();
  });

  it('stores ticketId unvalidated when the ticket does not exist', () => {
    const { incidents, close } = service();
    const row = incidents.create({ ...base, reporterKind: 'worker' });
    const resolved = incidents.resolve(row.id, { resolution: 'no such ticket really', resolvedByAgentId: 'weaver1', ticketId: 'NOPE-999' });
    expect(resolved.resolutionTicketId).toBe('NOPE-999');
    close();
  });

  it('rejects re-resolving an already-resolved incident, leaving it unchanged', () => {
    const { incidents, close } = service();
    const row = incidents.create({ ...base, reporterKind: 'worker' });
    const first = incidents.resolve(row.id, { resolution: 'first reason', resolvedByAgentId: 'weaver1' });
    expect(() => incidents.resolve(row.id, { resolution: 'second reason', resolvedByAgentId: 'weaver2' })).toThrow(OcError);
    try {
      incidents.resolve(row.id, { resolution: 'second reason', resolvedByAgentId: 'weaver2' });
    } catch (e) {
      expect((e as OcError).code).toBe('wrong_status');
    }
    const after = incidents.get(row.id);
    expect(after.resolution).toBe('first reason');
    expect(after.resolvedByAgentId).toBe('weaver1');
    expect(after.resolvedAt).toBe(first.resolvedAt);
    close();
  });

  it('rejects an empty or whitespace-only resolution, leaving the incident open', () => {
    const { incidents, close } = service();
    const row = incidents.create({ ...base, reporterKind: 'worker' });
    expect(() => incidents.resolve(row.id, { resolution: '  ', resolvedByAgentId: 'weaver1' })).toThrow(OcError);
    expect(incidents.get(row.id).resolvedAt).toBeNull();
    close();
  });

  it('resolve is not_found for an unknown id and forbidden for another workspace', () => {
    const { incidents, close } = service();
    const ws2 = incidents.create({ ...seedBase, reporterKind: 'worker', workspaceId: 'ws2' });
    expect(() => incidents.resolve('nope', { resolution: 'x', resolvedByAgentId: 'weaver1' })).toThrow(OcError);
    try {
      incidents.resolve('nope', { resolution: 'x', resolvedByAgentId: 'weaver1' });
    } catch (e) {
      expect((e as OcError).code).toBe('not_found');
    }
    expect(() => incidents.resolve(ws2.id, { resolution: 'x', resolvedByAgentId: 'weaver1' }, { workspaceId: 'ws1' })).toThrow(OcError);
    try {
      incidents.resolve(ws2.id, { resolution: 'x', resolvedByAgentId: 'weaver1' }, { workspaceId: 'ws1' });
    } catch (e) {
      expect((e as OcError).code).toBe('forbidden');
    }
    expect(incidents.get(ws2.id).resolvedAt).toBeNull();
    close();
  });

  it('list status filter: open (default caller behavior), resolved, all, and unset is unfiltered', () => {
    const { incidents, close } = service();
    const open = incidents.create({ ...base, reporterKind: 'worker', title: 'open one' });
    const resolvedRow = incidents.create({ ...base, reporterKind: 'worker', title: 'resolved one' });
    incidents.resolve(resolvedRow.id, { resolution: 'dealt with', resolvedByAgentId: 'weaver1' });

    expect(incidents.list({ status: 'open' }).items.map((i) => i.id)).toEqual([open.id]);
    expect(incidents.list({ status: 'open' }).total).toBe(1);
    expect(incidents.list({ status: 'resolved' }).items.map((i) => i.id)).toEqual([resolvedRow.id]);
    expect(incidents.list({ status: 'resolved' }).total).toBe(1);
    const all = incidents.list({ status: 'all' });
    expect([...all.items.map((i) => i.id)].sort()).toEqual([open.id, resolvedRow.id].sort());
    expect(all.total).toBe(2);
    // The service applies no default: status omitted behaves exactly like 'all', so the tool-level
    // 'open' default (VS-271) cannot leak into this service's other caller, GET /api/incidents.
    const unset = incidents.list();
    expect([...unset.items.map((i) => i.id)].sort()).toEqual([open.id, resolvedRow.id].sort());
    expect(unset.total).toBe(2);
    close();
  });
});
