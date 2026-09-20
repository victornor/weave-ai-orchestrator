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
import { writeCliShims, type ShimWriteResult } from './shim.js';

export * from './paths.js';
export * from './shim.js';

// ---------- the guarded host runner (VS-407) ----------

export interface CommandResult { status: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string; error?: Error }
/** One command, run and captured — never a real `systemctl`/`launchctl` invocation in a test. */
export type RunCommand = (cmd: string, args: string[]) => CommandResult;

/**
 * VS-407: the one guarded runner both the CLI and the daemon use. It refuses before spawning anything
 * when the VS-388 test guard is set, so a test that reaches a real host-lifecycle command fails loudly
 * instead of stopping the live daemon. `packages/cli` re-exports this as its `realRun`.
 */
export const realRunCommand: RunCommand = (cmd, args) => {
  assertHostCommandAllowed(cmd);
  const r = spawnSync(cmd, args, { encoding: 'utf8' });
  return { status: r.status, signal: r.signal, stdout: r.stdout ?? '', stderr: r.stderr ?? '', error: r.error };
};


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

/**
 * VS-377: write this machine's user CLI shims from the environment's own home and data home, with the
 * node that is running this process. The one call the CLI's install/upgrade and the daemon's deferred
 * upgrade make; the directory-taking `writeCliShims` is what a test calls.
 */
export function writeUserShims(): ShimWriteResult {
  return writeCliShims({ home: homedir(), dataHomeDir: dataHome(), node: process.execPath });
}

export interface WriteShimsFromReleaseOptions {
  /** How to run the release's CLI; a test replaces it so nothing is spawned. Defaults to the guarded runner. */
  run?: RunCommand;
  /** The node to run it with. Defaults to the one running this process. */
  node?: string;
  /** The writer used when the release's CLI cannot be run. Defaults to this process's own (old-release) writer. */
  fallback?: () => void;
}

/**
 * VS-631: write this machine's shims using the given release's **own** code, because an upgrade runs
 * from the release being replaced and so does not know the shims the new release adds. Runs
 * `<release>/packages/cli/dist/bin.js daemon write-shims`; when that cannot run (no CLI build, spawn
 * error or a non-zero exit) it falls back to `fallback`, preserving the pre-VS-631 behaviour for a
 * target release that predates the command. Returns whether the release's own writer ran.
 */
export function writeShimsFromRelease(release: string, o: WriteShimsFromReleaseOptions = {}): boolean {
  const bin = cliBinIn(release);
  if (existsSync(bin)) {
    const r = (o.run ?? realRunCommand)(o.node ?? process.execPath, [bin, 'daemon', 'write-shims']);
    if (!r.error && r.status === 0) return true;
  }
  (o.fallback ?? writeUserShims)();
  return false;
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
 * The migration files a release directory carries, sorted, from the build's own
 * `packages/db/dist/migrations` (the db package's build copies `src/migrations` there). Empty when the
 * release is null or its migrations cannot be read — a release directory that was pruned, or a path
 * that is not a release at all.
 */
export function migrationsIn(release: string | null): string[] {
  if (!release) return [];
  try {
    return readdirSync(join(release, 'packages', 'db', 'dist', 'migrations')).filter((f) => f.endsWith('.sql')).sort();
  } catch { return []; }
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

export interface InstalledUnit {
  /** The unit's real name on the host, e.g. `weave-ai.service` or the pre-rename `agent-conductor.service`. */
  name: string;
  path: string;
  /** True when this is the pre-rename name, not `SERVICE_NAME`. */
  legacy: boolean;
}

/** VS-316: the pre-rename systemd unit name, before the `weave-ai.service` name `SERVICE_NAME` holds. */
const LEGACY_SERVICE_NAME = 'agent-conductor.service';
/** VS-316: the pre-rename launchd label, inferred by the same naming convention `resolveInstallPath` already applies to paths — no shipped macOS install has confirmed this literal, so it is best-effort (see design.md, Decision 1). */
const LEGACY_LAUNCHD_LABEL = 'com.agent-conductor.daemon';

function systemdUserUnitDir(): string {
  return join(process.env['XDG_CONFIG_HOME'] ?? join(homedir(), '.config'), 'systemd', 'user');
}

/**
 * What is actually installed on this host, by name — the pre-rename name if it exists, else the
 * current `SERVICE_NAME`, else nothing. Never assumes the current name is what a real host has
 * (VS-316): the two used to be checked independently, one with a legacy fallback and one without,
 * which is exactly how the restart runner ended up targeting a unit that did not exist.
 *
 * Legacy wins when **both** exist (PR #265 review): an interrupted migration can leave the new unit's
 * file on disk without it ever having become the one actually running — preferring it just because the
 * file exists would make the next upgrade `systemctl restart` a unit nothing replaced, recreating the
 * exact two-daemons shape this ticket removes. Migration is safe to re-attempt from the legacy side
 * (prepare overwrites the stale file); it is not safe to assume the new side already won.
 */
export function resolveInstalledUnit(): InstalledUnit | null {
  const dir = systemdUserUnitDir();
  const legacy = join(dir, LEGACY_SERVICE_NAME);
  if (existsSync(legacy)) return { name: LEGACY_SERVICE_NAME, path: legacy, legacy: true };
  const current = join(dir, SERVICE_NAME);
  return existsSync(current) ? { name: SERVICE_NAME, path: current, legacy: false } : null;
}

// ---------- the VS-388 test guard ----------

/**
 * VS-388: the vitest setup sets this. A test run must never reach the host's user systemd — a single
 * `systemctl --user stop weave-ai.service` from `pnpm test` stops the live daemon. `realRun` refuses
 * to spawn the commands below while it is set, so a test that accidentally reaches a real runner fails
 * loudly instead of touching production.
 */
export const TEST_GUARD_ENV = 'AC_TEST_GUARD';

/** Commands that reach (or can take down) the host's service manager or kill live processes. */
const HOST_LIFECYCLE_COMMANDS = new Set(['systemctl', 'loginctl', 'launchctl', 'systemd-run', 'pkill', 'killall']);

/** Throws when the test guard is set and `cmd` would reach the host. A no-op in production. */
export function assertHostCommandAllowed(cmd: string): void {
  if (process.env[TEST_GUARD_ENV] && HOST_LIFECYCLE_COMMANDS.has(cmd)) {
    throw new Error(
      `AC_TEST_GUARD: refusing to run \`${cmd}\` from a test — it would reach the host's installed unit and can stop the live daemon. ` +
      'Inject a fake RunCommand/HostIo, or isolate XDG_CONFIG_HOME so no unit is found.',
    );
  }
}

export interface InstalledLaunchdAgent {
  label: string;
  path: string;
  legacy: boolean;
}

function launchdAgentPath(label: string): string {
  return join(homedir(), 'Library', 'LaunchAgents', `${label}.plist`);
}

/**
 * The launchd counterpart of `resolveInstalledUnit()`. Best-effort on the legacy label; see its note
 * above. Also prefers the legacy label when both exist, for the same reason.
 */
export function resolveInstalledLaunchdAgent(): InstalledLaunchdAgent | null {
  const legacy = launchdAgentPath(LEGACY_LAUNCHD_LABEL);
  if (existsSync(legacy)) return { label: LEGACY_LAUNCHD_LABEL, path: legacy, legacy: true };
  const current = launchdAgentPath(LAUNCHD_LABEL);
  return existsSync(current) ? { label: LAUNCHD_LABEL, path: current, legacy: false } : null;
}

export interface RestartEnvironment {
  platform: NodeJS.Platform;
  /** The systemd user unit actually installed, by name — `null` when none is. */
  unit: InstalledUnit | null;
  /** The launchd agent actually installed, by label — `null` when none is. */
  launchdAgent: InstalledLaunchdAgent | null;
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
  if (env.platform === 'linux' && env.unit) {
    return {
      restart: { cmd: 'systemctl', args: ['--user', 'restart', env.unit.name] },
      launch: env.systemdRunAvailable ? 'systemd-run' : 'detached',
      runnerSurvives: env.systemdRunAvailable,
      how: `systemctl --user restart ${env.unit.name}`,
    };
  }
  if (env.platform === 'darwin' && env.launchdAgent) {
    const target = `gui/${env.uid ?? 0}/${env.launchdAgent.label}`;
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

// ---------- restart safety: who is serving, and in what state (VS-407) ----------

/** One `systemctl show` read of the fields the preflight/postflight/doctor need. */
export interface UnitRuntimeState {
  activeState: string | null;
  subState: string | null;
  nRestarts: number | null;
  mainPid: number | null;
}

const EMPTY_UNIT_STATE: UnitRuntimeState = { activeState: null, subState: null, nRestarts: null, mainPid: null };

function parseCount(value: string | undefined): number | null {
  if (value === undefined || value.trim() === '') return null;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function parsePid(value: string | undefined): number | null {
  const n = parseCount(value);
  return n !== null && n > 0 ? n : null;
}

/** Pure parser for `systemctl show --property=…` `Key=Value` output. Unknown keys are ignored. */
export function parseUnitRuntimeState(output: string): UnitRuntimeState {
  const fields = new Map<string, string>();
  for (const line of output.split('\n')) {
    const i = line.indexOf('=');
    if (i > 0) fields.set(line.slice(0, i).trim(), line.slice(i + 1).trim());
  }
  return {
    activeState: fields.get('ActiveState') ?? null,
    subState: fields.get('SubState') ?? null,
    nRestarts: parseCount(fields.get('NRestarts')),
    mainPid: parsePid(fields.get('MainPID')),
  };
}

/** The installed unit's own runtime state, or all-null when it cannot be read. */
export function readUnitRuntimeState(unit: InstalledUnit, run: RunCommand = realRunCommand): UnitRuntimeState {
  const r = run('systemctl', [
    '--user', 'show', unit.name,
    '--property=ActiveState', '--property=SubState', '--property=NRestarts', '--property=MainPID',
  ]);
  if (r.error || r.status !== 0) return { ...EMPTY_UNIT_STATE };
  return parseUnitRuntimeState(r.stdout);
}

/** The port in a listen URL, or null for a unix socket / unparseable value. */
export function parseListenPort(url: string | null | undefined): number | null {
  if (!url) return null;
  let parsed: URL;
  try { parsed = new URL(url); } catch { return null; }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  if (parsed.port) return Number.parseInt(parsed.port, 10);
  return parsed.protocol === 'https:' ? 443 : 80;
}

export interface PortHolder { pid: number; command: string }

/** Parse a holder out of one `ss -ltnp` line: `users:(("node",pid=123,fd=22))`. */
export function parsePortHolder(ssOutput: string): PortHolder | null {
  for (const line of ssOutput.split('\n')) {
    const pid = /\bpid=(\d+)/.exec(line);
    if (!pid?.[1]) continue;
    const cmd = /\(\("([^"]+)"/.exec(line)?.[1] ?? '';
    return { pid: Number.parseInt(pid[1], 10), command: cmd };
  }
  return null;
}

/** Parse a holder out of `lsof -nP -iTCP:<port> -sTCP:LISTEN` output (header skipped). */
export function parseLsofHolder(lsofOutput: string): PortHolder | null {
  for (const line of lsofOutput.split('\n').slice(1)) {
    const cols = line.trim().split(/\s+/);
    if (cols.length < 2) continue;
    const pid = Number.parseInt(cols[1]!, 10);
    if (Number.isFinite(pid) && pid > 0) return { pid, command: cols[0]! };
  }
  return null;
}

/**
 * Who holds `port`, or null when nothing does. `ss` first (present on most modern Linux hosts), then
 * `lsof` (the macOS-native one). Both are optional: a host without either simply reports nothing.
 */
export function findPortHolder(port: number, run: RunCommand): PortHolder | null {
  const ss = run('ss', ['-ltnpH', `sport = :${port}`]);
  if (!ss.error && ss.status === 0) {
    const holder = parsePortHolder(ss.stdout);
    if (holder) return holder;
  }
  const lsof = run('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN']);
  if (!lsof.error && lsof.status === 0) {
    const holder = parseLsofHolder(lsof.stdout);
    if (holder) return holder;
  }
  return null;
}

/** Does this process command line name this product's server entry point? */
export function isServerProcessCmdline(cmdline: string): boolean {
  return cmdline.replace(/\0/g, ' ').includes(join('packages', 'server', 'dist', 'bin.js'));
}

export type ListenHolderKind = 'none' | 'unit' | 'detached' | 'other';

export interface RestartConflict {
  kind: ListenHolderKind;
  /** The pid holding the listen address, when one is known. */
  pid: number | null;
  command: string | null;
}

/**
 * VS-407: who holds the daemon's listen address, relative to the installed unit. Pure — the caller
 * supplies the port holder, the unit's main pid, and the pids already verified as this product's own
 * tracked daemons (from `daemon.pid`/`daemon.json`). `detached` means the local CLI may hand over;
 * `other` means refuse.
 */
export function classifyRestart(input: {
  unit: InstalledUnit | null;
  holder: PortHolder | null;
  unitMainPid: number | null;
  trackedPids: number[];
}): RestartConflict {
  const { unit, holder, unitMainPid, trackedPids } = input;
  const pid = holder?.pid ?? null;
  const command = holder?.command ?? null;
  if (!unit) return { kind: 'none', pid, command };
  if (!holder) {
    // Nothing is listening: a unit restart will bind freely, whatever stale records remain.
    return { kind: 'none', pid: null, command: null };
  }
  if (unitMainPid !== null && holder.pid === unitMainPid) return { kind: 'unit', pid, command };
  if (trackedPids.includes(holder.pid)) return { kind: 'detached', pid, command };
  return { kind: 'other', pid, command };
}

