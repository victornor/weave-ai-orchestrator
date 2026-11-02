/**
 * The low-disk warning (VS-955, `disk-space-warning`). Free space comes from an injected reader, so
 * the host's real filesystem never decides an outcome; the daemon database and the incidents service
 * are real, and the workspaces are fakes that record what reached the chat.
 */
import { describe, expect, it } from 'vitest';
import { createIncidentsService } from '@weave-ai/core';
import { Db } from '@weave-ai/db';
import type { RetainedCopiesReport, RetainedCopy } from '@weave-ai/shared';
import { createDiskWatch, type FsReading } from '../src/diskWatch.js';
import type { WorkspaceRuntime } from '../src/types.js';

const GB = 1024 ** 3;
const TB = 1024 ** 4;
const thresholds = () => ({ warnFreePercent: 10, warnFreeBytes: 50 * GB });

function copy(directory: string, ticket: string, bytes: number): RetainedCopy {
  return {
    directory, workerId: directory, workerName: `Engineer ${directory}`, workerStatus: 'done', ticketId: null, ticketIdentifier: ticket,
    ticketStatus: 'cancelled', projectId: null, branch: null, headSha: null, class: 'finished_unlanded', offerable: true, ageFrom: null,
    bytes, uncommitted: null, commitsNotOnLandingBranch: null, commitsOnNoRemote: null, commitsOnlyHere: null, mergedPr: false,
    error: null, reasons: ['uncommitted'], needsOwnApproval: false, scannedAt: 't',
  };
}

interface FakeWs { runtime: WorkspaceRuntime; sent: string[]; db: Db; scans: number }

function workspace(id: string, root: string, copies: RetainedCopy[], scannedAt: string | null = '2026-11-02T18:00:00.000Z'): FakeWs {
  const db = new Db(':memory:');
  db.migrate();
  const ws: FakeWs = { sent: [], db, scans: 0, runtime: null as unknown as WorkspaceRuntime };
  const bytes = copies.reduce((n, c) => n + (c.bytes ?? 0), 0);
  const report = { scannedAt, scanning: false, offerDays: 30, totals: { count: copies.length, bytes }, copies } as unknown as RetainedCopiesReport;
  ws.runtime = {
    id,
    ctx: { db, paths: { root } },
    services: {
      workers: { retainedCopies: () => report, startRetainedScan: () => { ws.scans += 1; return true; } },
      threads: { notifyHuman: async (_a: unknown, m: { text: string }) => { ws.sent.push(m.text); } },
    },
  } as unknown as WorkspaceRuntime;
  return ws;
}

function daemonDb(): Db {
  const db = new Db(':memory:');
  db.migrate();
  return db;
}

/** A reader whose answer the test sets per device; `fail` makes one root throw. */
function reader(initial: Record<string, FsReading>, fail = new Set<string>()) {
  const readings = { ...initial };
  const calls: string[] = [];
  return {
    calls,
    set(root: string, r: FsReading) { readings[root] = r; },
    read: async (root: string): Promise<FsReading> => {
      calls.push(root);
      if (fail.has(root)) throw new Error('EACCES');
      return readings[root]!;
    },
  };
}

const at = (free: number, total = 1.6 * TB, dev = '64768'): FsReading => ({ dev, freeBytes: free, totalBytes: total });

describe('the low-disk warning (VS-955)', () => {
  it('below the threshold, warns once on the chat and files one incident naming the largest copies', async () => {
    const ws = workspace('ws1', '/srv/ws1', [copy('w3', 'VS-363', 4 * GB), copy('w1', 'VS-349', 12 * GB), copy('w2', 'VS-350', 9 * GB)]);
    const db = daemonDb();
    const incidents = createIncidentsService(db);
    const fs = reader({ '/srv/ws1': at(24 * GB) });
    const watch = createDiskWatch({ workspaces: () => [ws.runtime], db, incidents, thresholds, readFs: fs.read });

    await watch.check();

    expect(ws.sent).toHaveLength(1);
    const text = ws.sent[0]!;
    expect(text).toMatch(/^Low disk space: 24GB free of 1\.6TB \(1\.5%\) on the filesystem holding \/srv\/ws1; the warning is below 10% or 50GB\./);
    expect(text).toContain('Largest retained worker copies: VS-349 (Engineer w1) 12GB, VS-350 (Engineer w2) 9GB, VS-363 (Engineer w3) 4GB.');
    expect(text).toContain('This workspace keeps 25GB in 3 retained copies.');
    expect(text).toContain('nothing is removed without your approval');
    const open = incidents.list({ status: 'open' }).items;
    expect(open).toHaveLength(1);
    expect(open[0]!.title).toBe('Low disk space on the filesystem holding /srv/ws1');
    expect(open[0]!.evidence).toContain('VS-349 w1: 12GB');
    // The Storage view's last check.
    expect(JSON.parse(ws.db.get<{ value: string }>("SELECT value FROM meta WHERE key = 'disk.last_check'")!.value))
      .toMatchObject({ path: '/srv/ws1', freeBytes: 24 * GB, low: true });
  });

  it('stays silent on a second low check, re-warns when free space halves, and survives a restart', async () => {
    const ws = workspace('ws1', '/srv/ws1', [copy('w1', 'VS-349', 12 * GB)]);
    const db = daemonDb();
    const fs = reader({ '/srv/ws1': at(24 * GB) });
    await createDiskWatch({ workspaces: () => [ws.runtime], db, incidents: null, thresholds, readFs: fs.read }).check();
    expect(ws.sent).toHaveLength(1);

    // A new watch over the same daemon database is a restarted daemon: the episode is remembered.
    const restarted = createDiskWatch({ workspaces: () => [ws.runtime], db, incidents: null, thresholds, readFs: fs.read });
    fs.set('/srv/ws1', at(20 * GB));
    await restarted.check();
    expect(ws.sent).toHaveLength(1);

    fs.set('/srv/ws1', at(12 * GB));
    await restarted.check();
    expect(ws.sent).toHaveLength(2);
    expect(ws.sent[1]).toContain('12GB free');
  });

  it('ends the episode only past the recovery margin, then warns again on the next drop', async () => {
    const ws = workspace('ws1', '/srv/ws1', []);
    const db = daemonDb();
    const fs = reader({ '/srv/ws1': at(100 * GB, TB) });
    const watch = createDiskWatch({ workspaces: () => [ws.runtime], db, incidents: null, thresholds, readFs: fs.read });
    await watch.check();
    expect(ws.sent).toHaveLength(1);

    fs.set('/srv/ws1', at(0.11 * TB, TB)); // above 10 %, inside the 5 % margin: still the same episode
    await watch.check();
    fs.set('/srv/ws1', at(0.09 * TB, TB));
    await watch.check();
    expect(ws.sent).toHaveLength(1);

    fs.set('/srv/ws1', at(0.2 * TB, TB)); // recovered
    await watch.check();
    fs.set('/srv/ws1', at(0.09 * TB, TB));
    await watch.check();
    expect(ws.sent).toHaveLength(2);
  });

  it('raises nothing above both thresholds', async () => {
    const ws = workspace('ws1', '/srv/ws1', [copy('w1', 'VS-349', 12 * GB)]);
    const db = daemonDb();
    const incidents = createIncidentsService(db);
    await createDiskWatch({ workspaces: () => [ws.runtime], db, incidents, thresholds, readFs: reader({ '/srv/ws1': at(500 * GB) }).read }).check();
    expect(ws.sent).toEqual([]);
    expect(incidents.list({ status: 'open' }).items).toEqual([]);
  });

  it('two workspaces on one filesystem share one incident and each get their own line', async () => {
    const a = workspace('a', '/srv/a', [copy('w1', 'VS-349', 12 * GB)]);
    const b = workspace('b', '/srv/b', [copy('w9', 'OFM-62', 30 * GB)]);
    const db = daemonDb();
    const incidents = createIncidentsService(db);
    const fs = reader({ '/srv/a': at(24 * GB), '/srv/b': at(24 * GB) });
    await createDiskWatch({ workspaces: () => [a.runtime, b.runtime], db, incidents, thresholds, readFs: fs.read }).check();
    expect(incidents.list({ status: 'open' }).items).toHaveLength(1);
    expect(a.sent).toHaveLength(1);
    expect(b.sent).toHaveLength(1);
    // The top consumers span both workspaces; each line carries its own workspace's total.
    expect(a.sent[0]).toContain('OFM-62 (Engineer w9) 30GB, VS-349 (Engineer w1) 12GB');
    expect(a.sent[0]).toContain('This workspace keeps 12GB');
    expect(b.sent[0]).toContain('This workspace keeps 30GB');
  });

  it('a root that cannot be read is logged and the other filesystems are still checked', async () => {
    const a = workspace('a', '/srv/a', []);
    const b = workspace('b', '/srv/b', []);
    const fs = reader({ '/srv/b': at(1 * GB, TB, 'other') }, new Set(['/srv/a']));
    await createDiskWatch({ workspaces: () => [a.runtime, b.runtime], db: daemonDb(), incidents: null, thresholds, readFs: fs.read }).check();
    expect(fs.calls).toEqual(['/srv/a', '/srv/b']);
    expect(a.sent).toEqual([]);
    expect(b.sent).toHaveLength(1);
  });

  it('starts a scan and says so when no retained-copy scan has finished yet', async () => {
    const ws = workspace('ws1', '/srv/ws1', [], null);
    await createDiskWatch({ workspaces: () => [ws.runtime], db: daemonDb(), incidents: null, thresholds, readFs: reader({ '/srv/ws1': at(1 * GB) }).read }).check();
    expect(ws.scans).toBe(1);
    expect(ws.sent[0]).toContain('No retained-copy scan has finished yet; one has started.');
  });
});
