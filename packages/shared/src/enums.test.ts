import { describe, expect, it } from 'vitest';
import {
  CANCELLABLE_UPGRADE_STATES, CHANGELOG_KINDS, CHANGELOG_MEASURE_KIND, CHANGELOG_SOURCES,
  RUN_EVENT_TYPES, TERMINAL_UPGRADE_STATES, UPGRADE_FAILURE_REASONS, UPGRADE_STATES,
  isCancellableUpgrade, isTerminalUpgrade, type RunEventType, type UpgradeState,
} from './enums.js';

describe('run event types (VS-99)', () => {
  it('carries human.input, distinct from the agent-asks-for-input direction', () => {
    expect(RUN_EVENT_TYPES).toContain('human.input');
    expect(RUN_EVENT_TYPES).toContain('user_input.requested');
    const t: RunEventType = 'human.input';
    expect(RUN_EVENT_TYPES).toContain(t);
  });
});

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
    expect(UPGRADE_FAILURE_REASONS).toEqual(['build_failed', 'backup_failed', 'switch_failed', 'restart_unverified', 'restart_failed', 'abandoned']);
  });
});

describe('changelog kinds', () => {
  it('gives every kind exactly one activity action to project from', () => {
    expect(Object.keys(CHANGELOG_SOURCES).sort()).toEqual([...CHANGELOG_KINDS].sort());
    for (const kind of CHANGELOG_KINDS) expect(CHANGELOG_SOURCES[kind].action).toMatch(/^[a-z]+\.[a-z_]+$/);
  });

  // Two actions carry more than one meaning, so the kind is only right with the detail filter.
  it('distinguishes the two actions that need a detail filter', () => {
    expect(CHANGELOG_SOURCES.plan_approved.detail).toEqual({ key: 'to', value: 'approved' });
    expect(CHANGELOG_SOURCES.pr_opened.detail).toEqual({ key: 'type', value: 'pull_request' });
    for (const kind of ['filed', 'landed', 'cancelled', 'hired', 'upgraded'] as const) {
      expect(CHANGELOG_SOURCES[kind].detail).toBeUndefined();
    }
  });

  it('measures a day by the kind that means work reached the repository', () => {
    expect(CHANGELOG_MEASURE_KIND).toBe('landed');
    expect(CHANGELOG_KINDS).toContain(CHANGELOG_MEASURE_KIND);
  });
});
