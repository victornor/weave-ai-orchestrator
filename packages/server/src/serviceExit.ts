/**
 * How the previous daemon process ended, as the service manager recorded it (VS-955,
 * `daemon-restart/restart-announcement`).
 *
 * A process that crashes cannot record its own shutdown, but systemd can: the journal keeps, per unit
 * invocation, a "Main process exited" entry with `EXIT_CODE`/`EXIT_STATUS`, a "Failed with result"
 * entry with `UNIT_RESULT`, and a "Scheduled restart job" entry with `N_RESTARTS`. Each is matched by
 * its documented `MESSAGE_ID`, never by the message text. The daemon records its own `INVOCATION_ID`
 * at boot, so the next boot asks the journal for exactly that invocation.
 *
 * Everything here is best effort: no `journalctl`, a volatile journal, a timeout or an unparsable line
 * all return null, and the restart notice then reports the exit as unknown.
 */
import { spawn } from 'node:child_process';
import { constants } from 'node:os';
import type { ServiceExit } from '@weave-ai/shared';

/** sd-messages.h: SD_MESSAGE_UNIT_PROCESS_EXIT, SD_MESSAGE_UNIT_FAILURE_RESULT, SD_MESSAGE_UNIT_RESTART_SCHEDULED. */
const MESSAGE = {
  processExit: '98e322203f7a4ed290d09fe03c09fe15',
  failureResult: 'd9b373ed55a64feb8242e02dbe79a49c',
  restartScheduled: '5eb03494b6584870a536b337290809b3',
} as const;

export const JOURNAL_TIMEOUT_MS = 3_000;
export const JOURNAL_MAX_BYTES = 1024 * 1024;

/** Runs `journalctl` with these arguments and resolves its stdout; rejects on failure or timeout. */
export type JournalRunner = (args: string[]) => Promise<string>;

export const runJournalctl: JournalRunner = (args) => new Promise((resolve, reject) => {
  const child = spawn('journalctl', args, { stdio: ['ignore', 'pipe', 'ignore'] });
  let out = '';
  let size = 0;
  const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('journalctl timed out')); }, JOURNAL_TIMEOUT_MS);
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    size += chunk.length;
    if (size > JOURNAL_MAX_BYTES) { child.kill('SIGKILL'); return; }
    out += chunk;
  });
  child.on('error', (e) => { clearTimeout(timer); reject(e); });
  child.on('close', (code) => {
    clearTimeout(timer);
    if (code === 0) resolve(out); else reject(new Error(`journalctl exited ${code}`));
  });
});

/** `7` → `SIGBUS`; null for a number no signal has. */
export function signalName(status: string): string | null {
  const n = Number(status);
  if (!Number.isInteger(n)) return /^SIG[A-Z0-9]+$/.test(status) ? status : /^[A-Z0-9]+$/.test(status) ? `SIG${status}` : null;
  for (const [name, value] of Object.entries(constants.signals)) if (value === n) return name;
  return null;
}

/** µs since the epoch, as the journal writes it, to an ISO instant. */
function journalTime(entry: Record<string, unknown>): string | null {
  const raw = entry._SOURCE_REALTIME_TIMESTAMP ?? entry.__REALTIME_TIMESTAMP;
  if (typeof raw !== 'string' || !/^\d+$/.test(raw)) return null;
  const at = new Date(Number(BigInt(raw) / 1000n));
  return Number.isNaN(at.getTime()) ? null : at.toISOString();
}

/** Parse `journalctl -o json` output for one invocation. Null when it holds no process-exit entry. */
export function parseServiceExit(output: string): ServiceExit | null {
  let exit: ServiceExit | null = null;
  let unitResult: string | null = null;
  let restarts: number | null = null;
  for (const line of output.split('\n')) {
    if (!line.trim()) continue;
    let entry: Record<string, unknown>;
    try { entry = JSON.parse(line) as Record<string, unknown>; } catch { continue; }
    if (typeof entry !== 'object' || entry === null) continue;
    const id = entry.MESSAGE_ID;
    if (id === MESSAGE.processExit && typeof entry.EXIT_CODE === 'string') {
      const status = typeof entry.EXIT_STATUS === 'string' ? entry.EXIT_STATUS : null;
      const bySignal = entry.EXIT_CODE === 'killed' || entry.EXIT_CODE === 'dumped';
      exit = {
        source: 'systemd',
        exitCode: entry.EXIT_CODE,
        exitStatus: status,
        signal: bySignal && status !== null ? signalName(status) : null,
        unitResult: null,
        restarts: null,
        exitedAt: journalTime(entry),
      };
    } else if (id === MESSAGE.failureResult && typeof entry.UNIT_RESULT === 'string') {
      unitResult = entry.UNIT_RESULT;
    } else if (id === MESSAGE.restartScheduled && typeof entry.N_RESTARTS === 'string' && /^\d+$/.test(entry.N_RESTARTS)) {
      restarts = Number(entry.N_RESTARTS);
    }
  }
  return exit ? { ...exit, unitResult, restarts } : null;
}

/**
 * The previous invocation's exit: the user manager's journal first (the unit `weave daemon
 * install-service` writes), then the system journal for a system unit. Never throws.
 */
export async function readServiceExit(invocationId: string, run: JournalRunner = runJournalctl): Promise<ServiceExit | null> {
  if (!/^[0-9a-f]{32}$/.test(invocationId)) return null;
  const queries = [
    ['--user', `USER_INVOCATION_ID=${invocationId}`, '-o', 'json', '--no-pager'],
    [`INVOCATION_ID=${invocationId}`, '-o', 'json', '--no-pager'],
  ];
  for (const args of queries) {
    try {
      const exit = parseServiceExit(await run(args));
      if (exit) return exit;
    } catch { /* unavailable for this scope; try the next */ }
  }
  return null;
}
