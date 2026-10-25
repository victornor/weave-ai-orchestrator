/**
 * What release this daemon is running, and whether the configured source is ahead of it (PLAN §20).
 *
 * The running release is derived from this module's own location, never from the `current` symlink: an
 * upgrade swings `current` before the restart, so between the swing and the restart the symlink names
 * the *next* release while this process is still serving the previous one.
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { releaseSha, resolveRemoteSha } from '@weave-ai/release';
import { githubSshRemote } from '@weave-ai/core';
import type { DaemonConfig } from '@weave-ai/shared';

const here = dirname(fileURLToPath(import.meta.url));

export interface RunningRelease {
  version: string;
  /** The release directory this process is executing from. */
  path: string;
  /** The commit it was built from, or `null` when it could not be determined. */
  sha: string | null;
}

/**
 * VS-830: the configured release source still names the repository the running release was built from,
 * while a project that used that repository has since been re-pointed away from it. Left alone, upgrades
 * keep building from the old repository and the only symptom is "no update available".
 */
export interface StaleSource {
  /** The configured source, as it is written in `daemon.yaml`. */
  configured: string;
  /** The project that moved away from the repository the running release came from. */
  project: { id: string; slug: string; url: string };
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
  /**
   * VS-830: the repository the running release was built from (the release directory's `origin`), or
   * `null` when the release carries no recoverable one. Independent of the source comparison.
   */
  runtimeSource: string | null;
  /** VS-830: the stale-source warning, or `null`. Additive — it never replaces the update answer. */
  staleSource: StaleSource | null;
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

/**
 * VS-830: the repository a release was built from. `buildRelease` clones the source and keeps its `.git`,
 * so the release directory answers this itself — the one durable record of where the running release came
 * from, which a project re-point does not move. Normalized so `git@github.com:o/r.git` and
 * `https://github.com/o/r` compare equal. `null` when there is no `.git`, no `origin`, or git fails.
 */
export function releaseOrigin(release: string): string | null {
  if (!existsSync(join(release, '.git'))) return null;
  try {
    const url = execFileSync('git', ['-C', release, 'remote', 'get-url', 'origin'], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 10_000,
    }).trim();
    return url === '' ? null : githubSshRemote(url);
  } catch {
    return null;
  }
}

/** One project as the stale-source check needs it: where it lives now, and whether its clone has a commit. */
export interface ReleaseProject {
  id: string;
  slug: string;
  gitUrl: string;
  /** The project's primary clone; where a commit's presence is checked. */
  clonePath: string;
}

export interface StaleSourceInput {
  /** The repository the running release was built from, normalized; `null` when unknown. */
  runtimeSource: string | null;
  /** The configured `upgrade.source`, unnormalized. */
  source: string | null;
  /** Projects to consider. Only ready ones are reported by the daemon's own reader. */
  projects: ReleaseProject[];
  /** Whether the project's clone contains the running release's commit (VS-830's proof it used to live there). */
  containsCommit: (project: ReleaseProject, sha: string | null) => boolean;
  runningSha: string | null;
}

/**
 * VS-830: is the configured source stale? Exactly when it names the repository the running release came
 * from, and a project whose `gitUrl` differs from that repository has the running release's commit in its
 * clone — so that project used to live at the running release's repository and has been re-pointed away.
 * A source naming anything else is the operator's own choice and is never reported. First match by slug.
 */
export function detectStaleSource(i: StaleSourceInput): StaleSource | null {
  const runtime = i.runtimeSource;
  const configured = i.source;
  if (!runtime || !configured || githubSshRemote(configured) !== runtime) return null;
  const moved = i.projects
    .filter((p) => githubSshRemote(p.gitUrl) !== runtime && i.containsCommit(p, i.runningSha))
    .sort((a, b) => a.slug.localeCompare(b.slug));
  const project = moved[0];
  if (!project) return null;
  return { configured, project: { id: project.id, slug: project.slug, url: project.gitUrl } };
}

/** What the stale-source check needs from the workspaces, injected by the server (core owns projects). */
export interface StaleSourceDeps {
  /** Every ready project's `{ id, slug, gitUrl, clonePath }`. */
  projects(): ReleaseProject[];
}

export interface UpdateCheckerOptions {
  daemon: DaemonConfig;
  version: string;
  /** Overridden in tests; defaults to the release this process runs from. */
  releaseRoot?: string;
  now?: () => number;
  resolveRemote?: (source: string, ref: string) => string;
  /** VS-830: the projects the stale-source check considers. Without it nothing is reported as stale. */
  staleSources?: StaleSourceDeps;
  /** VS-830: overridden in tests; defaults to reading the release directory's `origin`. */
  releaseOrigin?: (release: string) => string | null;
  /** VS-830: overridden in tests; defaults to `git cat-file -e <sha>^{commit}` in the clone. */
  containsCommit?: (clonePath: string, sha: string | null) => boolean;
}

export interface UpdateChecker {
  check(opts?: { refresh?: boolean }): UpdateStatus;
  /** The running release alone. Never reaches the network, so `/api/health` can report it. */
  running(): RunningRelease;
  /** VS-830: drop the cached answer, so the next check resolves the (possibly changed) source again. */
  invalidate(): void;
}

/** Whether `clonePath` contains `sha` as a commit. Local and cheap; false whenever it cannot be answered. */
export function cloneContainsCommit(clonePath: string, sha: string | null): boolean {
  if (!sha) return false;
  try {
    execFileSync('git', ['-C', clonePath, 'cat-file', '-e', `${sha}^{commit}`], { stdio: 'ignore', timeout: 10_000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Caches the answer for `upgrade.updateCheckIntervalSec`, so reading the status repeatedly (the web app
 * polls it) does not reach the network every time. A refresh resolves the source again regardless.
 */
export function createUpdateChecker(o: UpdateCheckerOptions): UpdateChecker {
  const now = o.now ?? (() => Date.now());
  const resolveRemote = o.resolveRemote ?? ((source: string, ref: string) => resolveRemoteSha(source, ref));
  const root = o.releaseRoot ?? runningReleaseRoot();
  const originOf = o.releaseOrigin ?? releaseOrigin;
  const contains = o.containsCommit ?? cloneContainsCommit;
  let cached: { at: number; status: UpdateStatus } | null = null;

  /** VS-830: computed on every read (it is local), so a re-point or a changed source is never hidden by the cache. */
  const staleFor = (running: RunningRelease): { runtimeSource: string | null; staleSource: StaleSource | null } => {
    const runtimeSource = originOf(root);
    const staleSource = detectStaleSource({
      runtimeSource,
      source: o.daemon.upgrade.source ?? null,
      runningSha: running.sha,
      projects: o.staleSources?.projects() ?? [],
      containsCommit: (p, sha) => contains(p.clonePath, sha),
    });
    return { runtimeSource, staleSource };
  };

  return {
    running: (): RunningRelease => describeRelease(root, o.version),

    invalidate(): void {
      cached = null;
    },

    check(opts = {}): UpdateStatus {
      const running = describeRelease(root, o.version);
      const { source, ref } = o.daemon.upgrade;
      const stale = staleFor(running);
      if (!source) {
        // Nothing to compare against: not configured is not an error and not an update.
        return { configured: false, running, source: null, ref: null, targetSha: null, updateAvailable: false, checkedAt: null, error: null, ...stale };
      }
      const ttlMs = o.daemon.upgrade.updateCheckIntervalSec * 1000;
      if (!opts.refresh && cached && cached.status.source === source && cached.status.ref === ref && now() - cached.at < ttlMs) {
        return { ...cached.status, running, ...stale };
      }

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
        ...stale,
      };
      cached = { at: now(), status };
      return status;
    },
  };
}
