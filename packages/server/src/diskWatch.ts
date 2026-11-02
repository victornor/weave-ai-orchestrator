/**
 * VS-955 (`disk-space-warning`): warn captain before the filesystem holding a workspace fills up.
 *
 * On 2026-11-02 the host's root filesystem reached 99 % and the daemon died with SIGBUS; the largest
 * single consumer was the daemon's own retained worker copies, and nothing had said so. This timer reads
 * free space on the filesystem holding each workspace root, de-duplicated by device. Below either
 * threshold it warns once per low episode — a chat line on each workspace on that filesystem and one
 * daemon incident — naming the largest retained copies, with where to reclaim them. It never deletes.
 *
 * Episode state lives in the daemon database, so a restart neither repeats the warning nor forgets it.
 * The filesystem is read through an injected reader, so no test depends on this host's real free space.
 */
import { stat, statfs } from 'node:fs/promises';
import { getLogger, type IncidentsService } from '@weave-ai/core';
import { nowIso, type Db } from '@weave-ai/db';
import { formatBytes } from '@weave-ai/render';
import type { DiskCheck, RetainedCopy } from '@weave-ai/shared';
import type { WorkspaceRuntime } from './types.js';

const log = getLogger('daemon', { component: 'disk-watch' });

export const DISK_CHECK_EVERY_MS = 10 * 60_000;
export const DISK_FIRST_CHECK_MS = 60_000;
/** Recovery needs free space back above the threshold by this share of the filesystem, so a hover does not re-warn. */
export const DISK_RECOVERY_MARGIN = 0.05;
const TOP_CONSUMERS = 5;

export interface FsReading { dev: string; freeBytes: number; totalBytes: number }
export type FsReader = (path: string) => Promise<FsReading>;

/** Free space available to an unprivileged writer (`bavail`), as `df` reports it. */
export const readFilesystem: FsReader = async (path) => {
  const [st, fs] = await Promise.all([stat(path), statfs(path)]);
  return { dev: String(st.dev), freeBytes: fs.bavail * fs.bsize, totalBytes: fs.blocks * fs.bsize };
};

export interface DiskThresholds { warnFreePercent: number; warnFreeBytes: number }

interface Episode { startedAt: string; freeAtStart: number; lastWarnFree: number }

export interface DiskWatchOptions {
  workspaces: () => WorkspaceRuntime[];
  /** The daemon database: episode state, keyed by device. */
  db: Db;
  incidents: IncidentsService | null;
  thresholds: () => DiskThresholds;
  readFs?: FsReader;
  now?: () => string;
}

export interface DiskWatch { check(): Promise<void>; start(): void; stop(): void }

export function isLow(r: FsReading, t: DiskThresholds): boolean {
  return r.freeBytes < r.totalBytes * (t.warnFreePercent / 100) || r.freeBytes < t.warnFreeBytes;
}

function isRecovered(r: FsReading, t: DiskThresholds): boolean {
  const floor = Math.max(r.totalBytes * (t.warnFreePercent / 100), t.warnFreeBytes);
  return r.freeBytes >= floor + r.totalBytes * DISK_RECOVERY_MARGIN;
}

const pct = (r: FsReading): string => (r.totalBytes ? `${((r.freeBytes / r.totalBytes) * 100).toFixed(1)}%` : '?');

/** The warning's text for one workspace: free space, threshold, the largest copies and where to act. */
export function lowDiskText(input: {
  reading: FsReading;
  root: string;
  thresholds: DiskThresholds;
  top: Array<RetainedCopy & { workspace: string }>;
  workspaceTotal: { count: number; bytes: number } | null;
  unscanned: boolean;
}): string {
  const { reading, thresholds: t } = input;
  const head = `Low disk space: ${formatBytes(reading.freeBytes)} free of ${formatBytes(reading.totalBytes)} (${pct(reading)}) on the filesystem holding ${input.root}; the warning is below ${t.warnFreePercent}% or ${formatBytes(t.warnFreeBytes)}.`;
  const top = input.top.length
    ? ` Largest retained worker copies: ${input.top.map((c) => `${c.ticketIdentifier ?? c.directory}${c.workerName ? ` (${c.workerName})` : ''} ${formatBytes(c.bytes)}`).join(', ')}.`
    : '';
  const total = input.workspaceTotal && input.workspaceTotal.count
    ? ` This workspace keeps ${formatBytes(input.workspaceTotal.bytes)} in ${input.workspaceTotal.count} retained ${input.workspaceTotal.count === 1 ? 'copy' : 'copies'}.`
    : '';
  const unscanned = input.unscanned ? ' No retained-copy scan has finished yet; one has started.' : '';
  return `${head}${top}${total}${unscanned} Reclaim them from Settings → Storage or \`weave worker retained\`; nothing is removed without your approval.`;
}

export function createDiskWatch(o: DiskWatchOptions): DiskWatch {
  const readFs = o.readFs ?? readFilesystem;
  const now = o.now ?? nowIso;
  let timer: NodeJS.Timeout | null = null;
  let first: NodeJS.Timeout | null = null;
  let running = false;

  const key = (dev: string): string => `disk.low.${dev}`;
  const episodeOf = (dev: string): Episode | null => {
    const raw = o.db.get<{ value: string }>('SELECT value FROM meta WHERE key = ?', [key(dev)])?.value;
    try { return raw ? JSON.parse(raw) as Episode : null; } catch { return null; }
  };
  const setEpisode = (dev: string, e: Episode | null): void => {
    if (e === null) { o.db.run('DELETE FROM meta WHERE key = ?', [key(dev)]); return; }
    o.db.run('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [key(dev), JSON.stringify(e)]);
  };

  async function warn(reading: FsReading, group: WorkspaceRuntime[], t: DiskThresholds): Promise<void> {
    const all: Array<RetainedCopy & { workspace: string }> = [];
    const totals = new Map<string, { count: number; bytes: number }>();
    let unscanned = false;
    for (const ws of group) {
      try {
        const r = ws.services.workers.retainedCopies();
        if (r.scannedAt === null) { unscanned = true; ws.services.workers.startRetainedScan(); }
        totals.set(ws.id, { count: r.totals.count, bytes: r.totals.bytes });
        for (const c of r.copies) all.push({ ...c, workspace: ws.id });
      } catch (e) { log.warn({ err: String(e), ws: ws.id }, 'could not read retained copies for the disk warning'); }
    }
    const top = all.sort((a, b) => (b.bytes ?? 0) - (a.bytes ?? 0)).slice(0, TOP_CONSUMERS);
    const root = group[0]!.ctx.paths.root;
    for (const ws of group) {
      const text = lowDiskText({ reading, root: ws.ctx.paths.root, thresholds: t, top, workspaceTotal: totals.get(ws.id) ?? null, unscanned });
      try { await ws.services.threads.notifyHuman({ kind: 'system', id: null }, { text }); }
      catch (e) { log.warn({ err: String(e), ws: ws.id }, 'could not post the low-disk warning'); }
    }
    const title = `Low disk space on the filesystem holding ${root}`;
    try {
      const open = o.incidents?.list({ status: 'open', limit: 200 }).items ?? [];
      if (o.incidents && !open.some((i) => i.title === title)) {
        o.incidents.create({
          reporterKind: 'system',
          title,
          whatFailed: `${formatBytes(reading.freeBytes)} free of ${formatBytes(reading.totalBytes)} (${pct(reading)}), below ${t.warnFreePercent}% or ${formatBytes(t.warnFreeBytes)}`,
          tryingToDo: 'keep enough free space on the filesystem holding the workspaces that the daemon and its workers can write',
          evidence: [
            ...group.map((ws) => `${ws.id}: ${formatBytes(totals.get(ws.id)?.bytes ?? 0)} in ${totals.get(ws.id)?.count ?? 0} retained worker copies`),
            ...top.map((c) => `${c.workspace} ${c.ticketIdentifier ?? '-'} ${c.directory}: ${formatBytes(c.bytes)} (${c.class})`),
          ].join('\n'),
          workspaceId: group[0]!.id,
          agentId: 'daemon',
          runId: '',
        });
      }
    } catch (e) { log.warn({ err: String(e) }, 'could not file the low-disk incident'); }
    log.warn({ dev: reading.dev, freeBytes: reading.freeBytes, totalBytes: reading.totalBytes, workspaces: group.map((w) => w.id) }, 'low disk space');
  }

  async function check(): Promise<void> {
    if (running) return;
    running = true;
    try {
      const t = o.thresholds();
      const groups = new Map<string, { reading: FsReading; workspaces: WorkspaceRuntime[] }>();
      for (const ws of o.workspaces()) {
        let reading: FsReading;
        try { reading = await readFs(ws.ctx.paths.root); }
        catch (e) { log.warn({ err: String(e), ws: ws.id, root: ws.ctx.paths.root }, 'could not read free space for a workspace root'); continue; }
        const g = groups.get(reading.dev) ?? { reading, workspaces: [] };
        g.workspaces.push(ws);
        groups.set(reading.dev, g);
      }
      for (const [dev, { reading, workspaces }] of groups) {
        const low = isLow(reading, t);
        const last: DiskCheck = {
          path: '', freeBytes: reading.freeBytes, totalBytes: reading.totalBytes, low,
          thresholds: { freePercent: t.warnFreePercent, freeBytes: t.warnFreeBytes }, checkedAt: now(),
        };
        for (const ws of workspaces) {
          try {
            ws.ctx.db.run("INSERT INTO meta (key, value) VALUES ('disk.last_check', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
              [JSON.stringify({ ...last, path: ws.ctx.paths.root })]);
          } catch (e) { log.warn({ err: String(e), ws: ws.id }, 'could not record the disk check'); }
        }
        const episode = episodeOf(dev);
        if (low) {
          if (!episode) {
            setEpisode(dev, { startedAt: now(), freeAtStart: reading.freeBytes, lastWarnFree: reading.freeBytes });
            await warn(reading, workspaces, t);
          } else if (reading.freeBytes <= episode.lastWarnFree / 2) {
            setEpisode(dev, { ...episode, lastWarnFree: reading.freeBytes });
            await warn(reading, workspaces, t);
          }
        } else if (episode && isRecovered(reading, t)) {
          setEpisode(dev, null);
          log.info({ dev, freeBytes: reading.freeBytes }, 'disk space recovered');
        }
      }
    } finally {
      running = false;
    }
  }

  const safeCheck = (): void => { void check().catch((e: unknown) => log.warn({ err: String(e) }, 'disk check failed')); };

  return {
    check,
    start() {
      if (timer) return;
      first = setTimeout(safeCheck, DISK_FIRST_CHECK_MS);
      first.unref?.();
      timer = setInterval(safeCheck, DISK_CHECK_EVERY_MS);
      timer.unref?.();
    },
    stop() {
      if (first) { clearTimeout(first); first = null; }
      if (timer) { clearInterval(timer); timer = null; }
    },
  };
}
