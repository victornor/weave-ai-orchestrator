/**
 * VS-952: the daemon-level check on every workspace supervisor, on its own timer so it keeps running
 * whatever a supervisor tick does. A workspace `stalled` for `supervisor.stallExitSec` makes a daemon
 * running under systemd (`INVOCATION_ID` set) exit non-zero, so the unit's `Restart=always` brings it
 * back and boot recovery resumes the interrupted turns. Outside systemd nothing would restart the
 * process, so the stall is logged once per episode and the daemon keeps serving. A workspace that is
 * merely quiet — `idle` or `idle_waiting_on_human` — is never a stall.
 */
import { getLogger } from '@weave-ai/core';
import type { SupervisorHealth } from '@weave-ai/shared';
import type { WorkspaceRuntime } from './types.js';

const log = getLogger('daemon', { component: 'stall-watchdog' });

export const STALL_CHECK_EVERY_MS = 60_000;

export interface StallWatchdogOptions {
  workspaces: () => WorkspaceRuntime[];
  /** 0 disables the exit (the stall is still logged). */
  stallExitSec: number;
  /** True when a service manager will restart the process — `INVOCATION_ID` is set by systemd. */
  underServiceManager: boolean;
  /** Called once, with the workspace that crossed the threshold; the daemon exits non-zero. */
  exit: (workspaceId: string, health: SupervisorHealth) => void;
  now?: () => number;
}

export interface StallWatchdog { check(): void; start(): void; stop(): void }

export function createStallWatchdog(o: StallWatchdogOptions): StallWatchdog {
  const now = o.now ?? Date.now;
  /** workspaceId → when this stall episode was first seen, and whether it was already logged. */
  const stalledSince = new Map<string, { since: number; logged: boolean }>();
  let exiting = false;
  let timer: NodeJS.Timeout | null = null;

  function check(): void {
    if (exiting) return;
    for (const ws of o.workspaces()) {
      let health: SupervisorHealth;
      try { health = ws.services.supervisor.health(); } catch { continue; }
      if (health.state !== 'stalled') { stalledSince.delete(ws.id); continue; }
      const t = now();
      const episode = stalledSince.get(ws.id) ?? { since: t, logged: false };
      stalledSince.set(ws.id, episode);
      const stalledForSec = Math.round((t - episode.since) / 1000);
      const facts = { ws: ws.id, stalledForSec, lastTickFinishedAt: health.lastTickFinishedAt, stepsInFlight: health.stepsInFlight };
      if (o.stallExitSec > 0 && o.underServiceManager && t - episode.since >= o.stallExitSec * 1000) {
        exiting = true;
        log.fatal(facts, 'workspace supervisor stalled; exiting so the service manager restarts the daemon');
        o.exit(ws.id, health);
        return;
      }
      if (!episode.logged) {
        episode.logged = true;
        log.error({ ...facts, exitsAfterSec: o.underServiceManager && o.stallExitSec > 0 ? o.stallExitSec : null },
          o.underServiceManager && o.stallExitSec > 0
            ? 'workspace supervisor stalled; the daemon exits if it does not recover'
            : 'workspace supervisor stalled; not exiting, because no service manager would restart the daemon');
      }
    }
  }

  return {
    check,
    start() {
      if (timer) return;
      timer = setInterval(() => { try { check(); } catch (e) { log.warn({ err: String(e) }, 'stall check failed'); } }, STALL_CHECK_EVERY_MS);
      timer.unref?.();
    },
    stop() { if (timer) { clearInterval(timer); timer = null; } },
  };
}
