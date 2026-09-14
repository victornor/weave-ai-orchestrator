/** Local daemon lifecycle (PLAN §20 `weave daemon`). Everything here is host-local, never remote. */
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { SHUTDOWN_KILL_GRACE_MS } from '@weave-ai/shared';
import { stateHome, configHome } from './contexts.js';
import { LAUNCHD_LABEL, SERVICE_NAME, assertHostCommandAllowed, currentLink, resolveInstalledUnit, writeUserShims, type InstalledUnit, type ShimWriteResult } from './release.js';

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

export interface CommandResult { status: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string; error?: Error }
/** One command, run and captured — never a real `systemctl`/`launchctl` invocation in a test. */
export type RunCommand = (cmd: string, args: string[]) => CommandResult;

export const realRun: RunCommand = (cmd, args) => {
  // VS-388: refuse before spawning anything — a test that reaches this must fail, not stop the host.
  assertHostCommandAllowed(cmd);
  const r = spawnSync(cmd, args, { encoding: 'utf8' });
  return { status: r.status, signal: r.signal, stdout: r.stdout ?? '', stderr: r.stderr ?? '', error: r.error };
};

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
