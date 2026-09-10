import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDb } from '@agent-conductor/db';
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
    const conductor = incidents.create({ ...base, reporterKind: 'conductor', title: 'Cannot spawn' });
    expect(worker.reporterKind).toBe('worker');
    expect(conductor.reporterKind).toBe('conductor');
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
    incidents.create({ ...base, reporterKind: 'conductor', title: 'conductor' });
    expect(incidents.list({ reporterKind: 'conductor' }).items).toHaveLength(1);
    expect(incidents.list({ reporterKind: 'conductor' }).items[0]?.reporterKind).toBe('conductor');
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
