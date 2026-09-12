/**
 * What release this daemon is running, and whether the configured source is ahead of it (PLAN §20).
 *
 * The running release is derived from this module's own location, never from the `current` symlink: an
 * upgrade swings `current` before the restart, so between the swing and the restart the symlink names
 * the *next* release while this process is still serving the previous one.
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { releaseSha, resolveRemoteSha } from '@weave-ai/release';
import type { DaemonConfig } from '@weave-ai/shared';

const here = dirname(fileURLToPath(import.meta.url));

export interface RunningRelease {
  version: string;
  /** The release directory this process is executing from. */
  path: string;
  /** The commit it was built from, or `null` when it could not be determined. */
  sha: string | null;
}

export interface UpdateStatus {
  /** False when no `upgrade.source` is configured: not an update, and not an error. */
  configured: boolean;
  running: RunningRelease;
  source: string | null;
  ref: string | null;
  /** The commit the source has at `ref`, or `null` when it could not be resolved. */
  targetSha: string | null;
  updateAvailable: boolean;
  checkedAt: string | null;
  error: string | null;
}

/** `<root>/packages/server/dist/release-info.js` → `<root>`, the same depth `daemon.ts` uses. */
export function runningReleaseRoot(): string {
  return resolve(here, '..', '..', '..');
}

/** Split out from `runningRelease` so it can be exercised over a temp directory. */
export function describeRelease(root: string, version: string): RunningRelease {
  return { version, path: root, sha: releaseSha(root) };
}

export function runningRelease(version: string): RunningRelease {
  return describeRelease(runningReleaseRoot(), version);
}

export interface UpdateCheckerOptions {
  daemon: DaemonConfig;
  version: string;
  /** Overridden in tests; defaults to the release this process runs from. */
  releaseRoot?: string;
  now?: () => number;
  resolveRemote?: (source: string, ref: string) => string;
}

export interface UpdateChecker {
  check(opts?: { refresh?: boolean }): UpdateStatus;
  /** The running release alone. Never reaches the network, so `/api/health` can report it. */
  running(): RunningRelease;
}

/**
 * Caches the answer for `upgrade.updateCheckIntervalSec`, so reading the status repeatedly (the web app
 * polls it) does not reach the network every time. A refresh resolves the source again regardless.
 */
export function createUpdateChecker(o: UpdateCheckerOptions): UpdateChecker {
  const now = o.now ?? (() => Date.now());
  const resolveRemote = o.resolveRemote ?? ((source: string, ref: string) => resolveRemoteSha(source, ref));
  const root = o.releaseRoot ?? runningReleaseRoot();
  let cached: { at: number; status: UpdateStatus } | null = null;

  return {
    running: (): RunningRelease => describeRelease(root, o.version),

    check(opts = {}): UpdateStatus {
      const running = describeRelease(root, o.version);
      const { source, ref } = o.daemon.upgrade;
      if (!source) {
        // Nothing to compare against: not configured is not an error and not an update.
        return { configured: false, running, source: null, ref: null, targetSha: null, updateAvailable: false, checkedAt: null, error: null };
      }
      const ttlMs = o.daemon.upgrade.updateCheckIntervalSec * 1000;
      if (!opts.refresh && cached && now() - cached.at < ttlMs) return { ...cached.status, running };

      let targetSha: string | null = null;
      let error: string | null = null;
      try {
        targetSha = resolveRemote(source, ref);
      } catch (e) {
        error = (e as Error).message;
      }
      const status: UpdateStatus = {
        configured: true, running, source, ref, targetSha,
        // Unknown on either side is not an update: the comparison could not be made.
        updateAvailable: Boolean(targetSha && running.sha && targetSha !== running.sha),
        checkedAt: new Date(now()).toISOString(),
        error,
      };
      cached = { at: now(), status };
      return status;
    },
  };
}
