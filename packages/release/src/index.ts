/**
 * Release directories for `weave daemon upgrade|releases|rollback` (PLAN §20).
 *
 * The daemon never runs from a checkout that anyone edits. Each upgrade clones the source at a ref
 * into `<data>/weave/releases/<stamp>-<sha>/`, builds it there, backs the databases up,
 * drains the running daemon, switches the `current` symlink and restarts the service. `previous`
 * always points at the release before that, so `rollback` is a symlink swap plus a restart.
 * Host-local, never remote: everything here runs on the daemon host.
 *
 * Shared by the CLI (`weave daemon upgrade|releases|rollback`) and by the daemon's own deferred
 * upgrade, so both agree on the layout. A leaf package: it imports nothing from `@weave-ai/*`.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readdirSync, readlinkSync, renameSync, rmSync, symlinkSync, unlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { resolveInstallPath } from './paths.js';

export * from './paths.js';

/** VS-258: `<base>/agent-conductor` or `<base>/weave`, whichever exists; a fresh host gets the new name. */
function resolveUserDir(base: string): string {
  const r = resolveInstallPath(join(base, 'agent-conductor'), join(base, 'weave'));
  if (r.status === 'ambiguous') throw new Error(`ambiguous install: both ${r.oldPath} and ${r.newPath} exist`);
  return r.path;
}

export function dataHome(): string {
  const xdg = process.env['XDG_DATA_HOME'];
  return resolveUserDir(xdg && xdg.trim() !== '' ? xdg : join(homedir(), '.local', 'share'));
}
export function releasesDir(): string { return join(dataHome(), 'releases'); }
export function currentLink(): string { return join(dataHome(), 'current'); }
export function previousLink(): string { return join(dataHome(), 'previous'); }

/** VS-258: collapsed from independent copies in `packages/core` and `packages/cli`. */
export function configDir(): string {
  if (process.env['AC_CONFIG_HOME']) return process.env['AC_CONFIG_HOME'];
  const xdg = process.env['XDG_CONFIG_HOME'];
  return resolveUserDir(xdg && xdg.trim() !== '' ? xdg : join(homedir(), '.config'));
}

/** VS-258: collapsed into this package alongside `configDir()`/`dataHome()`. */
export function stateHome(): string {
  const xdg = process.env['XDG_STATE_HOME'];
  return resolveUserDir(xdg && xdg.trim() !== '' ? xdg : join(homedir(), '.local', 'state'));
}

export function readLink(path: string): string | null {
  try { return lstatSync(path).isSymbolicLink() ? resolve(dirname(path), readlinkSync(path)) : null; } catch { return null; }
}

export interface ReleaseInfo { name: string; path: string; sha: string; current: boolean; previous: boolean; builtAt: string }

export function listReleases(): ReleaseInfo[] {
  const cur = readLink(currentLink());
  const prev = readLink(previousLink());
  let names: string[] = [];
  try { names = readdirSync(releasesDir()).filter((n) => !n.startsWith('.')).sort(); } catch { return []; }
  return names.map((name) => {
    const path = join(releasesDir(), name);
    const m = name.match(/^(\d{8}-\d{6})-([0-9a-f]{7,40})$/);
    const stamp = m?.[1] ?? '';
    const builtAt = stamp ? `${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)} ${stamp.slice(9, 11)}:${stamp.slice(11, 13)}:${stamp.slice(13, 15)}` : '';
    return { name, path, sha: m?.[2] ?? '', current: path === cur, previous: path === prev, builtAt };
  });
}

/**
 * `onOutput` is how the daemon captures a build it did not start from a terminal: with it the child's
 * output is piped and split into lines, without it the CLI keeps inheriting the terminal as before.
 */
function run(cmd: string, args: string[], cwd: string, log: (line: string) => void, onOutput?: (line: string) => void): void {
  log(`$ ${[cmd, ...args].join(' ')}`);
  const env = { ...process.env, CI: '1', NO_COLOR: '1' };
  const r = onOutput
    ? spawnSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env, maxBuffer: 64 * 1024 * 1024 })
    : spawnSync(cmd, args, { cwd, stdio: 'inherit', env });
  if (onOutput) {
    for (const chunk of [r.stdout, r.stderr]) {
      for (const line of String(chunk ?? '').split('\n')) if (line.trim() !== '') onOutput(line);
    }
  }
  if (r.error) throw new Error(`${cmd} failed to start: ${r.error.message}`);
  if (r.status !== 0) throw new Error(`${cmd} ${args[0] ?? ''} exited ${String(r.status ?? r.signal)}`);
}

function stamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function onPath(bin: string): boolean {
  try { execFileSync(bin, ['--version'], { stdio: 'ignore' }); return true; } catch { return false; }
}

/**
 * How to run pnpm inside the release: `mise exec` when the release pins toolchains in `mise.toml`
 * and mise is installed (services and non-login shells rarely have the shims on PATH), else pnpm
 * from PATH, else corepack's.
 */
function pnpm(release: string): string[] {
  if (existsSync(join(release, 'mise.toml')) && onPath('mise')) return ['mise', 'exec', '--', 'pnpm'];
  if (onPath('pnpm')) return ['pnpm'];
  if (onPath('corepack')) return ['corepack', 'pnpm'];
  throw new Error('no pnpm: install mise (the release pins node and pnpm in mise.toml) or pnpm itself');
}

export interface BuildOptions {
  from: string;
  ref: string;
  test?: boolean;
  /** The command lines themselves. */
  log: (line: string) => void;
  /** Each output line of each command, when the caller has no terminal to inherit. */
  onOutput?: (line: string) => void;
}

/** Clone, check out, install, build (and optionally test) into a fresh release directory. Returns its path. */
export function buildRelease(o: BuildOptions): { path: string; sha: string } {
  mkdirSync(releasesDir(), { recursive: true });
  const work = join(releasesDir(), `.building-${stamp()}`);
  rmSync(work, { recursive: true, force: true });
  const from = existsSync(o.from) ? resolve(o.from) : o.from;
  try {
    run('git', ['clone', '-q', '--no-checkout', from, work], releasesDir(), o.log, o.onOutput);
    run('git', ['-C', work, 'checkout', '-q', o.ref], releasesDir(), o.log, o.onOutput);
    const sha = execFileSync('git', ['-C', work, 'rev-parse', '--short=10', 'HEAD'], { encoding: 'utf8' }).trim();
    const [pm, ...pmArgs] = pnpm(work);
    run(pm!, [...pmArgs, 'install', '--frozen-lockfile'], work, o.log, o.onOutput);
    run(pm!, [...pmArgs, 'build'], work, o.log, o.onOutput);
    if (o.test) run(pm!, [...pmArgs, 'test'], work, o.log, o.onOutput);
    const final = join(releasesDir(), `${stamp()}-${sha}`);
    renameSync(work, final);
    return { path: final, sha };
  } catch (err) {
    rmSync(work, { recursive: true, force: true });
    throw err;
  }
}

function setLink(link: string, target: string): void {
  const tmp = `${link}.tmp-${process.pid}`;
  try { unlinkSync(tmp); } catch { /* none */ }
  symlinkSync(target, tmp);
  renameSync(tmp, link);
}

/** Point `current` at `path` (and `previous` at what `current` was). */
export function switchRelease(path: string): { previous: string | null } {
  mkdirSync(dataHome(), { recursive: true });
  const before = readLink(currentLink());
  if (before && before !== path) setLink(previousLink(), before);
  setLink(currentLink(), path);
  return { previous: before };
}

/** Delete releases beyond the newest `keep`, never `current` or `previous`. */
export function pruneReleases(keep: number): string[] {
  const all = listReleases().filter((r) => !r.current && !r.previous).sort((a, b) => b.name.localeCompare(a.name));
  const doomed = all.slice(Math.max(0, keep - 1));
  for (const r of doomed) rmSync(r.path, { recursive: true, force: true });
  return doomed.map((r) => basename(r.path));
}

/**
 * The commit a release directory was built from. `buildRelease` clones rather than exports, so the
 * directory keeps its `.git` and can answer exactly; the `<stamp>-<sha>` name is the fallback for a
 * release whose clone was stripped, and `null` when neither works.
 */
export function releaseSha(release: string): string | null {
  // Only the release's own clone counts. Without the `.git` check `rev-parse` would walk up and answer
  // with an unrelated ancestor repository's HEAD.
  if (existsSync(join(release, '.git'))) {
    try {
      const sha = execFileSync('git', ['-C', release, 'rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
      if (/^[0-9a-f]{40}$/.test(sha)) return sha;
    } catch { /* fall through to the directory name */ }
  }
  const m = basename(release).match(/^\d{8}-\d{6}-([0-9a-f]{7,40})$/);
  return m?.[1] ?? null;
}

/**
 * Commit subjects strictly between `from` and `to` (exclusive/inclusive, like `git log from..to`),
 * read from a release directory's own clone — it keeps its `.git`, so no second checkout is needed.
 * Empty whenever the read cannot be trusted: either sha missing, no readable `.git` (a pruned
 * release), or the shas are not related by ancestry in this clone's history. Never throws.
 */
export function commitSubjectsInRange(release: string, from: string | null, to: string | null): string[] {
  if (!from || !to || !existsSync(join(release, '.git'))) return [];
  try {
    const out = execFileSync('git', ['-C', release, 'log', '--reverse', '--format=%s', `${from}..${to}`], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    });
    return out.split('\n').map((l) => l.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

/** Short git sha used as the running version, or `'unknown'` when none can be recovered. */
export function releaseVersion(release: string): string {
  const sha = releaseSha(release);
  if (!sha) return 'unknown';
  return sha.length > 10 ? sha.slice(0, 10) : sha;
}

/** `YYYYMMDD-HHMMSS` from a named release directory, or `null`. */
export function releaseStamp(release: string): string | null {
  const m = basename(release).match(/^(\d{8}-\d{6})-/);
  return m?.[1] ?? null;
}

/**
 * The commit a git source currently has at `ref`, without cloning it and without touching anything
 * installed. `source` is a URL or a local path — both are what `upgrade.source` may hold. A `ref` that
 * is already a commit resolves to itself, because `ls-remote` does not list commits.
 */
export function resolveRemoteSha(source: string, ref: string, timeoutMs = 20_000): string {
  // Both patterns: an annotated tag's own row is the tag object, and only `<ref>^{}` peels it to a commit.
  const out = execFileSync('git', ['ls-remote', source, ref, `${ref}^{}`], {
    encoding: 'utf8', timeout: timeoutMs, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: 'echo' },
  });
  const rows = out.split('\n').map((l) => l.trim()).filter(Boolean)
    .map((l) => { const [sha = '', name = ''] = l.split(/\s+/, 2); return { sha, name }; });
  // A tag's `^{}` row is the commit it points at; prefer it over the tag object.
  const pick = rows.find((r) => r.name === `refs/tags/${ref}^{}`)
    ?? rows.find((r) => r.name === `refs/heads/${ref}`)
    ?? rows.find((r) => r.name === `refs/tags/${ref}`)
    ?? rows[0];
  if (pick?.sha) return pick.sha;
  if (/^[0-9a-f]{7,40}$/.test(ref)) return ref;
  throw new Error(`${source} has no ref ${ref}`);
}

export function serverBinIn(release: string): string { return join(release, 'packages', 'server', 'dist', 'bin.js'); }
export function cliBinIn(release: string): string { return join(release, 'packages', 'cli', 'dist', 'bin.js'); }

// ---------- restarting the daemon after a switch ----------

/** The systemd user unit and the launchd label `weave daemon install-service` writes. */
export const SERVICE_NAME = 'weave-ai.service';
export const LAUNCHD_LABEL = 'com.weave-ai.daemon';

export interface RestartEnvironment {
  platform: NodeJS.Platform;
  /** A systemd user unit exists for the daemon. */
  unitInstalled: boolean;
  /** A launchd agent plist exists for the daemon. */
  launchdInstalled: boolean;
  /** `systemd-run` is on PATH, so a helper can be moved into its own transient scope. */
  systemdRunAvailable: boolean;
  /** The uid launchd addresses the agent by; only read on darwin. */
  uid?: number;
}

export interface RestartPlan {
  /** What restarts the daemon. `null` means stop it and start it again directly. */
  restart: { cmd: string; args: string[] } | null;
  /** How the restart runner itself must be launched to outlive the restart it triggers. */
  launch: 'systemd-run' | 'detached';
  /**
   * False when the runner will be killed by the restart it triggers — a systemd user service is
   * stopped as a whole control group, so a plain detached child goes with it. The daemon that boots
   * next reconciles the record in that case; nothing rolls back automatically.
   */
  runnerSurvives: boolean;
  /** For the upgrade record and the CLI's output. */
  how: string;
}

/**
 * Decide how to restart the daemon and how to launch the runner that does it. Pure: it reads the
 * environment it is handed and spawns nothing.
 */
export function planRestart(env: RestartEnvironment): RestartPlan {
  if (env.platform === 'linux' && env.unitInstalled) {
    return {
      restart: { cmd: 'systemctl', args: ['--user', 'restart', SERVICE_NAME] },
      launch: env.systemdRunAvailable ? 'systemd-run' : 'detached',
      runnerSurvives: env.systemdRunAvailable,
      how: `systemctl --user restart ${SERVICE_NAME}`,
    };
  }
  if (env.platform === 'darwin' && env.launchdInstalled) {
    const target = `gui/${env.uid ?? 0}/${LAUNCHD_LABEL}`;
    return {
      restart: { cmd: 'launchctl', args: ['kickstart', '-k', target] },
      launch: 'detached',
      runnerSurvives: true,
      how: `launchctl kickstart -k ${target}`,
    };
  }
  return { restart: null, launch: 'detached', runnerSurvives: true, how: 'stop and start the daemon' };
}

/** Wrap a command so it runs in its own transient scope instead of the caller's control group. */
export function inOwnScope(unit: string, cmd: string, args: string[]): { cmd: string; args: string[] } {
  return { cmd: 'systemd-run', args: ['--user', '--scope', '--collect', `--unit=${unit}`, '--quiet', cmd, ...args] };
}
