import { describe, expect, it, vi } from 'vitest';
import type { SupervisorHealth, SupervisorState } from '@weave-ai/shared';
import { createStallWatchdog } from '../src/stallWatchdog.js';
import type { WorkspaceRuntime } from '../src/types.js';

// VS-952: a stalled supervisor under systemd exits so `Restart=always` brings the daemon back; a
// quiet one never does, and without a service manager a stall is only reported.
const health = (state: SupervisorState): SupervisorHealth => ({
  state, startedAt: null, lastTickStartedAt: null, lastTickFinishedAt: null, stepsInFlight: [],
  lastWakeAt: null, activeRuns: 0, queuedWakes: 0, openHumanDecisions: 1, oldestHumanDecisionAgeMs: null,
});

function setup(opts: { underServiceManager: boolean; stallExitSec?: number }) {
  let state: SupervisorState = 'idle';
  let t = 0;
  const ws = { id: 'v-services', services: { supervisor: { health: () => health(state) } } } as unknown as WorkspaceRuntime;
  const exit = vi.fn();
  const dog = createStallWatchdog({ workspaces: () => [ws], stallExitSec: opts.stallExitSec ?? 600, underServiceManager: opts.underServiceManager, exit, now: () => t });
  return { dog, exit, set: (s: SupervisorState) => { state = s; }, at: (sec: number) => { t = sec * 1000; } };
}

describe('stall watchdog (VS-952)', () => {
  it('exits once a workspace has been stalled for stallExitSec under a service manager', () => {
    const { dog, exit, set, at } = setup({ underServiceManager: true });
    set('stalled');
    at(0); dog.check();
    at(599); dog.check();
    expect(exit).not.toHaveBeenCalled();
    at(600); dog.check();
    expect(exit).toHaveBeenCalledTimes(1);
    expect(exit.mock.calls[0]![0]).toBe('v-services');
    at(700); dog.check();
    expect(exit).toHaveBeenCalledTimes(1);
  });

  it('only logs a stall when no service manager would restart the daemon', () => {
    const { dog, exit, set, at } = setup({ underServiceManager: false });
    set('stalled');
    at(0); dog.check();
    at(86_400); dog.check();
    expect(exit).not.toHaveBeenCalled();
  });

  it('never exits for a workspace that is idle or waiting on a human, however long', () => {
    const { dog, exit, set, at } = setup({ underServiceManager: true });
    for (const s of ['idle_waiting_on_human', 'idle', 'starting', 'active'] as const) {
      set(s);
      at(0); dog.check();
      at(86_400); dog.check();
    }
    expect(exit).not.toHaveBeenCalled();
  });

  it('starts the clock again when a stall recovers before the threshold', () => {
    const { dog, exit, set, at } = setup({ underServiceManager: true });
    set('stalled'); at(0); dog.check();
    set('idle'); at(500); dog.check();
    set('stalled'); at(550); dog.check();
    at(1_000); dog.check();
    expect(exit).not.toHaveBeenCalled();
    at(1_150); dog.check();
    expect(exit).toHaveBeenCalledTimes(1);
  });

  it('does not exit when stallExitSec is 0', () => {
    const { dog, exit, set, at } = setup({ underServiceManager: true, stallExitSec: 0 });
    set('stalled');
    at(0); dog.check();
    at(86_400); dog.check();
    expect(exit).not.toHaveBeenCalled();
  });
});
