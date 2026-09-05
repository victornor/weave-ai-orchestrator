import { describe, expect, it } from 'vitest';
import {
  CANCELLABLE_UPGRADE_STATES, TERMINAL_UPGRADE_STATES, UPGRADE_FAILURE_REASONS, UPGRADE_STATES,
  isCancellableUpgrade, isTerminalUpgrade, type UpgradeState,
} from './enums.js';

describe('upgrade states', () => {
  it('is the forward-only lifecycle the daemon walks', () => {
    expect(UPGRADE_STATES).toEqual(['queued', 'waiting', 'building', 'switching', 'restarting', 'completed', 'failed', 'cancelled']);
  });

  it('only accepts a member of UPGRADE_STATES as an UpgradeState', () => {
    const ok: UpgradeState = 'waiting';
    expect(UPGRADE_STATES).toContain(ok);
    // @ts-expect-error 'pending' is not one of UPGRADE_STATES
    const bad: UpgradeState = 'pending';
    expect(UPGRADE_STATES).not.toContain(bad);
  });

  it('treats exactly the three end states as terminal', () => {
    expect(TERMINAL_UPGRADE_STATES).toEqual(['completed', 'failed', 'cancelled']);
    for (const state of UPGRADE_STATES) {
      expect(isTerminalUpgrade(state)).toBe(TERMINAL_UPGRADE_STATES.includes(state));
    }
    expect(isTerminalUpgrade(null)).toBe(false);
    expect(isTerminalUpgrade(undefined)).toBe(false);
    expect(isTerminalUpgrade('pending')).toBe(false);
  });

  it('is cancellable only before anything has been built', () => {
    expect(CANCELLABLE_UPGRADE_STATES).toEqual(['queued', 'waiting']);
    expect(isCancellableUpgrade('queued')).toBe(true);
    expect(isCancellableUpgrade('waiting')).toBe(true);
    for (const state of ['building', 'switching', 'restarting', 'completed', 'failed', 'cancelled'] as const) {
      expect(isCancellableUpgrade(state)).toBe(false);
    }
    expect(isCancellableUpgrade(null)).toBe(false);
  });

  it('names every failure reason the daemon can record', () => {
    expect(UPGRADE_FAILURE_REASONS).toEqual(['wait_timeout', 'build_failed', 'backup_failed', 'switch_failed', 'restart_unverified', 'restart_failed', 'abandoned']);
  });
});
