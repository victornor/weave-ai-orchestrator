/** Local daemon lifecycle (PLAN §20 `oc daemon`). Everything here is host-local, never remote. */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { stateHome, configHome } from './contexts.js';

export function pidFile(): string { return join(stateHome(), 'daemon.pid'); }
export function logFile(): string { return join(stateHome(), 'daemon.log'); }

/**
 * The server bin. `@openconductor/server` is expected to export `./bin` →
 * `dist/bin.js`; the repo-relative fallbacks keep `oc daemon start` working from a source checkout
 * before the package is linked.
 */
export function resolveServerBin(): string {
  const req = createRequire(import.meta.url);
  for (const specifier of ['@openconductor/server/bin', '@openconductor/server/dist/bin.js']) {
    try { return req.resolve(specifier); } catch { /* try the next one */ }
  }
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(here, '../../server/dist/bin.js'),
    resolve(here, '../../../packages/server/dist/bin.js'),
    resolve(process.cwd(), 'packages/server/dist/bin.js'),
  ];
  for (const candidate of candidates) if (existsSync(candidate)) return candidate;
  throw new Error('cannot find the OpenConductor server: install @openconductor/server, or build it with `pnpm -r build`');
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

export interface StartOptions { foreground?: boolean; listen?: string; env?: Record<string, string> }

export interface StartResult { pid: number | null; bin: string; log: string; foreground: boolean }

export function startDaemon(options: StartOptions = {}): StartResult {
  const bin = resolveServerBin();
  mkdirSync(stateHome(), { recursive: true });
  const env = { ...process.env, ...(options.env ?? {}) } as NodeJS.ProcessEnv;
  if (options.listen) env['OC_LISTEN'] = options.listen;

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

export async function stopDaemon(timeoutMs = 10_000): Promise<{ stopped: boolean; pid: number | null }> {
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
  if (isRunning(pid)) process.kill(pid!, 'SIGKILL');
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

export const SERVICE_NAME = 'openconductor.service';

export function serviceUnitPath(): string {
  return join(process.env['XDG_CONFIG_HOME'] ?? join(homedir(), '.config'), 'systemd', 'user', SERVICE_NAME);
}

export function renderServiceUnit(bin: string): string {
  return [
    '[Unit]',
    'Description=OpenConductor daemon',
    'After=network-online.target',
    'Wants=network-online.target',
    '',
    '[Service]',
    'Type=simple',
    `ExecStart=${process.execPath} ${bin}`,
    `Environment=OC_CONFIG_HOME=${configHome()}`,
    'Restart=on-failure',
    'RestartSec=3',
    'KillSignal=SIGTERM',
    'TimeoutStopSec=30',
    '',
    '[Install]',
    'WantedBy=default.target',
    '',
  ].join('\n');
}

export const LAUNCHD_LABEL = 'com.openconductor.daemon';

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
    '    <key>OC_CONFIG_HOME</key>',
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
 * Write `~/Library/LaunchAgents/com.openconductor.daemon.plist`. On anything but macOS the plist is
 * only rendered (`written: false`) so it can be copied to a Mac by hand.
 */
export function installLaunchdAgent(): { path: string; plist: string; commands: string[]; written: boolean } {
  const bin = resolveServerBin();
  const path = launchdPlistPath();
  const plist = renderLaunchdPlist(bin);
  const written = process.platform === 'darwin';
  if (written) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, plist);
  }
  return {
    path, plist, written,
    commands: [
      `launchctl bootstrap gui/$(id -u) ${path}`,
      `launchctl kickstart -k gui/$(id -u)/${LAUNCHD_LABEL}`,
      `launchctl print gui/$(id -u)/${LAUNCHD_LABEL}`,
      `launchctl bootout gui/$(id -u)/${LAUNCHD_LABEL}   # stop and unload`,
    ],
  };
}

export function installService(): { path: string; unit: string; commands: string[] } {
  const bin = resolveServerBin();
  const path = serviceUnitPath();
  const unit = renderServiceUnit(bin);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, unit);
  return {
    path,
    unit,
    commands: [
      'systemctl --user daemon-reload',
      `systemctl --user enable --now ${SERVICE_NAME}`,
      `systemctl --user status ${SERVICE_NAME}`,
      'loginctl enable-linger "$USER"   # keep it running after logout',
    ],
  };
}
