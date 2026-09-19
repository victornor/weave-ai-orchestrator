/**
 * VS-579: the base memory a worker's limit is derived from. The daemon's own cgroup ceiling wins
 * when it is constrained (a container, a pre-existing slice), because deriving from the whole host
 * there would hand a worker more than the daemon can ever see. Otherwise the host's total memory.
 */
import { readFileSync } from 'node:fs';
import { totalmem } from 'node:os';
import { resolveWorkerMemoryMb, type WorkerMemoryResolution, type WorkspaceConfig } from '@weave-ai/shared';

export const MEMORY_MB = 1024 * 1024;

/** Parse a cgroup v2 `memory.max` value (`max` = unlimited) into bytes, or null when unusable. */
export function parseCgroupMemoryMax(raw: string | null | undefined): number | null {
  if (raw == null) return null;
  const text = raw.trim();
  if (text === '' || text === 'max') return null;
  const n = Number.parseInt(text, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** The daemon's own cgroup's `memory.max`, read from `/proc/self/cgroup`, or null when unreadable. */
export function readDaemonCgroupMemoryMax(read: (path: string) => string = (p) => readFileSync(p, 'utf8')): string | null {
  try {
    const line = read('/proc/self/cgroup')
      .split('\n')
      .find((l) => l.startsWith('0::'));
    if (!line) return null;
    const rel = line.slice(line.indexOf('::') + 2).trim();
    return read(`/sys/fs/cgroup${rel}/memory.max`);
  } catch {
    return null;
  }
}

/**
 * The base memory in MB used to derive a worker limit: the smaller of the daemon's cgroup ceiling
 * and the host total. A test passes its own inputs; production reads the host.
 */
export function baseMemoryMb(o: { totalBytes?: number; cgroupMax?: string | null } = {}): number {
  const totalBytes = o.totalBytes ?? totalmem();
  const cap = parseCgroupMemoryMax(o.cgroupMax === undefined ? readDaemonCgroupMemoryMax() : o.cgroupMax);
  const bytes = cap !== null ? Math.min(cap, totalBytes) : totalBytes;
  return Math.max(1, Math.floor(bytes / MEMORY_MB));
}

/**
 * The workspace-level worker memory limit and where it came from, for a surface that shows it. A
 * role's own override is per role and read where the role is; this is the value every role inherits.
 */
export function effectiveWorkspaceWorkerMemory(config: WorkspaceConfig): WorkerMemoryResolution {
  return resolveWorkerMemoryMb({
    workspaceMb: config.defaults.workerMemoryMb ?? null,
    baseMemoryMb: baseMemoryMb(),
    maxConcurrentRuns: config.defaults.maxConcurrentRuns ?? 6,
  });
}
