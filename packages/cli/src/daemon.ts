/** Local daemon lifecycle (PLAN §20 `weave daemon`). Everything here is host-local, never remote. */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { SHUTDOWN_KILL_GRACE_MS } from '@weave-ai/shared';
import { stateHome, configHome } from './contexts.js';
import { LAUNCHD_LABEL, SERVICE_NAME, classifyRestart, currentLink, findPortHolder, isServerProcessCmdline, parseListenPort, readUnitRuntimeState, realRunCommand, resolveInstalledUnit, writeUserShims, type CommandResult, type InstalledUnit, type RestartConflict, type RunCommand, type ShimWriteResult, type UnitRuntimeState } from './release.js';

export function pidFile(): string { return join(stateHome(), 'daemon.pid'); }
export function logFile(): string { return join(stateHome(), 'daemon.log'); }

/**
 * The server bin. `@weave-ai/server` is expected to export `./bin` →
 * `dist/bin.js`; the repo-relative fallbacks keep `weave daemon start` working from a source checkout
 * before the package is linked.
 */
export function resolveServerBin(): string {
  // A release install always wins: the service must follow the `current` symlink, not a checkout.
  const current = currentLink();
  if (existsSync(join(current, 'packages', 'server', 'dist', 'bin.js'))) return join(current, 'packages', 'server', 'dist', 'bin.js');
  const req = createRequire(import.meta.url);
  for (const specifier of ['@weave-ai/server/bin', '@weave-ai/server/dist/bin.js']) {
    try { return req.resolve(specifier); } catch { /* try the next one */ }
  }
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(here, '../../server/dist/bin.js'),
    resolve(here, '../../../packages/server/dist/bin.js'),
    resolve(process.cwd(), 'packages/server/dist/bin.js'),
  ];
  for (const candidate of candidates) if (existsSync(candidate)) return candidate;
  throw new Error('cannot find the Weave AI server: install @weave-ai/server, or build it with `pnpm -r build`');
}

export function readPid(): number | null {
  try {
    const raw = readFileSync(pidFile(), 'utf8').trim();
    const pid = Number.parseInt(raw, 10);
    return Number.isFinite(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

export function isRunning(pid: number | null): boolean {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

export type { CommandResult, RunCommand } from './release.js';
/**
 * VS-407: the guarded runner moved to `@weave-ai/release` so the daemon can use the same one. Kept
 * exported here under its old name for the CLI's many call sites.
 */
export const realRun: RunCommand = realRunCommand;

export interface StartOptions { foreground?: boolean; listen?: string; env?: Record<string, string> }

export interface StartResult { pid: number | null; bin: string; log: string; foreground: boolean }

export function startDaemon(options: StartOptions = {}): StartResult {
  const bin = resolveServerBin();
  mkdirSync(stateHome(), { recursive: true });
  const env = { ...process.env, ...(options.env ?? {}) } as NodeJS.ProcessEnv;
  if (options.listen) env['AC_LISTEN'] = options.listen;

  if (options.foreground) {
    const child = spawn(process.execPath, [bin], { stdio: 'inherit', env });
    child.on('exit', (code) => { process.exitCode = code ?? 0; });
    return { pid: child.pid ?? null, bin, log: logFile(), foreground: true };
  }

  const out = openSync(logFile(), 'a');
  const child = spawn(process.execPath, [bin], { detached: true, stdio: ['ignore', out, out], env });
  child.unref();
  if (child.pid) writeFileSync(pidFile(), String(child.pid));
  return { pid: child.pid ?? null, bin, log: logFile(), foreground: false };
}

/**
 * VS-262: the default timeout is `SHUTDOWN_KILL_GRACE_MS`, not an arbitrary short number — it has to
 * comfortably exceed `shutdown()`'s own bounded drain-then-cancel sequence
 * (`packages/server/src/daemon.ts`), or `SIGKILL` arrives while the daemon is still shutting down
 * gracefully on its own. See this ticket's design.md, Decision 2.
 */
export async function stopDaemon(timeoutMs = SHUTDOWN_KILL_GRACE_MS): Promise<{ stopped: boolean; pid: number | null }> {
  const pid = readPid();
  if (!isRunning(pid)) {
    rmSync(pidFile(), { force: true });
    return { stopped: false, pid };
  }
  process.kill(pid!, 'SIGTERM');
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isRunning(pid)) break;
    await new Promise((r) => setTimeout(r, 150));
  }
  if (isRunning(pid)) {
    process.kill(pid!, 'SIGKILL');
    // VS-316: SIGKILL is not synchronous — give the kernel a moment to reap it before trusting it worked.
    for (let i = 0; i < 10 && isRunning(pid); i++) await new Promise((r) => setTimeout(r, 50));
    if (isRunning(pid)) throw new Error(`pid ${pid} is still running after SIGKILL`);
  }
  rmSync(pidFile(), { force: true });
  return { stopped: true, pid };
}

export function tailLog(lines: number): string[] {
  try {
    const content = readFileSync(logFile(), 'utf8').split('\n');
    return content.slice(Math.max(0, content.length - lines - 1)).filter((l) => l !== '');
  } catch {
    return [];
  }
}

export function followLog(onLine: (line: string) => void): { close(): void } {
  const child = spawn('tail', ['-n', '40', '-F', logFile()], { stdio: ['ignore', 'pipe', 'ignore'] });
  let buffer = '';
  child.stdout?.on('data', (chunk: Buffer) => {
    buffer += chunk.toString('utf8');
    let idx: number;
    while ((idx = buffer.indexOf('\n')) !== -1) {
      onLine(buffer.slice(0, idx));
      buffer = buffer.slice(idx + 1);
    }
  });
  return { close() { child.kill(); } };
}

export { LAUNCHD_LABEL, SERVICE_NAME };

export function serviceUnitPath(): string {
  return join(process.env['XDG_CONFIG_HOME'] ?? join(homedir(), '.config'), 'systemd', 'user', SERVICE_NAME);
}

export function renderServiceUnit(bin: string): string {
  return [
    '[Unit]',
    'Description=Weave AI daemon',
    'After=network-online.target',
    'Wants=network-online.target',
    '',
    '[Service]',
    'Type=simple',
    `ExecStart=${process.execPath} ${bin}`,
    `Environment=AC_CONFIG_HOME=${configHome()}`,
    // VS-376: `always`, not `on-failure` — the incident's daemon drained and exited 0, which
    // `on-failure` treats as success and leaves down. A deliberate `systemctl --user stop` is still
    // honoured by systemd and is not restarted.
    'Restart=always',
    'RestartSec=3',
    'KillSignal=SIGTERM',
    // VS-262: must comfortably exceed shutdown()'s own bounded drain-then-cancel sequence — see
    // stopDaemon's default and this ticket's design.md, Decision 2.
    `TimeoutStopSec=${Math.ceil(SHUTDOWN_KILL_GRACE_MS / 1000)}`,
    '',
    '[Install]',
    'WantedBy=default.target',
    '',
  ].join('\n');
}

export function launchdPlistPath(): string {
  return join(homedir(), 'Library', 'LaunchAgents', `${LAUNCHD_LABEL}.plist`);
}

/** A LaunchAgent for macOS: same daemon, same config home, restarted on failure, logging to the CLI's log file. */
export function renderLaunchdPlist(bin: string): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    '<dict>',
    '  <key>Label</key>',
    `  <string>${LAUNCHD_LABEL}</string>`,
    '  <key>ProgramArguments</key>',
    '  <array>',
    `    <string>${process.execPath}</string>`,
    `    <string>${bin}</string>`,
    '  </array>',
    '  <key>EnvironmentVariables</key>',
    '  <dict>',
    '    <key>AC_CONFIG_HOME</key>',
    `    <string>${configHome()}</string>`,
    '  </dict>',
    '  <key>RunAtLoad</key>',
    '  <true/>',
    '  <key>KeepAlive</key>',
    '  <dict>',
    '    <key>SuccessfulExit</key>',
    '    <false/>',
    '  </dict>',
    '  <key>ProcessType</key>',
    '  <string>Background</string>',
    '  <key>StandardOutPath</key>',
    `  <string>${logFile()}</string>`,
    '  <key>StandardErrorPath</key>',
    `  <string>${logFile()}</string>`,
    '</dict>',
    '</plist>',
    '',
  ].join('\n');
}

/**
 * Write `~/Library/LaunchAgents/com.weave-ai.daemon.plist`. On anything but macOS the plist is
 * only rendered (`written: false`) so it can be copied to a Mac by hand.
 */
export function installLaunchdAgent(): { path: string; plist: string; commands: string[]; written: boolean; shim: ShimWriteResult | null } {
  const bin = resolveServerBin();
  const path = launchdPlistPath();
  const plist = renderLaunchdPlist(bin);
  const written = process.platform === 'darwin';
  let shim: ShimWriteResult | null = null;
  if (written) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, plist);
    // VS-377: installing the service is the install moment — put `weave` on PATH too.
    shim = writeUserShims();
  }
  return {
    path, plist, written, shim,
    commands: [
      `launchctl bootstrap gui/$(id -u) ${path}`,
      `launchctl kickstart -k gui/$(id -u)/${LAUNCHD_LABEL}`,
      `launchctl print gui/$(id -u)/${LAUNCHD_LABEL}`,
      `launchctl bootout gui/$(id -u)/${LAUNCHD_LABEL}   # stop and unload`,
    ],
  };
}

export function installService(): { path: string; unit: string; commands: string[]; shim: ShimWriteResult } {
  const bin = resolveServerBin();
  const path = serviceUnitPath();
  const unit = renderServiceUnit(bin);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, unit);
  // VS-377: installing the service is the install moment — put `weave` on PATH too.
  const shim = writeUserShims();
  return {
    path,
    unit,
    shim,
    commands: [
      'systemctl --user daemon-reload',
      `systemctl --user enable --now ${SERVICE_NAME}`,
      `systemctl --user status ${SERVICE_NAME}`,
      'loginctl enable-linger "$USER"   # keep it running after logout',
    ],
  };
}

// ---------- the systemd unit a host already has (VS-376) ----------

/** The one `Restart=` value the unit must carry so an unexpected exit — clean or not — comes back. */
export const RESTART_ALWAYS = 'Restart=always';

/**
 * VS-376: pure — force an existing `Restart=` line to `always`. A unit with no `Restart=` line at
 * all is left untouched: every unit this module renders carries one, and the state this fixes is the
 * `on-failure` value a host installed before this ticket, which treats a clean exit as success.
 */
export function withRestartAlways(content: string): string {
  return content.replace(/^Restart=(.*)$/m, (line, value: string) => (value.trim() === 'always' ? line : RESTART_ALWAYS));
}

export interface UnitRestartRewrite { unit: string; path: string; changed: boolean }

/**
 * VS-376: rewrite an installed unit that still restarts only on failure, then reload systemd so the
 * change takes effect. `null` when no unit is installed; `changed: false` when the unit already
 * restarts on any exit. The reload is best-effort — a corrected file is worth writing even where the
 * reload itself cannot run.
 */
export function ensureUnitRestartAlways(run: RunCommand = realRun, unit: InstalledUnit | null = resolveInstalledUnit()): UnitRestartRewrite | null {
  if (!unit) return null;
  let content: string;
  try { content = readFileSync(unit.path, 'utf8'); } catch { return null; }
  const next = withRestartAlways(content);
  if (next === content) return { unit: unit.name, path: unit.path, changed: false };
  writeFileSync(unit.path, next);
  run('systemctl', ['--user', 'daemon-reload']);
  return { unit: unit.name, path: unit.path, changed: true };
}

/** VS-376: systemd's own record of the pid a unit currently owns, or null when it has none. */
export function systemdMainPid(unit: InstalledUnit, run: RunCommand = realRun): number | null {
  const r = run('systemctl', ['--user', 'show', unit.name, '--property=MainPID', '--value']);
  if (r.error || r.status !== 0) return null;
  const pid = Number.parseInt(r.stdout.trim(), 10);
  return Number.isFinite(pid) && pid > 0 ? pid : null;
}

function runUnitVerb(verb: 'start' | 'stop', unit: InstalledUnit, run: RunCommand): void {
  const r = run('systemctl', ['--user', verb, unit.name]);
  if (r.error) throw new Error(`systemctl failed to ${verb}: ${r.error.message}`);
  if (r.status !== 0) {
    const detail = (r.stderr || r.stdout).trim().slice(0, 2000);
    throw new Error(`systemctl --user ${verb} ${unit.name} exited ${String(r.status ?? r.signal)}${detail ? `: ${detail}` : ''}`);
  }
}

/**
 * VS-376: start the daemon through its installed unit, so it is a service that survives the caller's
 * terminal and that `systemctl` can see. `null` when no unit is installed — the caller then spawns
 * the detached process exactly as before.
 */
export function startDaemonService(run: RunCommand = realRun, platform: NodeJS.Platform = process.platform): { unit: string; how: string } | null {
  const unit = platform === 'linux' ? resolveInstalledUnit() : null;
  if (!unit) return null;
  runUnitVerb('start', unit, run);
  return { unit: unit.name, how: `systemctl --user start ${unit.name}` };
}

/**
 * VS-376: stop the installed unit deliberately. A bare `SIGTERM` to the daemon's pid would be
 * restarted by `Restart=always`; `systemctl --user stop` is the "deliberate stop" systemd honours.
 */
export function stopDaemonService(run: RunCommand = realRun, platform: NodeJS.Platform = process.platform): { unit: string; how: string } | null {
  const unit = platform === 'linux' ? resolveInstalledUnit() : null;
  if (!unit) return null;
  runUnitVerb('stop', unit, run);
  return { unit: unit.name, how: `systemctl --user stop ${unit.name}` };
}

// ---------- restart safety: the detached daemon and the listen address (VS-407) ----------

/** The daemon's own boot marker (`daemon.json`), or null when it has not written one. */
export interface DaemonMarker { pid?: number; publicUrl?: string; loopbackUrl?: string; setupRequired?: boolean }
export function readDaemonMarker(): DaemonMarker | null {
  try { return JSON.parse(readFileSync(join(configHome(), 'daemon.json'), 'utf8')) as DaemonMarker; } catch { return null; }
}

/** The port the daemon listens on, from its marker (loopback first), or null when unknown. */
export function listenPort(marker: DaemonMarker | null = readDaemonMarker()): number | null {
  return parseListenPort(marker?.loopbackUrl) ?? parseListenPort(marker?.publicUrl);
}

/** One process's command line, `/proc/<pid>/cmdline` by default. */
export type ReadCmdline = (pid: number) => string;
export const realReadCmdline: ReadCmdline = (pid) => readFileSync(`/proc/${pid}/cmdline`, 'utf8');

export interface RestartSafetyIo {
  run: RunCommand;
  unit: InstalledUnit | null;
  port: number | null;
  /** pids named by `daemon.pid`/`daemon.json` that are alive and verified as this product's server. */
  trackedPids: number[];
  unitMainPid: number | null;
}

/**
 * The pids this machine's own records name for a daemon, kept only when alive and confirmed to be this
 * product's server. A pid that is not verified is dropped, so it can never be signalled or mistaken for
 * the unit's process.
 */
export function verifiedTrackedPids(o: { pids: Array<number | null>; alive?: (pid: number) => boolean; cmdline?: ReadCmdline } = { pids: [] }): number[] {
  const alive = o.alive ?? isRunning;
  const cmdline = o.cmdline ?? realReadCmdline;
  const out: number[] = [];
  for (const pid of o.pids) {
    if (pid === null || !alive(pid)) continue;
    let line = '';
    try { line = cmdline(pid); } catch { continue; }
    if (isServerProcessCmdline(line)) out.push(pid);
  }
  return out;
}

/**
 * Who holds the daemon's listen address, relative to the installed unit (VS-407). Runs the real host
 * primitives unless each is supplied; the local CLI uses this to decide between a handover, a refusal
 * and proceeding, and `weave doctor` uses it to report.
 */
export function assessListenConflict(o: {
  run?: RunCommand; unit?: InstalledUnit | null; port?: number | null;
  trackedPids?: number[]; unitMainPid?: number | null;
} = {}): RestartConflict {
  const run = o.run ?? realRun;
  const unit = o.unit === undefined ? (process.platform === 'linux' ? resolveInstalledUnit() : null) : o.unit;
  const port = o.port === undefined ? listenPort() : o.port;
  const unitMainPid = o.unitMainPid === undefined ? (unit ? systemdMainPid(unit, run) : null) : o.unitMainPid;
  const trackedPids = o.trackedPids ?? verifiedTrackedPids({ pids: [readPid(), readDaemonMarker()?.pid ?? null] });
  const holder = port === null ? null : findPortHolder(port, run);
  return classifyRestart({ unit, holder, unitMainPid, trackedPids });
}

export interface ReconcileResult {
  reconciled: boolean;
  pid: number | null;
  reason: string;
}
/**
 * VS-407: hand a detached daemon over to the installed unit. A human `stop`/`restart`/`upgrade`/`start`
 * calls this: when a unit is installed and a live tracked pid is confirmed to be this product's server
 * **and** holds the listen address, that exact pid is `SIGTERM`ed, the wait is bounded until it exits
 * and the address is free, and the stale pid file is removed. It never signals anything it cannot
 * positively identify, and never matches by name or pattern.
 *
 * The daemon's own deferred self-upgrade and `weave doctor` must NOT call this — they refuse or report.
 */
export async function reconcileDetachedDaemon(o: {
  run?: RunCommand; unit?: InstalledUnit | null; port?: number | null; pid?: number | null;
  alive?: (pid: number) => boolean; cmdline?: ReadCmdline; signal?: (pid: number, signal: NodeJS.Signals) => void;
  readCgroup?: ReadCgroup; sleep?: (ms: number) => Promise<void>; now?: () => number; timeoutMs?: number;
} = {}): Promise<ReconcileResult> {
  const run = o.run ?? realRun;
  const alive = o.alive ?? isRunning;
  const cmdline = o.cmdline ?? realReadCmdline;
  const readCgroup = o.readCgroup ?? realReadCgroup;
  const signal = o.signal ?? ((pid, sig) => { process.kill(pid, sig); });
  const sleep = o.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const now = o.now ?? (() => Date.now());
  const unit = o.unit === undefined ? (process.platform === 'linux' ? resolveInstalledUnit() : null) : o.unit;
  const pid = o.pid === undefined ? readPid() : o.pid;
  const port = o.port === undefined ? listenPort() : o.port;
  const fail = (reason: string): ReconcileResult => ({ reconciled: false, pid: null, reason });

  if (!unit) return fail('no service unit is installed');
  if (pid === null || !alive(pid)) return fail('no live detached daemon is recorded');

  // The unit's own process must never be signalled, and a reused pid can now belong to it. Refuse
  // unless the unit's process can be positively identified *and* is a different pid.
  //
  // A readable state with `MainPID=0` is NOT "unidentifiable": a stopped, failed or crash-looping unit
  // (the 2026-09-14 incident) has no main pid between restarts, and handover is exactly for that case.
  // Only an unreadable state, a cgroup that names the unit, or no MainPID with no readable cgroup —
  // nothing at all proving the pid isn't the unit's — refuses.
  const state = readUnitRuntimeState(unit, run);
  if (state.activeState === null && state.mainPid === null) return fail(`the installed unit ${unit.name}'s state could not be read; refusing to signal until its process can be identified`);
  if (pid === state.mainPid) return fail('the recorded pid is the unit\'s own process');
  let cgroup: string | null = null;
  try { cgroup = readCgroup(pid); } catch { cgroup = null; }
  if (cgroup !== null && cgroup.includes(unit.name)) return fail(`pid ${pid} belongs to ${unit.name}`);
  if (cgroup === null && state.mainPid === null) return fail(`pid ${pid} is not proven to be outside ${unit.name} (no main pid and its cgroup cannot be read); refusing to signal`);

  let line = '';
  try { line = cmdline(pid); } catch { return fail(`pid ${pid} could not be inspected`); }
  if (!isServerProcessCmdline(line)) return fail(`pid ${pid} is not this product's server`);
  if (port === null) return fail('the daemon\'s listen address could not be determined');
  const holder = findPortHolder(port, run);
  if (!holder || holder.pid !== pid) return fail(`pid ${pid} does not hold the listen address`);

  signal(pid, 'SIGTERM');
  const deadline = now() + (o.timeoutMs ?? 20_000);
  while (now() < deadline) {
    const stillHolding = findPortHolder(port, run);
    if (!alive(pid) && !stillHolding) break;
    await sleep(200);
  }
  if (alive(pid) || findPortHolder(port, run)) return fail(`pid ${pid} did not exit within ${Math.round((o.timeoutMs ?? 20_000) / 1000)}s`);
  rmSync(pidFile(), { force: true });
  return { reconciled: true, pid, reason: `gracefully stopped the detached daemon pid ${pid}` };
}

// ---------- restart safety: preflight and postflight verdicts (VS-407) ----------

export interface RestartTarget { release: string; sha: string | null }

export type PreflightVerdict =
  | { ok: true; handover: ReconcileResult }
  | { ok: false; pid: number | null; message: string };

/**
 * VS-407: hand a detached daemon over, then refuse an unidentifiable process on the listen address.
 * The human `stop`/`restart`/`upgrade` commands run this; the daemon's own self-upgrade refuses without
 * signalling instead.
 */
export async function preflightRestart(o: {
  reconcile?: () => Promise<ReconcileResult>;
  assess?: () => RestartConflict;
  unit?: InstalledUnit | null;
} = {}): Promise<PreflightVerdict> {
  const reconcile = o.reconcile ?? (() => reconcileDetachedDaemon());
  const assess = o.assess ?? (() => assessListenConflict());
  const unit = o.unit === undefined ? (process.platform === 'linux' ? resolveInstalledUnit() : null) : o.unit;
  const handover = await reconcile();
  const conflict = assess();
  if (conflict.kind === 'other' || conflict.kind === 'detached') {
    const who = conflict.pid ? `pid ${conflict.pid}${conflict.command ? ` (${conflict.command})` : ''}` : 'an unidentified process';
    const why = conflict.kind === 'detached' && !handover.reconciled ? ` — ${handover.reason}` : '';
    return {
      ok: false,
      pid: conflict.pid,
      message: `refusing to restart: ${who} is holding the daemon's listen address${unit ? ` outside ${unit.name}` : ''}${why}. The unit cannot bind until that process stops; stop it by hand, then retry.`,
    };
  }
  return { ok: true, handover };
}

/** Does the daemon that answered serve the restart's target release? */
export function onTargetRelease(h: OwnHealth, target: RestartTarget): boolean {
  if (h.releasePath && h.releasePath === target.release) return true;
  return Boolean(target.sha && h.releaseSha && h.releaseSha === target.sha);
}

export type VerifyVerdict = { ok: true; version: string | null } | { ok: false; message: string };

export interface VerifyRestartIo {
  unit: InstalledUnit | null;
  target: RestartTarget;
  /** The pid this process started, when there is no unit to consult. */
  startedPid: number | null;
  readUnitState?: (unit: InstalledUnit) => UnitRuntimeState;
  probe?: () => Promise<OwnHealth | null>;
  owned?: (unit: InstalledUnit, pid: number) => boolean | null;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  timeoutMs?: number;
}

/**
 * VS-407: a restart is only verified when the unit is `active (running)` without a restart loop, the
 * process answering is the unit's own (or the pid this process started), and it serves the target
 * release. A leftover daemon answering the same release on restart/rollback does not count.
 */
export async function verifyRestart(o: VerifyRestartIo): Promise<VerifyVerdict> {
  const readUnitState = o.readUnitState ?? ((unit) => readUnitRuntimeState(unit));
  const probe = o.probe ?? (() => probeOwnHealth());
  const owned = o.owned ?? ((unit, pid) => pidOwnedByUnit(unit, pid));
  const sleep = o.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const now = o.now ?? (() => Date.now());
  const deadline = now() + (o.timeoutMs ?? 30_000);
  let last: OwnHealth | null = null;
  let crashLoop = false;
  let prevRestarts: number | null = null;
  let lastState: string | null = null;
  while (now() < deadline) {
    let unitActive = true;
    if (o.unit) {
      const st = readUnitState(o.unit);
      if (st.nRestarts !== null && prevRestarts !== null && st.nRestarts > prevRestarts) crashLoop = true;
      if (st.activeState === 'failed') crashLoop = true;
      prevRestarts = st.nRestarts;
      lastState = st.activeState ? `${st.activeState}${st.subState ? `/${st.subState}` : ''}` : null;
      unitActive = st.activeState === 'active' && st.subState === 'running';
    }
    const h = await probe();
    if (h?.ok) {
      last = h;
      const pidOk = o.unit
        ? (h.pid === null ? true : owned(o.unit, h.pid) !== false)
        : (o.startedPid === null || h.pid === o.startedPid);
      if (onTargetRelease(h, o.target) && pidOk && unitActive) return { ok: true, version: h.version };
    }
    await sleep(500);
  }
  const cause = crashLoop
    ? 'service crash-looping'
    : last
      ? `release ${last.releaseSha ?? last.releasePath ?? '?'} is serving, not the target release`
      : 'no healthy daemon answered';
  return { ok: false, message: `the restart did not take: ${cause}${lastState ? ` (unit ${lastState})` : ''}` };
}

/** One `/proc/<pid>/cgroup` read — never a real one in a test. */
export type ReadCgroup = (pid: number) => string;
export const realReadCgroup: ReadCgroup = (pid) => readFileSync(`/proc/${pid}/cgroup`, 'utf8');

/**
 * VS-407: whether `pid` is the installed unit's own process — its `MainPID`, or (when that does not
 * already say so) a process whose cgroup names the unit. `true`/`false` are definite; `null` means this
 * host cannot tell, matching `driveRestart`'s VS-316 rule, and the caller accepts the release match.
 */
export function pidOwnedByUnit(unit: InstalledUnit, pid: number, run: RunCommand = realRun, readCgroup: ReadCgroup = realReadCgroup): boolean | null {
  const mainPid = systemdMainPid(unit, run);
  if (mainPid !== null) {
    if (mainPid === pid) return true;
    try { return readCgroup(pid).includes(unit.name); } catch { return null; }
  }
  try { return readCgroup(pid).includes(unit.name); } catch { return null; }
}

export interface OwnHealth { ok: boolean; version: string | null; releasePath: string | null; releaseSha: string | null; pid: number | null }

/**
 * VS-407: the daemon's own health, read from the address it wrote into `daemon.json` rather than the
 * configured context — the incident's context URL was unreachable while the daemon served, so the
 * configured context cannot be trusted to say what is actually running.
 */
export async function probeOwnHealth(marker: DaemonMarker | null = readDaemonMarker()): Promise<OwnHealth | null> {
  const base = marker?.loopbackUrl ?? marker?.publicUrl;
  if (!base) return null;
  try {
    const res = await fetch(new URL('/api/health', base), { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return null;
    const body = await res.json() as { ok?: boolean; version?: string; pid?: number; release?: { path?: string; sha?: string | null } };
    return {
      ok: Boolean(body.ok), version: body.version ?? null,
      releasePath: body.release?.path ?? null, releaseSha: body.release?.sha ?? null,
      pid: typeof body.pid === 'number' ? body.pid : null,
    };
  } catch {
    return null;
  }
}

// ---------- `weave doctor`'s daemon-host checks (VS-407) ----------

export interface LocalDaemonCheck { name: string; ok: boolean | null; detail: string; fix?: string }

/**
 * VS-407: `weave doctor`'s "local daemon process" check. A unit-started daemon writes `daemon.json`,
 * not `daemon.pid`, so the old check falsely warned "not started from this machine"; a unit whose
 * `MainPID` is live reads healthy instead, and a tracked daemon running alongside the unit warns.
 */
export function localDaemonCheck(o: {
  platform?: NodeJS.Platform; unit?: InstalledUnit | null; pid?: number | null;
  alive?: (pid: number) => boolean; run?: RunCommand; port?: number | null; unitState?: UnitRuntimeState;
} = {}): LocalDaemonCheck {
  const platform = o.platform ?? process.platform;
  const unit = o.unit === undefined ? (platform === 'linux' ? resolveInstalledUnit() : null) : o.unit;
  const pid = o.pid === undefined ? readPid() : o.pid;
  const running = pid !== null && (o.alive ?? isRunning)(pid);
  const notStarted: LocalDaemonCheck = { name: 'local daemon process', ok: null, detail: 'not started from this machine', fix: 'weave daemon start' };
  if (!unit) {
    return running ? { name: 'local daemon process', ok: true, detail: `running (pid ${pid})` } : notStarted;
  }
  const state = o.unitState ?? readUnitRuntimeState(unit, o.run ?? realRun);
  const mainPid = state.mainPid;
  if (running && pid !== mainPid) {
    return {
      name: 'local daemon process', ok: null,
      detail: `detached daemon pid ${pid} is running alongside ${unit.name}`,
      fix: `weave daemon restart  # hands the detached daemon over to ${unit.name}`,
    };
  }
  if (state.activeState === 'active' && (mainPid !== null || running)) {
    return { name: 'local daemon process', ok: true, detail: `unit-managed (${unit.name}${mainPid ? ` pid ${mainPid}` : ''})` };
  }
  return notStarted;
}

/**
 * VS-407: `weave doctor`'s two new host checks — an installed unit in a restart loop, and an
 * unidentifiable process holding the daemon's listen address. Gated by the caller on the confirmed
 * local daemon host, so a client never reports on a unit it does not own.
 */
export function restartSafetyChecks(o: {
  unit?: InstalledUnit | null; run?: RunCommand; port?: number | null;
  trackedPids?: number[]; unitMainPid?: number | null; unitState?: UnitRuntimeState;
} = {}): LocalDaemonCheck[] {
  const platform = process.platform;
  const unit = o.unit === undefined ? (platform === 'linux' ? resolveInstalledUnit() : null) : o.unit;
  if (!unit) return [];
  const run = o.run ?? realRun;
  const state = o.unitState ?? readUnitRuntimeState(unit, run);
  const checks: LocalDaemonCheck[] = [];
  if (state.activeState === 'activating' || state.activeState === 'failed') {
    checks.push({
      name: 'systemd unit restart loop', ok: false,
      detail: `${unit.name} is ${state.activeState}${state.subState ? `/${state.subState}` : ''}${state.nRestarts !== null ? ` after ${state.nRestarts} restart(s)` : ''}`,
      fix: `systemctl --user status ${unit.name}   # then stop it: weave daemon stop`,
    });
  } else if ((state.nRestarts ?? 0) > 0) {
    checks.push({
      name: 'systemd unit restarts', ok: null,
      detail: `${unit.name} has restarted ${state.nRestarts} time(s)`,
      fix: `a count that keeps climbing is a crash loop; check the journal: journalctl --user -u ${unit.name} -n 50`,
    });
  }
  const conflict = assessListenConflict({ run, unit, port: o.port, trackedPids: o.trackedPids, unitMainPid: o.unitMainPid ?? state.mainPid });
  if (conflict.kind === 'other' || conflict.kind === 'detached') {
    checks.push({
      name: 'daemon on the listen address', ok: false,
      detail: `pid ${conflict.pid}${conflict.command ? ` (${conflict.command})` : ''} is holding the daemon's address outside ${unit.name}`,
      fix: conflict.kind === 'detached'
        ? `weave daemon restart  # hands the detached daemon over to ${unit.name}`
        : 'stop that pid by hand; the unit cannot bind while it holds the address',
    });
  }
  return checks;
}
